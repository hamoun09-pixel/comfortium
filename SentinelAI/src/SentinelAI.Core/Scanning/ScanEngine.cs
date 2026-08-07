using System.Collections.Concurrent;
using SentinelAI.Core.Analysis;
using SentinelAI.Core.Models;
using SentinelAI.Core.Rules;
using SentinelAI.Core.Scoring;
using SentinelAI.Core.Storage;

namespace SentinelAI.Core.Scanning;

/// <summary>
/// Orchestration de l'analyse : enumeration des fichiers, empreinte, type, signature,
/// regles, score, journalisation. Chaque fichier est traite independamment ; une erreur
/// sur un fichier n'interrompt jamais l'analyse.
/// </summary>
public sealed class ScanEngine
{
    private readonly FileHasher _empreinteur;
    private readonly FileTypeInspector _inspecteur;
    private readonly IAuthenticodeVerifier _signatures;
    private readonly RuleEngine _regles;
    private readonly StructuralAnalyzer _structure;
    private readonly HashBlocklist _empreintesBloquees;
    private readonly RiskScorer _notation;
    private readonly JournalService? _journal;
    private readonly ScanRepository? _depot;

    public ScanEngine(
        RuleEngine regles,
        HashBlocklist empreintesBloquees,
        IAuthenticodeVerifier? signatures = null,
        JournalService? journal = null,
        ScanRepository? depot = null)
    {
        _regles = regles;
        _empreintesBloquees = empreintesBloquees;
        _signatures = signatures ?? AuthenticodeVerifierFactory.Create();
        _journal = journal;
        _depot = depot;
        _empreinteur = new FileHasher();
        _inspecteur = new FileTypeInspector();
        _structure = new StructuralAnalyzer();
        _notation = new RiskScorer();
    }

    /// <summary>Emis apres chaque fichier analyse, y compris les fichiers sains.</summary>
    public event EventHandler<FileAnalysis>? FichierAnalyse;

    /// <summary>Construit un moteur pret a l'emploi avec la configuration par defaut.</summary>
    public static ScanEngine Standard(SentinelDatabase? baseDonnees = null, JournalService? journal = null)
    {
        SentinelPaths.EnsureCreated();
        var donnees = baseDonnees ?? new SentinelDatabase();
        var carnet = journal ?? new JournalService();

        return new ScanEngine(
            RuleEngine.Charger(),
            HashBlocklist.Charger(),
            AuthenticodeVerifierFactory.Create(),
            carnet,
            new ScanRepository(donnees));
    }

    /// <summary>Analyse un fichier ou un dossier.</summary>
    public async Task<ScanReport> AnalyserAsync(
        string cible,
        ScanOptions? options = null,
        IProgress<ScanProgress>? avancement = null,
        CancellationToken cancellationToken = default)
    {
        options ??= new ScanOptions();
        var identifiant = Guid.NewGuid().ToString("N");
        var debut = DateTime.UtcNow;
        var annulee = false;

        _journal?.DebutAnalyse(identifiant, cible, options);
        if (options.Journaliser)
        {
            _depot?.DebuterAnalyse(identifiant, cible, debut);
        }

        var fichiers = Enumerer(cible, options).ToList();
        var resultats = new ConcurrentBag<FileAnalysis>();
        var traites = 0;
        var suspects = 0;
        long octets = 0;

        try
        {
            await Parallel.ForEachAsync(
                fichiers,
                new ParallelOptions
                {
                    MaxDegreeOfParallelism = Math.Max(1, options.Parallelisme),
                    CancellationToken = cancellationToken
                },
                async (fichier, jeton) =>
                {
                    var analyse = await AnalyserFichierAsync(fichier, options, jeton).ConfigureAwait(false);
                    resultats.Add(analyse);

                    var faits = Interlocked.Increment(ref traites);
                    Interlocked.Add(ref octets, analyse.Taille);
                    if (analyse.Niveau >= RiskLevel.Moyen)
                    {
                        Interlocked.Increment(ref suspects);
                        _journal?.Detection(analyse);
                    }

                    if (analyse.EnErreur)
                    {
                        _journal?.Erreur(analyse.Chemin, analyse.Erreur!);
                    }

                    FichierAnalyse?.Invoke(this, analyse);

                    avancement?.Report(new ScanProgress
                    {
                        FichiersAnalyses = faits,
                        FichiersTotal = fichiers.Count,
                        OctetsAnalyses = Interlocked.Read(ref octets),
                        FichierCourant = analyse.Chemin,
                        Suspects = Volatile.Read(ref suspects)
                    });
                }).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            annulee = true;
        }

        var rapport = new ScanReport
        {
            Id = identifiant,
            Cible = cible,
            Debut = debut,
            Fin = DateTime.UtcNow,
            Annulee = annulee,
            Resultats = [.. resultats]
        };

        if (options.Journaliser && _depot is not null)
        {
            _depot.EnregistrerResultats(identifiant, rapport.Resultats);
            _depot.TerminerAnalyse(rapport);
        }

        _journal?.FinAnalyse(rapport);
        return rapport;
    }

    /// <summary>Analyse un fichier unique et renvoie son verdict complet.</summary>
    public async Task<FileAnalysis> AnalyserFichierAsync(
        string chemin,
        ScanOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        options ??= new ScanOptions();

        try
        {
            var fichier = new FileInfo(chemin);
            if (!fichier.Exists)
            {
                return FileAnalysis.Echec(chemin, "Fichier introuvable ou supprimé pendant l'analyse.");
            }

            // 1. Empreinte SHA-256 — toujours calculee, quelle que soit la taille.
            var empreinte = await _empreinteur.Sha256Async(chemin, cancellationToken).ConfigureAwait(false);

            // 2. Type reel a partir des premiers octets.
            var entete = await FileTypeInspector.LireEnteteAsync(chemin, 512, cancellationToken).ConfigureAwait(false);
            var type = _inspecteur.Inspecter(chemin, entete);

            // 3. Indicateurs structurels (nom, emplacement, attributs, coherence).
            var indicateurs = new List<RuleHit>(_structure.Analyser(fichier, type));

            // 4. Empreinte repertoriee.
            if (_empreintesBloquees.Verifier(empreinte) is { } correspondance)
            {
                indicateurs.Add(correspondance);
            }

            // 5. Regles de contenu, dans la limite de taille configuree.
            if (fichier.Length <= options.TailleMaxContenu && fichier.Length > 0)
            {
                var contenu = await File.ReadAllBytesAsync(chemin, cancellationToken).ConfigureAwait(false);
                var texte = TextExtractor.Extraire(contenu);
                indicateurs.AddRange(_regles.Evaluer(texte, type.Categorie, type.Extension));
            }

            // 6. Signature Authenticode.
            var signature = options.VerifierSignature && _signatures.Disponible
                ? _signatures.Verifier(chemin)
                : SignatureInfo.NonApplicable(options.VerifierSignature
                    ? "Vérification de signature indisponible sur cette plateforme."
                    : "Vérification de signature désactivée dans les options.");

            // 7. Score explique.
            var evaluation = _notation.Evaluer(indicateurs, signature, type.Sensible);

            return new FileAnalysis
            {
                Chemin = fichier.FullName,
                Extension = type.Extension,
                Taille = fichier.Length,
                Sha256 = empreinte,
                Categorie = type.Categorie,
                TypeSensible = type.Sensible,
                TypeReel = type.TypeReel,
                Signature = signature,
                CreeLe = fichier.CreationTimeUtc,
                ModifieLe = fichier.LastWriteTimeUtc,
                Indicateurs = evaluation.Indicateurs,
                Score = evaluation.Score,
                Niveau = evaluation.Niveau,
                Explications = evaluation.Explications
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return FileAnalysis.Echec(chemin, ex.Message);
        }
    }

    /// <summary>Liste les fichiers a analyser selon la cible et les options.</summary>
    public IEnumerable<string> Enumerer(string cible, ScanOptions options)
    {
        if (File.Exists(cible))
        {
            return [Path.GetFullPath(cible)];
        }

        if (!Directory.Exists(cible))
        {
            return [];
        }

        var exclusions = new List<string>(options.Exclusions)
        {
            // Le coffre de quarantaine ne doit jamais etre analyse : son contenu est chiffre.
            SentinelPaths.QuarantineDirectory
        };

        var parametres = new EnumerationOptions
        {
            RecurseSubdirectories = options.Recursif,
            IgnoreInaccessible = true,
            AttributesToSkip = options.SuivreLiens
                ? FileAttributes.None
                : FileAttributes.ReparsePoint,
            MaxRecursionDepth = 64
        };

        return Directory.EnumerateFiles(cible, "*", parametres)
            .Where(chemin => !EstExclu(chemin, exclusions))
            .Where(chemin => !options.TypesSensiblesUniquement || FileTypeInspector.EstSensible(chemin));
    }

    private static bool EstExclu(string chemin, List<string> exclusions) =>
        exclusions.Any(exclusion =>
            !string.IsNullOrWhiteSpace(exclusion) &&
            chemin.StartsWith(exclusion, StringComparison.OrdinalIgnoreCase));
}
