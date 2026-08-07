using System.Runtime.Versioning;
using System.Security.Cryptography;

namespace SentinelAI.Core.Quarantine;

/// <summary>
/// Cle locale du coffre de quarantaine.
/// Sous Windows, la cle est protegee par DPAPI (portee machine) : le fichier de cle
/// ne peut etre dechiffre que sur ce poste. Ailleurs, elle est stockee dans un fichier
/// aux droits restreints — suffisant pour le developpement et les tests.
/// </summary>
public static class VaultKey
{
    private const int TailleCle = 32;
    private static readonly byte[] Entropie = "SentinelAI.Quarantaine.v1"u8.ToArray();

    public static byte[] ObtenirOuCreer(string? fichierCle = null)
    {
        var chemin = fichierCle ?? Path.Combine(SentinelPaths.KeyDirectory, "quarantaine.key");
        Directory.CreateDirectory(Path.GetDirectoryName(chemin)!);

        if (File.Exists(chemin))
        {
            var stockee = File.ReadAllBytes(chemin);
            var cle = Deproteger(stockee);
            if (cle.Length == TailleCle)
            {
                return cle;
            }
        }

        var nouvelle = RandomNumberGenerator.GetBytes(TailleCle);
        File.WriteAllBytes(chemin, Proteger(nouvelle));
        RestreindreDroits(chemin);
        return nouvelle;
    }

    private static byte[] Proteger(byte[] cle) =>
        OperatingSystem.IsWindows() ? ProtegerDpapi(cle) : cle;

    private static byte[] Deproteger(byte[] stockee)
    {
        if (!OperatingSystem.IsWindows())
        {
            return stockee;
        }

        try
        {
            return DeprotegerDpapi(stockee);
        }
        catch (CryptographicException)
        {
            // Cle illisible (poste different, profil recree) : elle sera regeneree.
            return [];
        }
    }

    [SupportedOSPlatform("windows")]
    private static byte[] ProtegerDpapi(byte[] cle) =>
        ProtectedData.Protect(cle, Entropie, DataProtectionScope.LocalMachine);

    [SupportedOSPlatform("windows")]
    private static byte[] DeprotegerDpapi(byte[] stockee) =>
        ProtectedData.Unprotect(stockee, Entropie, DataProtectionScope.LocalMachine);

    private static void RestreindreDroits(string chemin)
    {
        try
        {
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(chemin, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            // Les droits stricts sont appliques par le script d'installation sous Windows.
        }
    }
}
