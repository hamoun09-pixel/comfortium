namespace SentinelAI.Core;

/// <summary>
/// Emplacements de stockage de SentinelAI.
/// Sous Windows : %ProgramData%\SentinelAI (partage machine, protege par ACL a l'installation).
/// Ailleurs (tests, developpement) : ~/.local/share/sentinelai.
/// La variable d'environnement SENTINELAI_DATA remplace le chemin racine.
/// </summary>
public static class SentinelPaths
{
    public const string DataDirectoryVariable = "SENTINELAI_DATA";

    private static string? _overrideRoot;

    /// <summary>Force la racine des donnees (utilise par les tests et le mode portable).</summary>
    public static void OverrideRoot(string? root) => _overrideRoot = root;

    public static string Root
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(_overrideRoot))
            {
                return _overrideRoot!;
            }

            var fromEnvironment = Environment.GetEnvironmentVariable(DataDirectoryVariable);
            if (!string.IsNullOrWhiteSpace(fromEnvironment))
            {
                return fromEnvironment!;
            }

            if (OperatingSystem.IsWindows())
            {
                var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                return Path.Combine(programData, "SentinelAI");
            }

            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, ".local", "share", "sentinelai");
        }
    }

    /// <summary>Base SQLite locale.</summary>
    public static string DatabaseFile => Path.Combine(Root, "sentinelai.db");

    /// <summary>Journaux JSONL horodates.</summary>
    public static string JournalDirectory => Path.Combine(Root, "journaux");

    /// <summary>Coffre de quarantaine (contenu chiffre).</summary>
    public static string QuarantineDirectory => Path.Combine(Root, "quarantaine");

    /// <summary>Cles locales (protegees par DPAPI sous Windows).</summary>
    public static string KeyDirectory => Path.Combine(Root, "cles");

    /// <summary>Regles locales ajoutees par l'utilisateur (fusionnees avec les regles integrees).</summary>
    public static string RulesDirectory => Path.Combine(Root, "regles");

    /// <summary>Liste locale d'empreintes SHA-256 connues comme malveillantes.</summary>
    public static string BlocklistFile => Path.Combine(RulesDirectory, "empreintes-bloquees.txt");

    /// <summary>Cree l'arborescence si necessaire et renvoie la racine.</summary>
    public static string EnsureCreated()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(JournalDirectory);
        Directory.CreateDirectory(QuarantineDirectory);
        Directory.CreateDirectory(KeyDirectory);
        Directory.CreateDirectory(RulesDirectory);
        return Root;
    }
}
