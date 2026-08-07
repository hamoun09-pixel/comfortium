using System.Text;
using System.Text.Json;
using SentinelAI.Core;
using SentinelAI.Core.Models;
using SentinelAI.Core.Quarantine;
using SentinelAI.Core.Scanning;
using SentinelAI.Core.Storage;

Console.OutputEncoding = Encoding.UTF8;

if (args.Length == 0 || args[0] is "-h" or "--aide" or "aide" or "--help")
{
    AfficherAide();
    return 0;
}

try
{
    return args[0].ToLowerInvariant() switch
    {
        "analyser" => await AnalyserAsync(args[1..]),
        "journal" => Journal(args[1..]),
        "quarantaine" => await QuarantaineAsync(args[1..]),
        "regles" => Regles(),
        "version" => Version(),
        _ => Inconnu(args[0])
    };
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Erreur : {ex.Message}");
    return 2;
}

static void AfficherAide()
{
    Console.WriteLine("""
        SentinelAI — analyse locale de fichiers (V0.1)

        Utilisation :
          sentinelai analyser <chemin> [options]
          sentinelai journal [--analyses | --detections] [--limite N]
          sentinelai quarantaine lister [--tout]
          sentinelai quarantaine ajouter <chemin> [--motif "texte"]
          sentinelai quarantaine restaurer <id> [--ecraser]
          sentinelai quarantaine supprimer <id>
          sentinelai regles
          sentinelai version

        Options d'analyse :
          --non-recursif        N'analyse pas les sous-dossiers.
          --sensibles           N'analyse que les types sensibles (.exe, .dll, .ps1, ...).
          --sans-signature      Ignore la vérification de signature numérique.
          --sans-journal        N'écrit rien dans la base ni dans le journal.
          --parallelisme N      Nombre de fichiers analysés en parallèle.
          --seuil N             N'affiche que les fichiers dont le score atteint N (défaut : 1).
          --json                Sortie JSON complète, pour un traitement automatisé.

        Les données sont stockées dans : SENTINELAI_DATA ou l'emplacement par défaut.
        """);
    Console.WriteLine($"Emplacement actuel : {SentinelPaths.Root}");
}

static int Inconnu(string commande)
{
    Console.Error.WriteLine($"Commande inconnue : « {commande} ». Utilisez « sentinelai aide ».");
    return 2;
}

static int Version()
{
    Console.WriteLine("SentinelAI 0.1.0 — scanner local");
    Console.WriteLine($"Dossier de données : {SentinelPaths.Root}");
    return 0;
}

static int Regles()
{
    var moteur = SentinelAI.Core.Rules.RuleEngine.Charger();
    Console.WriteLine($"{moteur.Nombre} règle(s) chargée(s) :");
    foreach (var regle in moteur.Regles.OrderByDescending(r => r.Poids))
    {
        Console.WriteLine($"  {regle.Id,-14} poids {regle.Poids,3}  {regle.Nom}");
    }

    var liste = SentinelAI.Core.Rules.HashBlocklist.Charger();
    Console.WriteLine($"\nListe d'empreintes locales : {liste.Nombre} entrée(s) ({SentinelPaths.BlocklistFile}).");
    return 0;
}

static async Task<int> AnalyserAsync(string[] args)
{
    if (args.Length == 0)
    {
        Console.Error.WriteLine("Indiquez un fichier ou un dossier à analyser.");
        return 2;
    }

    var cible = Path.GetFullPath(args[0]);
    var sortieJson = args.Contains("--json");
    var seuil = LireEntier(args, "--seuil", 1);

    var options = new ScanOptions
    {
        Recursif = !args.Contains("--non-recursif"),
        TypesSensiblesUniquement = args.Contains("--sensibles"),
        VerifierSignature = !args.Contains("--sans-signature"),
        Journaliser = !args.Contains("--sans-journal"),
        Parallelisme = LireEntier(args, "--parallelisme", Math.Max(2, Environment.ProcessorCount / 2))
    };

    var moteur = ScanEngine.Standard();

    using var annulation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        Console.Error.WriteLine("\nInterruption demandée, arrêt en cours...");
        annulation.Cancel();
    };

    IProgress<ScanProgress>? avancement = sortieJson
        ? null
        : new Progress<ScanProgress>(p =>
        {
            if (p.FichiersAnalyses % 25 == 0 || p.FichiersAnalyses == p.FichiersTotal)
            {
                Console.Error.Write($"\r{p.FichiersAnalyses}/{p.FichiersTotal} fichiers — {p.Suspects} à vérifier   ");
            }
        });

    var rapport = await moteur.AnalyserAsync(cible, options, avancement, annulation.Token);

    if (!sortieJson)
    {
        Console.Error.WriteLine();
    }

    if (sortieJson)
    {
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            rapport.Id,
            rapport.Cible,
            rapport.Debut,
            rapport.Fin,
            rapport.FichiersAnalyses,
            rapport.Suspects,
            rapport.Critiques,
            rapport.Erreurs,
            rapport.Annulee,
            resultats = rapport.ParRisqueDecroissant
                .Where(r => r.Score >= seuil)
                .Select(r => new
                {
                    r.Chemin,
                    r.Sha256,
                    r.Taille,
                    categorie = r.Categorie.ToString(),
                    r.TypeSensible,
                    r.TypeReel,
                    signature = r.Signature.Status.ToString(),
                    r.Signature.Signataire,
                    r.Score,
                    niveau = r.Niveau.ToString(),
                    indicateurs = r.Indicateurs.Select(i => new { i.Id, i.Nom, i.Poids, i.Preuve }),
                    r.Explications,
                    r.Erreur
                })
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
    else
    {
        AfficherRapport(rapport, seuil);
    }

    return rapport.Critiques > 0 ? 1 : 0;
}

static void AfficherRapport(ScanReport rapport, int seuil)
{
    Console.WriteLine();
    Console.WriteLine($"Cible : {rapport.Cible}");
    Console.WriteLine(rapport.Synthese);
    Console.WriteLine(new string('─', 72));

    var affiches = rapport.ParRisqueDecroissant.Where(r => r.Score >= seuil).ToList();

    if (affiches.Count == 0)
    {
        Console.WriteLine("Aucun fichier n'atteint le seuil affiché. Rien à signaler.");
        return;
    }

    foreach (var resultat in affiches)
    {
        Console.WriteLine();
        Console.WriteLine($"[{resultat.Niveau.Libelle().ToUpperInvariant()}] {resultat.Chemin}");
        Console.WriteLine($"  SHA-256   : {resultat.Sha256}");
        Console.WriteLine($"  Type      : {resultat.Categorie.Libelle()}" +
                          (resultat.TypeReel is null ? "" : $" (contenu : {resultat.TypeReel})") +
                          (resultat.TypeSensible ? " — type sensible" : ""));
        Console.WriteLine($"  Taille    : {Lisible(resultat.Taille)}");
        Console.WriteLine($"  Signature : {resultat.Signature.Libelle} — {resultat.Signature.Message}");

        foreach (var explication in resultat.Explications)
        {
            Console.WriteLine($"  {explication}");
        }
    }

    Console.WriteLine();
    Console.WriteLine($"Journal : {SentinelPaths.JournalDirectory}");
}

static int Journal(string[] args)
{
    var baseDonnees = new SentinelDatabase();
    var depot = new ScanRepository(baseDonnees);
    var limite = LireEntier(args, "--limite", 20);

    if (args.Contains("--detections"))
    {
        var detections = depot.Detections(limite: limite);
        Console.WriteLine($"{detections.Count} détection(s) enregistrée(s) :");
        foreach (var detection in detections)
        {
            Console.WriteLine($"  {detection.AnalyseLe.ToLocalTime():yyyy-MM-dd HH:mm}  " +
                              $"[{detection.Niveau.Libelle(),-8}] {detection.Score,3}/100  {detection.Chemin}");
        }

        return 0;
    }

    var analyses = depot.DernieresAnalyses(limite);
    Console.WriteLine($"{analyses.Count} analyse(s) :");
    foreach (var analyse in analyses)
    {
        Console.WriteLine($"  {analyse.Debut.ToLocalTime():yyyy-MM-dd HH:mm}  {analyse.Id[..8]}  " +
                          $"{analyse.FichiersAnalyses,6} fichiers  {analyse.Suspects,4} à vérifier  " +
                          $"{analyse.Critiques,3} critiques  {analyse.Cible}");
    }

    Console.WriteLine();
    Console.WriteLine($"Journal texte : {new JournalService().FichierTexteDuJour}");
    return 0;
}

static async Task<int> QuarantaineAsync(string[] args)
{
    if (args.Length == 0)
    {
        Console.Error.WriteLine("Sous-commandes : lister, ajouter, restaurer, supprimer.");
        return 2;
    }

    var baseDonnees = new SentinelDatabase();
    var journal = new JournalService();
    var service = new QuarantineService(baseDonnees, journal);

    switch (args[0].ToLowerInvariant())
    {
        case "lister":
        {
            var elements = service.Lister(actifsUniquement: !args.Contains("--tout"));
            if (elements.Count == 0)
            {
                Console.WriteLine("La quarantaine est vide.");
                return 0;
            }

            Console.WriteLine($"{elements.Count} élément(s) :");
            foreach (var element in elements)
            {
                Console.WriteLine($"  {element.Id}  {element.MiseEnQuarantaineLe.ToLocalTime():yyyy-MM-dd HH:mm}  " +
                                  $"[{element.EtatLibelle}] {element.Score,3}/100  {element.CheminOrigine}");
                Console.WriteLine($"      motif : {element.Motif}");
            }

            return 0;
        }

        case "ajouter":
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("Indiquez le fichier à mettre en quarantaine.");
                return 2;
            }

            var motif = LireTexte(args, "--motif") ?? "Mise en quarantaine manuelle";
            var resultat = await service.MettreEnQuarantaineAsync(Path.GetFullPath(args[1]), motif);
            Console.WriteLine(resultat.Message);
            return resultat.Reussi ? 0 : 1;
        }

        case "restaurer":
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("Indiquez l'identifiant de l'élément à restaurer.");
                return 2;
            }

            var resultat = await service.RestaurerAsync(args[1], ecraser: args.Contains("--ecraser"));
            Console.WriteLine(resultat.Message);
            return resultat.Reussi ? 0 : 1;
        }

        case "supprimer":
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("Indiquez l'identifiant de l'élément à supprimer.");
                return 2;
            }

            var resultat = service.SupprimerDefinitivement(args[1]);
            Console.WriteLine(resultat.Message);
            return resultat.Reussi ? 0 : 1;
        }

        default:
            Console.Error.WriteLine($"Sous-commande inconnue : « {args[0]} ».");
            return 2;
    }
}

static int LireEntier(string[] args, string nom, int defaut)
{
    var position = Array.IndexOf(args, nom);
    return position >= 0 && position + 1 < args.Length && int.TryParse(args[position + 1], out var valeur)
        ? valeur
        : defaut;
}

static string? LireTexte(string[] args, string nom)
{
    var position = Array.IndexOf(args, nom);
    return position >= 0 && position + 1 < args.Length ? args[position + 1] : null;
}

static string Lisible(long octets) => octets switch
{
    < 1024 => $"{octets} o",
    < 1024 * 1024 => $"{octets / 1024.0:0.0} Ko",
    < 1024 * 1024 * 1024 => $"{octets / (1024.0 * 1024):0.0} Mo",
    _ => $"{octets / (1024.0 * 1024 * 1024):0.00} Go"
};
