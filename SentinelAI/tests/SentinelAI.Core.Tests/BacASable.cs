using SentinelAI.Core;

namespace SentinelAI.Core.Tests;

/// <summary>
/// Dossier temporaire isole : chaque test dispose de sa propre racine de donnees,
/// ce qui evite toute interference avec une installation reelle de SentinelAI.
/// </summary>
public sealed class BacASable : IDisposable
{
    public BacASable()
    {
        Racine = Path.Combine(Path.GetTempPath(), "sentinelai-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Racine);
        SentinelPaths.OverrideRoot(Racine);
        SentinelPaths.EnsureCreated();
    }

    public string Racine { get; }

    /// <summary>Cree un fichier de test et renvoie son chemin complet.</summary>
    public string Ecrire(string nom, string contenu)
    {
        var chemin = Path.Combine(Racine, nom);
        Directory.CreateDirectory(Path.GetDirectoryName(chemin)!);
        File.WriteAllText(chemin, contenu);
        return chemin;
    }

    public string EcrireOctets(string nom, byte[] contenu)
    {
        var chemin = Path.Combine(Racine, nom);
        Directory.CreateDirectory(Path.GetDirectoryName(chemin)!);
        File.WriteAllBytes(chemin, contenu);
        return chemin;
    }

    public void Dispose()
    {
        SentinelPaths.OverrideRoot(null);

        try
        {
            Directory.Delete(Racine, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Le dossier temporaire sera nettoye par le systeme.
        }
    }
}
