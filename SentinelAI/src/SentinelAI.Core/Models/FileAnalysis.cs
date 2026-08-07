namespace SentinelAI.Core.Models;

/// <summary>Resultat complet de l'analyse d'un fichier.</summary>
public sealed class FileAnalysis
{
    public required string Chemin { get; init; }

    public string Nom => Path.GetFileName(Chemin);

    /// <summary>Extension en minuscules, point inclus (ex. « .exe »). Vide si absente.</summary>
    public string Extension { get; init; } = string.Empty;

    public long Taille { get; init; }

    /// <summary>Empreinte SHA-256 en hexadecimal minuscule. Null si le calcul a echoue.</summary>
    public string? Sha256 { get; init; }

    public FileCategory Categorie { get; init; } = FileCategory.Autre;

    /// <summary>Vrai si le type fait partie des types sensibles surveilles par SentinelAI.</summary>
    public bool TypeSensible { get; init; }

    /// <summary>Type reel deduit des octets d'en-tete, quand il est identifiable.</summary>
    public string? TypeReel { get; init; }

    public SignatureInfo Signature { get; init; } = SignatureInfo.NonApplicable();

    public DateTime CreeLe { get; init; }

    public DateTime ModifieLe { get; init; }

    public IReadOnlyList<RuleHit> Indicateurs { get; init; } = [];

    /// <summary>Score de risque borne entre 0 et 100.</summary>
    public int Score { get; init; }

    public RiskLevel Niveau { get; init; } = RiskLevel.Sain;

    /// <summary>Explications lisibles, dans l'ordre d'importance.</summary>
    public IReadOnlyList<string> Explications { get; init; } = [];

    public DateTime AnalyseLe { get; init; } = DateTime.UtcNow;

    /// <summary>Message d'erreur si le fichier n'a pas pu etre analyse completement.</summary>
    public string? Erreur { get; init; }

    public bool EnErreur => !string.IsNullOrEmpty(Erreur);

    /// <summary>Resume d'une ligne pour le journal texte.</summary>
    public string Resume =>
        $"{Niveau.Libelle()} ({Score}/100) — {Nom} — {Categorie.Libelle()} — signature : {Signature.Libelle}" +
        (Indicateurs.Count > 0 ? $" — {Indicateurs.Count} indicateur(s)" : "");

    public static FileAnalysis Echec(string chemin, string erreur) => new()
    {
        Chemin = chemin,
        Extension = Path.GetExtension(chemin).ToLowerInvariant(),
        Erreur = erreur,
        Signature = SignatureInfo.Inconnue("Analyse interrompue."),
        Explications = [$"Analyse impossible : {erreur}"]
    };
}
