using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Rules;

/// <summary>Regle locale de detection appliquee au contenu d'un fichier.</summary>
public sealed class LocalRule
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("nom")]
    public required string Nom { get; init; }

    [JsonPropertyName("description")]
    public string Description { get; init; } = string.Empty;

    /// <summary>Famille de la regle : « obfuscation », « persistance », « exfiltration »...</summary>
    [JsonPropertyName("categorie")]
    public string Categorie { get; init; } = "generique";

    /// <summary>Poids ajoute au score quand la regle se declenche.</summary>
    [JsonPropertyName("poids")]
    public int Poids { get; init; } = 10;

    /// <summary>Categories de fichiers concernees. « * » pour toutes.</summary>
    [JsonPropertyName("cibles")]
    public string[] Cibles { get; init; } = ["*"];

    /// <summary>Restriction supplementaire par extension (vide = pas de restriction).</summary>
    [JsonPropertyName("extensions")]
    public string[] Extensions { get; init; } = [];

    /// <summary>Motifs recherches dans le contenu.</summary>
    [JsonPropertyName("motifs")]
    public string[] Motifs { get; init; } = [];

    /// <summary>Les motifs sont des expressions regulieres (sinon recherche litterale).</summary>
    [JsonPropertyName("regex")]
    public bool Regex { get; init; }

    [JsonPropertyName("sensibleCasse")]
    public bool SensibleCasse { get; init; }

    /// <summary>Nombre de motifs distincts a trouver pour declencher la regle.</summary>
    [JsonPropertyName("motifsRequis")]
    public int MotifsRequis { get; init; } = 1;

    [JsonPropertyName("active")]
    public bool Active { get; init; } = true;

    [JsonIgnore]
    private Regex[]? _compiles;

    /// <summary>Vrai si la regle s'applique au fichier decrit.</summary>
    public bool S_applique(FileCategory categorie, string extension)
    {
        if (!Active)
        {
            return false;
        }

        if (Extensions.Length > 0 &&
            !Extensions.Contains(extension, StringComparer.OrdinalIgnoreCase))
        {
            return false;
        }

        if (Cibles.Length == 0 || Cibles.Contains("*"))
        {
            return true;
        }

        return Cibles.Contains(categorie.ToString(), StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Expressions compilees, mises en cache au premier usage.</summary>
    public Regex[] Compiler()
    {
        if (_compiles is not null)
        {
            return _compiles;
        }

        var options = RegexOptions.CultureInvariant | RegexOptions.Compiled;
        if (!SensibleCasse)
        {
            options |= RegexOptions.IgnoreCase;
        }

        var compiles = new List<Regex>(Motifs.Length);
        foreach (var motif in Motifs)
        {
            var expression = Regex ? motif : System.Text.RegularExpressions.Regex.Escape(motif);
            try
            {
                compiles.Add(new Regex(expression, options, TimeSpan.FromSeconds(2)));
            }
            catch (ArgumentException)
            {
                // Une regle mal formee est ignoree plutot que de faire echouer l'analyse complete.
            }
        }

        _compiles = [.. compiles];
        return _compiles;
    }
}

/// <summary>Fichier de regles (format JSON).</summary>
public sealed class RuleSet
{
    [JsonPropertyName("version")]
    public string Version { get; init; } = "0.1";

    [JsonPropertyName("source")]
    public string Source { get; init; } = "intégrées";

    [JsonPropertyName("regles")]
    public LocalRule[] Regles { get; init; } = [];
}
