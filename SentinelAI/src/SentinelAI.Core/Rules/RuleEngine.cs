using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Rules;

/// <summary>
/// Moteur de regles locales. Charge les regles integrees (ressource embarquee)
/// puis, si presents, les fichiers .json du dossier de regles de l'utilisateur.
/// Aucune connexion reseau n'est effectuee : l'analyse reste entierement locale.
/// </summary>
public sealed class RuleEngine
{
    private const string RessourceIntegree = "SentinelAI.Core.Rules.regles-par-defaut.json";
    private const int TailleMaxPreuve = 120;

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly List<LocalRule> _regles;

    public RuleEngine(IEnumerable<LocalRule> regles)
    {
        _regles = [.. regles];
    }

    public IReadOnlyList<LocalRule> Regles => _regles;

    public int Nombre => _regles.Count;

    /// <summary>Charge les regles integrees, completees par celles du dossier utilisateur.</summary>
    public static RuleEngine Charger(string? dossierRegles = null)
    {
        var regles = new List<LocalRule>(ChargerIntegrees());
        var dossier = dossierRegles ?? SentinelPaths.RulesDirectory;

        if (Directory.Exists(dossier))
        {
            foreach (var fichier in Directory.EnumerateFiles(dossier, "*.json", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var jeu = JsonSerializer.Deserialize<RuleSet>(File.ReadAllText(fichier), Options);
                    if (jeu?.Regles is { Length: > 0 })
                    {
                        // Une regle utilisateur portant un identifiant existant remplace la regle integree.
                        foreach (var regle in jeu.Regles)
                        {
                            regles.RemoveAll(r => string.Equals(r.Id, regle.Id, StringComparison.OrdinalIgnoreCase));
                            regles.Add(regle);
                        }
                    }
                }
                catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
                {
                    // Un fichier de regles invalide ne doit pas empecher l'analyse.
                }
            }
        }

        return new RuleEngine(regles);
    }

    public static IReadOnlyList<LocalRule> ChargerIntegrees()
    {
        using var flux = Assembly.GetExecutingAssembly().GetManifestResourceStream(RessourceIntegree)
            ?? throw new InvalidOperationException($"Ressource de règles introuvable : {RessourceIntegree}");

        var jeu = JsonSerializer.Deserialize<RuleSet>(flux, Options);
        return jeu?.Regles ?? [];
    }

    /// <summary>Evalue toutes les regles applicables sur le texte extrait du fichier.</summary>
    public IReadOnlyList<RuleHit> Evaluer(string texte, FileCategory categorie, string extension)
    {
        if (string.IsNullOrEmpty(texte))
        {
            return [];
        }

        var resultats = new List<RuleHit>();

        foreach (var regle in _regles)
        {
            if (!regle.S_applique(categorie, extension))
            {
                continue;
            }

            var motifsTrouves = 0;
            var occurrences = 0;
            string? premierExtrait = null;

            foreach (var expression in regle.Compiler())
            {
                try
                {
                    var correspondances = expression.Matches(texte);
                    if (correspondances.Count == 0)
                    {
                        continue;
                    }

                    motifsTrouves++;
                    occurrences += correspondances.Count;
                    premierExtrait ??= Neutraliser(correspondances[0].Value);
                }
                catch (RegexMatchTimeoutException)
                {
                    // Un motif trop couteux sur ce fichier est ignore : l'analyse continue.
                }
            }

            if (motifsTrouves >= Math.Max(1, regle.MotifsRequis))
            {
                resultats.Add(new RuleHit
                {
                    Id = regle.Id,
                    Nom = regle.Nom,
                    Description = regle.Description,
                    Poids = regle.Poids,
                    Source = HitSource.Contenu,
                    Occurrences = occurrences,
                    Preuve = premierExtrait
                });
            }
        }

        return resultats;
    }

    /// <summary>
    /// Tronque l'extrait et retire les caracteres de controle : la preuve est affichee
    /// dans l'interface et ecrite dans le journal, elle ne doit jamais casser l'affichage.
    /// </summary>
    internal static string Neutraliser(string extrait)
    {
        var propre = new string([.. extrait.Where(c => !char.IsControl(c))]).Trim();
        return propre.Length <= TailleMaxPreuve ? propre : propre[..TailleMaxPreuve] + "…";
    }
}
