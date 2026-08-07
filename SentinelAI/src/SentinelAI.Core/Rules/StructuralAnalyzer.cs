using SentinelAI.Core.Analysis;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Rules;

/// <summary>
/// Indicateurs qui ne dependent pas du contenu : nom, extension, emplacement,
/// attributs, coherence entre le type annonce et le type reel.
/// Ce sont souvent les signaux les plus fiables et les moins couteux.
/// </summary>
public sealed class StructuralAnalyzer
{
    /// <summary>Caractere de reecriture droite-a-gauche, utilise pour maquiller une extension.</summary>
    private const char MarqueRtl = '‮';

    private static readonly string[] ExtensionsTrompeuses =
        [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".jpg", ".jpeg", ".png", ".mp4", ".zip", ".rar"];

    private static readonly string[] DossiersVolatils =
        ["\\temp\\", "\\tmp\\", "\\appdata\\local\\temp\\", "\\downloads\\", "\\téléchargements\\",
         "\\windows\\temp\\", "\\programdata\\", "\\public\\", "\\recycle"];

    public IReadOnlyList<RuleHit> Analyser(FileInfo fichier, FileTypeVerdict type)
    {
        var indicateurs = new List<RuleHit>();
        var nom = fichier.Name;

        // Les motifs de dossiers sont ecrits a la Windows ; on normalise le separateur
        // pour que la comparaison fonctionne aussi hors Windows (tests, integration continue).
        var cheminMinuscule = fichier.FullName.ToLowerInvariant().Replace('/', '\\');

        if (type.Incoherence)
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-TYPE-001",
                Nom = "Type réel différent de l'extension",
                Description = "Le contenu du fichier ne correspond pas à ce que son extension annonce. Un exécutable renommé est une technique de dissimulation courante.",
                Poids = type.TypeReel == "PE" ? 40 : 20,
                Source = HitSource.Structure,
                Preuve = type.DetailIncoherence
            });
        }

        if (nom.Contains(MarqueRtl))
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-NOM-001",
                Nom = "Caractère d'inversion d'écriture dans le nom",
                Description = "Le nom contient U+202E, qui inverse l'affichage des caractères suivants et permet de faire passer « exe » pour « txt ».",
                Poids = 50,
                Source = HitSource.Structure,
                Preuve = nom.Replace(MarqueRtl.ToString(), "[U+202E]")
            });
        }

        var doubleExtension = DetecterDoubleExtension(nom);
        if (doubleExtension is not null)
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-NOM-002",
                Nom = "Double extension trompeuse",
                Description = "Le nom fait croire à un document alors que le fichier est exécutable.",
                Poids = 35,
                Source = HitSource.Structure,
                Preuve = doubleExtension
            });
        }

        if (nom.Contains("        ", StringComparison.Ordinal))
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-NOM-003",
                Nom = "Espaces de remplissage dans le nom",
                Description = "Une longue suite d'espaces repousse l'extension réelle hors de la zone visible de l'Explorateur.",
                Poids = 25,
                Source = HitSource.Structure
            });
        }

        if (type.Sensible && DossiersVolatils.Any(d => cheminMinuscule.Contains(d, StringComparison.Ordinal)))
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-EMP-001",
                Nom = "Fichier exécutable dans un dossier temporaire",
                Description = "Les dossiers temporaires et de téléchargement servent de point de dépôt aux charges utiles.",
                Poids = 10,
                Source = HitSource.Structure,
                Preuve = Path.GetDirectoryName(fichier.FullName)
            });
        }

        if (type.Sensible && fichier.Attributes.HasFlag(FileAttributes.Hidden))
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-ATT-001",
                Nom = "Fichier exécutable masqué",
                Description = "Le fichier porte l'attribut « caché » alors qu'il contient du code exécutable.",
                Poids = 20,
                Source = HitSource.Structure
            });
        }

        if (type.Sensible && fichier.Attributes.HasFlag(FileAttributes.System) && !EstDansWindows(cheminMinuscule))
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-ATT-002",
                Nom = "Attribut système hors du dossier Windows",
                Description = "L'attribut « système » masque le fichier dans l'Explorateur ; il est inhabituel en dehors du dossier Windows.",
                Poids = 20,
                Source = HitSource.Structure
            });
        }

        if (type.Categorie == FileCategory.Executable && fichier.Length is > 0 and < 8 * 1024)
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-TAI-001",
                Nom = "Exécutable de très petite taille",
                Description = "Un exécutable de moins de 8 Ko est souvent un simple téléchargeur (« dropper »).",
                Poids = 12,
                Source = HitSource.Structure,
                Preuve = $"{fichier.Length} octets"
            });
        }

        if (EstFluxInternet(fichier.FullName, out var origine))
        {
            indicateurs.Add(new RuleHit
            {
                Id = "STR-ZON-001",
                Nom = "Fichier téléchargé depuis Internet",
                Description = "Le marqueur de zone indique une provenance Internet. Ce n'est pas dangereux en soi, mais cela renforce les autres indicateurs.",
                Poids = type.Sensible ? 8 : 3,
                Source = HitSource.Structure,
                Preuve = origine
            });
        }

        return indicateurs;
    }

    private static bool EstDansWindows(string cheminMinuscule) =>
        cheminMinuscule.Contains("\\windows\\", StringComparison.Ordinal);

    /// <summary>Detecte « facture.pdf.exe » et ses variantes.</summary>
    internal static string? DetecterDoubleExtension(string nom)
    {
        var extension = Path.GetExtension(nom);
        if (extension.Length == 0 || !FileTypeInspector.ExtensionsSensibles.Contains(extension))
        {
            return null;
        }

        var sansExtension = Path.GetFileNameWithoutExtension(nom);
        var precedente = Path.GetExtension(sansExtension);

        return ExtensionsTrompeuses.Contains(precedente, StringComparer.OrdinalIgnoreCase)
            ? $"« {nom} » se présente comme un fichier {precedente} mais est un fichier {extension}"
            : null;
    }

    /// <summary>
    /// Lit le flux de donnees alternatif Zone.Identifier, ecrit par Windows sur les
    /// fichiers provenant d'Internet. Disponible uniquement sur NTFS/Windows.
    /// </summary>
    private static bool EstFluxInternet(string chemin, out string? origine)
    {
        origine = null;

        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        try
        {
            var fluxZone = chemin + ":Zone.Identifier";
            if (!File.Exists(fluxZone))
            {
                return false;
            }

            foreach (var ligne in File.ReadLines(fluxZone))
            {
                if (ligne.StartsWith("HostUrl=", StringComparison.OrdinalIgnoreCase) ||
                    ligne.StartsWith("ReferrerUrl=", StringComparison.OrdinalIgnoreCase))
                {
                    origine = RuleEngine.Neutraliser(ligne);
                    return true;
                }

                if (ligne.StartsWith("ZoneId=3", StringComparison.OrdinalIgnoreCase))
                {
                    origine = "zone Internet";
                }
            }

            return origine is not null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException or ArgumentException)
        {
            return false;
        }
    }
}
