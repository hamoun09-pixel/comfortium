using System.Globalization;
using System.Text;
using System.Text.Json;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Storage;

/// <summary>Niveau d'une entree de journal.</summary>
public enum JournalLevel
{
    Info,
    Detection,
    Action,
    Erreur
}

/// <summary>
/// Journal complet, en deux formats : un fichier JSONL par jour (exploitable par un outil)
/// et un fichier texte lisible directement. Tout ce que fait SentinelAI y est trace.
/// </summary>
public sealed class JournalService
{
    private readonly string _dossier;
    private readonly Lock _verrou = new();

    public JournalService(string? dossier = null)
    {
        _dossier = dossier ?? SentinelPaths.JournalDirectory;
        Directory.CreateDirectory(_dossier);
    }

    public string FichierJsonDuJour => Path.Combine(_dossier, $"sentinelai-{DateTime.Now:yyyy-MM-dd}.jsonl");

    public string FichierTexteDuJour => Path.Combine(_dossier, $"sentinelai-{DateTime.Now:yyyy-MM-dd}.log");

    public void Ecrire(JournalLevel niveau, string evenement, string message, object? details = null)
    {
        var entree = new
        {
            horodatage = DateTime.Now.ToString("O", CultureInfo.InvariantCulture),
            niveau = niveau.ToString(),
            evenement,
            message,
            details
        };

        var ligneJson = JsonSerializer.Serialize(entree);
        var ligneTexte = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{niveau,-9}] {evenement} — {message}";

        lock (_verrou)
        {
            try
            {
                File.AppendAllText(FichierJsonDuJour, ligneJson + Environment.NewLine, Encoding.UTF8);
                File.AppendAllText(FichierTexteDuJour, ligneTexte + Environment.NewLine, Encoding.UTF8);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Le journal ne doit jamais faire echouer une analyse.
            }
        }
    }

    public void DebutAnalyse(string id, string cible, ScanOptions options) =>
        Ecrire(JournalLevel.Info, "analyse.debut", $"Analyse de « {cible} » démarrée.", new
        {
            id,
            cible,
            options.Recursif,
            options.TypesSensiblesUniquement,
            options.Parallelisme,
            options.VerifierSignature
        });

    public void FinAnalyse(ScanReport rapport) =>
        Ecrire(JournalLevel.Info, "analyse.fin", rapport.Synthese, new
        {
            rapport.Id,
            rapport.Cible,
            rapport.FichiersAnalyses,
            rapport.Suspects,
            rapport.Critiques,
            rapport.Erreurs,
            secondes = Math.Round(rapport.Duree.TotalSeconds, 1),
            rapport.Annulee
        });

    public void Detection(FileAnalysis analyse) =>
        Ecrire(JournalLevel.Detection, "fichier.suspect", analyse.Resume, new
        {
            analyse.Chemin,
            analyse.Sha256,
            analyse.Taille,
            categorie = analyse.Categorie.ToString(),
            signature = analyse.Signature.Status.ToString(),
            analyse.Signature.Signataire,
            analyse.Score,
            niveau = analyse.Niveau.ToString(),
            indicateurs = analyse.Indicateurs.Select(i => new { i.Id, i.Nom, i.Poids, i.Preuve }),
            analyse.Explications
        });

    public void Erreur(string chemin, string message) =>
        Ecrire(JournalLevel.Erreur, "fichier.erreur", $"{chemin} : {message}");

    public void Action(string evenement, string message, object? details = null) =>
        Ecrire(JournalLevel.Action, evenement, message, details);

    /// <summary>Dernieres lignes du journal texte, pour affichage dans l'interface.</summary>
    public IReadOnlyList<string> DernieresLignes(int nombre = 200)
    {
        try
        {
            var fichier = FichierTexteDuJour;
            if (!File.Exists(fichier))
            {
                return [];
            }

            var lignes = File.ReadAllLines(fichier);
            return lignes.Length <= nombre ? lignes : lignes[^nombre..];
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>Supprime les journaux plus anciens que la retention demandee.</summary>
    public int Purger(int joursConserves = 90)
    {
        var limite = DateTime.Now.AddDays(-joursConserves);
        var supprimes = 0;

        foreach (var fichier in Directory.EnumerateFiles(_dossier, "sentinelai-*.*"))
        {
            try
            {
                if (File.GetLastWriteTime(fichier) < limite)
                {
                    File.Delete(fichier);
                    supprimes++;
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Fichier verrouille : on le laisse en place.
            }
        }

        return supprimes;
    }
}
