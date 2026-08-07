namespace SentinelAI.Core.Models;

/// <summary>Niveau de risque attribue a un fichier apres analyse.</summary>
public enum RiskLevel
{
    /// <summary>Aucun indicateur notable.</summary>
    Sain = 0,

    /// <summary>Indicateurs mineurs, generalement benins.</summary>
    Faible = 1,

    /// <summary>A verifier : plusieurs indicateurs ou un indicateur moyen.</summary>
    Moyen = 2,

    /// <summary>Fortement suspect : mise en quarantaine recommandee.</summary>
    Eleve = 3,

    /// <summary>Correspondance connue ou faisceau d'indices tres serieux.</summary>
    Critique = 4
}

public static class RiskLevelExtensions
{
    public static string Libelle(this RiskLevel niveau) => niveau switch
    {
        RiskLevel.Sain => "Sain",
        RiskLevel.Faible => "Faible",
        RiskLevel.Moyen => "Moyen",
        RiskLevel.Eleve => "Élevé",
        RiskLevel.Critique => "Critique",
        _ => "Inconnu"
    };

    /// <summary>Recommandation affichee a l'utilisateur.</summary>
    public static string Recommandation(this RiskLevel niveau) => niveau switch
    {
        RiskLevel.Sain => "Aucune action requise.",
        RiskLevel.Faible => "Aucune action requise. Conservez le fichier si vous en connaissez l'origine.",
        RiskLevel.Moyen => "Vérifiez l'origine du fichier avant de l'exécuter.",
        RiskLevel.Eleve => "N'exécutez pas ce fichier. Mise en quarantaine recommandée.",
        RiskLevel.Critique => "N'exécutez pas ce fichier. Mettez-le en quarantaine et faites une analyse complète avec Microsoft Defender.",
        _ => string.Empty
    };

    /// <summary>Couleur indicative (hexadecimal) pour l'interface.</summary>
    public static string Couleur(this RiskLevel niveau) => niveau switch
    {
        RiskLevel.Sain => "#2E7D32",
        RiskLevel.Faible => "#7CB342",
        RiskLevel.Moyen => "#F9A825",
        RiskLevel.Eleve => "#EF6C00",
        RiskLevel.Critique => "#C62828",
        _ => "#616161"
    };
}
