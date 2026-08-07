namespace SentinelAI.Core.Models;

/// <summary>Famille de fichier deduite de l'extension et du contenu reel.</summary>
public enum FileCategory
{
    /// <summary>Type non classe.</summary>
    Autre = 0,

    /// <summary>Executable natif ou .NET (.exe, .scr, .com).</summary>
    Executable,

    /// <summary>Bibliotheque chargeable (.dll, .ocx, .sys).</summary>
    Bibliotheque,

    /// <summary>Paquet d'installation (.msi, .msp, .msix, .appx).</summary>
    Installeur,

    /// <summary>Script interprete (.ps1, .bat, .cmd, .js, .vbs, .hta, .psm1...).</summary>
    Script,

    /// <summary>Raccourci ou fichier de commande indirecte (.lnk, .url, .scf).</summary>
    Raccourci,

    /// <summary>Archive (.zip, .7z, .rar, .cab, .iso).</summary>
    Archive,

    /// <summary>Document bureautique ou PDF.</summary>
    Document
}

public static class FileCategoryExtensions
{
    public static string Libelle(this FileCategory categorie) => categorie switch
    {
        FileCategory.Executable => "Exécutable",
        FileCategory.Bibliotheque => "Bibliothèque",
        FileCategory.Installeur => "Installeur",
        FileCategory.Script => "Script",
        FileCategory.Raccourci => "Raccourci",
        FileCategory.Archive => "Archive",
        FileCategory.Document => "Document",
        _ => "Autre"
    };
}
