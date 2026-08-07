namespace SentinelAI.Core.Models;

public enum QuarantineState
{
    /// <summary>Le fichier est dans le coffre, chiffre, et absent de son emplacement d'origine.</summary>
    EnQuarantaine = 0,

    /// <summary>Le fichier a ete restaure a son emplacement d'origine.</summary>
    Restaure,

    /// <summary>Le fichier a ete supprime definitivement du coffre.</summary>
    SupprimeDefinitivement
}

/// <summary>Element du coffre de quarantaine.</summary>
public sealed class QuarantineEntry
{
    public required string Id { get; init; }

    /// <summary>Chemin d'origine, utilise pour la restauration.</summary>
    public required string CheminOrigine { get; init; }

    public required string Nom { get; init; }

    public long Taille { get; init; }

    /// <summary>Empreinte du fichier d'origine, verifiee a la restauration.</summary>
    public string? Sha256 { get; init; }

    public string Motif { get; init; } = string.Empty;

    public int Score { get; init; }

    public RiskLevel Niveau { get; init; }

    public DateTime MiseEnQuarantaineLe { get; init; }

    public DateTime? RestaureLe { get; init; }

    public QuarantineState Etat { get; init; } = QuarantineState.EnQuarantaine;

    /// <summary>Nom du fichier chiffre dans le coffre.</summary>
    public required string FichierCoffre { get; init; }

    /// <summary>Attributs Windows d'origine, restaures avec le fichier.</summary>
    public FileAttributes Attributs { get; init; }

    public string EtatLibelle => Etat switch
    {
        QuarantineState.EnQuarantaine => "En quarantaine",
        QuarantineState.Restaure => "Restauré",
        QuarantineState.SupprimeDefinitivement => "Supprimé définitivement",
        _ => "Inconnu"
    };
}
