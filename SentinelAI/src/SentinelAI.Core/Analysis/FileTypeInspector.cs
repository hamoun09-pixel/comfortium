using System.Text;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Analysis;

/// <summary>Ce que l'inspection des premiers octets a permis de deduire.</summary>
public sealed class FileTypeVerdict
{
    public required string Extension { get; init; }

    public FileCategory Categorie { get; init; }

    public bool Sensible { get; init; }

    /// <summary>Type reel deduit de l'en-tete (« PE », « ZIP/OOXML », « PDF », « Script/texte »...).</summary>
    public string? TypeReel { get; init; }

    /// <summary>Vrai si le contenu ne correspond pas a ce que l'extension annonce.</summary>
    public bool Incoherence { get; init; }

    public string? DetailIncoherence { get; init; }
}

/// <summary>
/// Classement des fichiers par extension et verification de coherence avec les octets d'en-tete.
/// Un exécutable renommé en « .txt » ou en « .jpg » est un signal fort : c'est ici qu'on le voit.
/// </summary>
public sealed class FileTypeInspector
{
    /// <summary>Types sensibles surveilles par la V0.1 (liste demandee) et variantes proches.</summary>
    public static readonly IReadOnlySet<string> ExtensionsSensibles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        // Demandes explicitement pour la V0.1
        ".exe", ".dll", ".msi", ".ps1", ".bat", ".cmd", ".js", ".vbs",
        // Variantes de la meme famille, traitees a l'identique
        ".com", ".scr", ".sys", ".ocx", ".cpl", ".msp", ".msix", ".appx",
        ".psm1", ".psd1", ".ps1xml", ".jse", ".vbe", ".wsf", ".wsh", ".hta",
        ".lnk", ".url", ".scf", ".reg", ".pif", ".msc", ".chm", ".jar"
    };

    private static readonly Dictionary<string, FileCategory> Categories = new(StringComparer.OrdinalIgnoreCase)
    {
        [".exe"] = FileCategory.Executable,
        [".com"] = FileCategory.Executable,
        [".scr"] = FileCategory.Executable,
        [".pif"] = FileCategory.Executable,
        [".dll"] = FileCategory.Bibliotheque,
        [".ocx"] = FileCategory.Bibliotheque,
        [".sys"] = FileCategory.Bibliotheque,
        [".cpl"] = FileCategory.Bibliotheque,
        [".msi"] = FileCategory.Installeur,
        [".msp"] = FileCategory.Installeur,
        [".msix"] = FileCategory.Installeur,
        [".appx"] = FileCategory.Installeur,
        [".ps1"] = FileCategory.Script,
        [".psm1"] = FileCategory.Script,
        [".psd1"] = FileCategory.Script,
        [".ps1xml"] = FileCategory.Script,
        [".bat"] = FileCategory.Script,
        [".cmd"] = FileCategory.Script,
        [".js"] = FileCategory.Script,
        [".jse"] = FileCategory.Script,
        [".vbs"] = FileCategory.Script,
        [".vbe"] = FileCategory.Script,
        [".wsf"] = FileCategory.Script,
        [".wsh"] = FileCategory.Script,
        [".hta"] = FileCategory.Script,
        [".reg"] = FileCategory.Script,
        [".msc"] = FileCategory.Script,
        [".jar"] = FileCategory.Script,
        [".lnk"] = FileCategory.Raccourci,
        [".url"] = FileCategory.Raccourci,
        [".scf"] = FileCategory.Raccourci,
        [".chm"] = FileCategory.Document,
        [".zip"] = FileCategory.Archive,
        [".7z"] = FileCategory.Archive,
        [".rar"] = FileCategory.Archive,
        [".cab"] = FileCategory.Archive,
        [".iso"] = FileCategory.Archive,
        [".gz"] = FileCategory.Archive,
        [".pdf"] = FileCategory.Document,
        [".doc"] = FileCategory.Document,
        [".docx"] = FileCategory.Document,
        [".docm"] = FileCategory.Document,
        [".xls"] = FileCategory.Document,
        [".xlsx"] = FileCategory.Document,
        [".xlsm"] = FileCategory.Document,
        [".ppt"] = FileCategory.Document,
        [".pptx"] = FileCategory.Document,
        [".rtf"] = FileCategory.Document
    };

    /// <summary>Extensions pour lesquelles la signature Authenticode a un sens.</summary>
    private static readonly HashSet<string> ExtensionsSignables = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".sys", ".ocx", ".cpl", ".scr", ".com", ".msi", ".msp", ".msix", ".appx",
        ".ps1", ".psm1", ".psd1", ".ps1xml", ".cat"
    };

    // Signatures binaires d'en-tete. Declarees en byte[] : une expression de collection
    // « [0xD0, 0xCF, ...] » serait inferee comme int[] et ne compilerait pas contre un span d'octets.
    private static readonly byte[] SignatureOle = [0xD0, 0xCF, 0x11, 0xE0];
    private static readonly byte[] SignatureLnk = [0x4C, 0x00, 0x00, 0x00];
    private static readonly byte[] Signature7z = [0x37, 0x7A, 0xBC, 0xAF];
    private static readonly byte[] SignatureGzip = [0x1F, 0x8B];
    private static readonly byte[] SignatureJpeg = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] SignaturePng = [0x89, 0x50, 0x4E, 0x47];

    public static bool EstSensible(string chemin) =>
        ExtensionsSensibles.Contains(Path.GetExtension(chemin));

    public static bool PeutEtreSigne(string chemin) =>
        ExtensionsSignables.Contains(Path.GetExtension(chemin));

    public static FileCategory CategoriePourExtension(string extension) =>
        Categories.TryGetValue(extension, out var categorie) ? categorie : FileCategory.Autre;

    /// <summary>Inspecte l'extension et les premiers octets pour classer le fichier.</summary>
    public FileTypeVerdict Inspecter(string chemin, ReadOnlySpan<byte> entete)
    {
        var extension = Path.GetExtension(chemin).ToLowerInvariant();
        var categorie = CategoriePourExtension(extension);
        var sensible = ExtensionsSensibles.Contains(extension);
        var typeReel = IdentifierEntete(entete);

        var (incoherence, detail) = ComparerTypeEtExtension(extension, categorie, typeReel);

        // Un contenu PE sous une extension inoffensive est traite comme un executable :
        // c'est bien du code, quel que soit le nom du fichier.
        if (incoherence && typeReel == "PE" && categorie is not (FileCategory.Executable or FileCategory.Bibliotheque))
        {
            categorie = FileCategory.Executable;
            sensible = true;
        }

        return new FileTypeVerdict
        {
            Extension = extension,
            Categorie = categorie,
            Sensible = sensible,
            TypeReel = typeReel,
            Incoherence = incoherence,
            DetailIncoherence = detail
        };
    }

    /// <summary>Identifie le format reel a partir des octets d'en-tete.</summary>
    public static string? IdentifierEntete(ReadOnlySpan<byte> entete)
    {
        if (entete.Length < 4)
        {
            return entete.Length == 0 ? "Vide" : null;
        }

        if (entete[0] == 'M' && entete[1] == 'Z')
        {
            return "PE";
        }

        if (entete[0] == 0x7F && entete[1] == 'E' && entete[2] == 'L' && entete[3] == 'F')
        {
            return "ELF";
        }

        if (entete[0] == 'P' && entete[1] == 'K' && (entete[2] == 3 || entete[2] == 5 || entete[2] == 7))
        {
            return "ZIP/OOXML";
        }

        if (entete.StartsWith("%PDF"u8))
        {
            return "PDF";
        }

        if (entete.StartsWith(SignatureOle))
        {
            return "OLE (Office 97-2003 / MSI)";
        }

        if (entete.StartsWith(SignatureLnk))
        {
            return "LNK";
        }

        if (entete.StartsWith("Rar!"u8))
        {
            return "RAR";
        }

        if (entete.StartsWith(Signature7z))
        {
            return "7Z";
        }

        if (entete.StartsWith("MSCF"u8))
        {
            return "CAB";
        }

        if (entete.StartsWith(SignatureGzip))
        {
            return "GZIP";
        }

        if (entete.StartsWith(SignatureJpeg))
        {
            return "JPEG";
        }

        if (entete.StartsWith(SignaturePng))
        {
            return "PNG";
        }

        return EstProbablementTexte(entete) ? "Script/texte" : null;
    }

    /// <summary>Heuristique simple : peu d'octets de controle et pas de zero isole.</summary>
    public static bool EstProbablementTexte(ReadOnlySpan<byte> donnees)
    {
        if (donnees.Length == 0)
        {
            return false;
        }

        // UTF-16 : un octet nul sur deux, ce qui reste du texte.
        if (donnees.Length >= 2 && (donnees[0] == 0xFF && donnees[1] == 0xFE || donnees[0] == 0xFE && donnees[1] == 0xFF))
        {
            return true;
        }

        var controle = 0;
        var examines = Math.Min(donnees.Length, 512);
        for (var i = 0; i < examines; i++)
        {
            var octet = donnees[i];
            if (octet == 0)
            {
                return false;
            }

            if (octet < 0x09 || (octet > 0x0D && octet < 0x20 && octet != 0x1B))
            {
                controle++;
            }
        }

        return controle * 100 / examines < 5;
    }

    private static (bool, string?) ComparerTypeEtExtension(string extension, FileCategory categorie, string? typeReel)
    {
        if (typeReel is null or "Vide")
        {
            return (false, null);
        }

        var attendu = categorie switch
        {
            FileCategory.Executable or FileCategory.Bibliotheque => "PE",
            FileCategory.Script => "Script/texte",
            FileCategory.Archive => "ZIP/OOXML",
            _ => null
        };

        // Les cas particuliers legitimes : MSI est un conteneur OLE, MSIX/APPX un ZIP,
        // JAR un ZIP, DOCX/XLSX un ZIP, un .reg peut etre en UTF-16.
        if (extension is ".msi" or ".msp" && typeReel.StartsWith("OLE", StringComparison.Ordinal))
        {
            return (false, null);
        }

        if (extension is ".msix" or ".appx" or ".jar" && typeReel == "ZIP/OOXML")
        {
            return (false, null);
        }

        if (categorie == FileCategory.Document && typeReel is "ZIP/OOXML" or "OLE (Office 97-2003 / MSI)" or "PDF" or "Script/texte")
        {
            return (false, null);
        }

        if (categorie == FileCategory.Archive && typeReel is "ZIP/OOXML" or "RAR" or "7Z" or "CAB" or "GZIP")
        {
            return (false, null);
        }

        if (extension == ".lnk" && typeReel == "LNK")
        {
            return (false, null);
        }

        if (attendu is not null && typeReel != attendu)
        {
            return (true, $"extension {extension} mais contenu de type {typeReel}");
        }

        // Contenu executable sous une extension qui n'annonce pas du code.
        if (typeReel == "PE" && categorie is not (FileCategory.Executable or FileCategory.Bibliotheque or FileCategory.Installeur))
        {
            return (true, $"contenu exécutable Windows (PE) sous l'extension {(string.IsNullOrEmpty(extension) ? "(aucune)" : extension)}");
        }

        return (false, null);
    }

    /// <summary>Lit les premiers octets d'un fichier pour l'identification de type.</summary>
    public static async Task<byte[]> LireEnteteAsync(string chemin, int octets = 512, CancellationToken cancellationToken = default)
    {
        await using var flux = new FileStream(
            chemin, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, octets, FileOptions.Asynchronous);

        var tampon = new byte[octets];
        var lus = await flux.ReadAsync(tampon.AsMemory(0, octets), cancellationToken).ConfigureAwait(false);
        return lus == octets ? tampon : tampon[..lus];
    }

    /// <summary>Encodage detecte a partir de la marque d'ordre des octets, sinon UTF-8.</summary>
    public static Encoding DetecterEncodage(ReadOnlySpan<byte> entete)
    {
        if (entete.Length >= 3 && entete[0] == 0xEF && entete[1] == 0xBB && entete[2] == 0xBF)
        {
            return new UTF8Encoding(false);
        }

        if (entete.Length >= 2 && entete[0] == 0xFF && entete[1] == 0xFE)
        {
            return Encoding.Unicode;
        }

        if (entete.Length >= 2 && entete[0] == 0xFE && entete[1] == 0xFF)
        {
            return Encoding.BigEndianUnicode;
        }

        return new UTF8Encoding(false);
    }
}
