namespace SentinelAI.Core.Models;

/// <summary>Origine d'un indicateur releve sur un fichier.</summary>
public enum HitSource
{
    /// <summary>Regle de contenu (motif trouve dans le fichier).</summary>
    Contenu = 0,

    /// <summary>Indicateur structurel (nom, emplacement, attributs, coherence du type).</summary>
    Structure,

    /// <summary>Etat de la signature numerique.</summary>
    Signature,

    /// <summary>Correspondance d'empreinte SHA-256 dans la liste locale.</summary>
    Empreinte
}

/// <summary>Indicateur declenche pendant l'analyse d'un fichier.</summary>
public sealed class RuleHit
{
    public required string Id { get; init; }

    public required string Nom { get; init; }

    public string Description { get; init; } = string.Empty;

    /// <summary>Poids ajoute (ou retire, si negatif) au score de risque.</summary>
    public int Poids { get; init; }

    public HitSource Source { get; init; } = HitSource.Contenu;

    /// <summary>Extrait ou preuve concrete, tronque et neutralise pour l'affichage.</summary>
    public string? Preuve { get; init; }

    /// <summary>Nombre d'occurrences trouvees (regles de contenu).</summary>
    public int Occurrences { get; init; } = 1;

    /// <summary>Ligne d'explication affichee dans l'interface et le journal.</summary>
    public string Explication =>
        $"{(Poids >= 0 ? "+" : "")}{Poids} — {Nom}" +
        (string.IsNullOrWhiteSpace(Preuve) ? "" : $" : {Preuve}");
}
