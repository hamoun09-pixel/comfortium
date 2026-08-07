using SentinelAI.Core.Models;

namespace SentinelAI.Core.Rules;

/// <summary>
/// Liste locale d'empreintes SHA-256 connues comme malveillantes.
/// Format du fichier : une entree par ligne, « empreinte;nom de la menace ».
/// Les lignes vides et celles commencant par # sont ignorees.
/// </summary>
public sealed class HashBlocklist
{
    private readonly Dictionary<string, string> _empreintes;

    public HashBlocklist(IDictionary<string, string>? empreintes = null)
    {
        _empreintes = empreintes is null
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(empreintes, StringComparer.OrdinalIgnoreCase);
    }

    public int Nombre => _empreintes.Count;

    public static HashBlocklist Charger(string? fichier = null)
    {
        var chemin = fichier ?? SentinelPaths.BlocklistFile;
        var empreintes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (!File.Exists(chemin))
        {
            return new HashBlocklist(empreintes);
        }

        try
        {
            foreach (var ligne in File.ReadLines(chemin))
            {
                var contenu = ligne.Trim();
                if (contenu.Length == 0 || contenu[0] == '#')
                {
                    continue;
                }

                var separateur = contenu.IndexOf(';');
                var empreinte = (separateur < 0 ? contenu : contenu[..separateur]).Trim();
                var nom = separateur < 0 ? "Menace connue" : contenu[(separateur + 1)..].Trim();

                if (empreinte.Length == 64)
                {
                    empreintes[empreinte] = nom.Length == 0 ? "Menace connue" : nom;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Liste illisible : l'analyse continue sans elle.
        }

        return new HashBlocklist(empreintes);
    }

    /// <summary>Renvoie l'indicateur correspondant si l'empreinte est repertoriee.</summary>
    public RuleHit? Verifier(string? sha256)
    {
        if (string.IsNullOrEmpty(sha256) || !_empreintes.TryGetValue(sha256, out var nom))
        {
            return null;
        }

        return new RuleHit
        {
            Id = "HASH-001",
            Nom = "Empreinte répertoriée comme malveillante",
            Description = "L'empreinte SHA-256 de ce fichier figure dans la liste locale des menaces connues.",
            Poids = 100,
            Source = HitSource.Empreinte,
            Preuve = nom
        };
    }

    /// <summary>Ajoute une empreinte a la liste locale et l'enregistre.</summary>
    public void Ajouter(string sha256, string nom, string? fichier = null)
    {
        if (sha256.Length != 64)
        {
            throw new ArgumentException("Une empreinte SHA-256 doit comporter 64 caractères hexadécimaux.", nameof(sha256));
        }

        _empreintes[sha256] = nom;

        var chemin = fichier ?? SentinelPaths.BlocklistFile;
        Directory.CreateDirectory(Path.GetDirectoryName(chemin)!);
        File.AppendAllText(chemin, $"{sha256.ToLowerInvariant()};{nom}{Environment.NewLine}");
    }
}
