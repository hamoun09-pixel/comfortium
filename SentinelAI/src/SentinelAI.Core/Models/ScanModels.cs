namespace SentinelAI.Core.Models;

/// <summary>Options d'une analyse manuelle.</summary>
public sealed class ScanOptions
{
    /// <summary>Analyser les sous-dossiers.</summary>
    public bool Recursif { get; set; } = true;

    /// <summary>N'analyser que les types sensibles (accelere fortement les gros dossiers).</summary>
    public bool TypesSensiblesUniquement { get; set; }

    /// <summary>Taille maximale pour la lecture du contenu (le SHA-256 reste calcule au-dela).</summary>
    public long TailleMaxContenu { get; set; } = 128L * 1024 * 1024;

    /// <summary>Nombre de fichiers analyses en parallele.</summary>
    public int Parallelisme { get; set; } = Math.Max(2, Environment.ProcessorCount / 2);

    /// <summary>Suivre les points d'analyse (liens symboliques, jonctions). Desactive par defaut : evite les boucles.</summary>
    public bool SuivreLiens { get; set; }

    /// <summary>Dossiers exclus (comparaison sur le debut du chemin, insensible a la casse).</summary>
    public List<string> Exclusions { get; set; } = [];

    /// <summary>Verifier la signature Authenticode (Windows uniquement).</summary>
    public bool VerifierSignature { get; set; } = true;

    /// <summary>Enregistrer le resultat dans la base et le journal.</summary>
    public bool Journaliser { get; set; } = true;
}

/// <summary>Avancement transmis a l'interface pendant l'analyse.</summary>
public sealed class ScanProgress
{
    public int FichiersAnalyses { get; init; }

    public int FichiersTotal { get; init; }

    public long OctetsAnalyses { get; init; }

    public string? FichierCourant { get; init; }

    public int Suspects { get; init; }

    public double Pourcentage => FichiersTotal <= 0
        ? 0
        : Math.Clamp(FichiersAnalyses * 100d / FichiersTotal, 0, 100);
}

/// <summary>Rapport final d'une session d'analyse.</summary>
public sealed class ScanReport
{
    public required string Id { get; init; }

    public required string Cible { get; init; }

    public DateTime Debut { get; init; }

    public DateTime Fin { get; init; }

    public TimeSpan Duree => Fin - Debut;

    public bool Annulee { get; init; }

    public IReadOnlyList<FileAnalysis> Resultats { get; init; } = [];

    public int FichiersAnalyses => Resultats.Count;

    public long OctetsAnalyses => Resultats.Sum(r => r.Taille);

    public int Erreurs => Resultats.Count(r => r.EnErreur);

    public int Suspects => Resultats.Count(r => r.Niveau >= RiskLevel.Moyen);

    public int Critiques => Resultats.Count(r => r.Niveau == RiskLevel.Critique);

    public IEnumerable<FileAnalysis> ParRisqueDecroissant =>
        Resultats.OrderByDescending(r => r.Score).ThenBy(r => r.Nom, StringComparer.OrdinalIgnoreCase);

    public string Synthese =>
        $"{FichiersAnalyses} fichier(s) analysé(s) en {Duree.TotalSeconds:0.0} s — " +
        $"{Suspects} à vérifier, {Critiques} critique(s), {Erreurs} erreur(s)" +
        (Annulee ? " — analyse interrompue par l'utilisateur." : ".");
}
