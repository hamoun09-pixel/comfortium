using System.Security.Cryptography;

namespace SentinelAI.Core.Analysis;

/// <summary>Calcul d'empreintes cryptographiques avec les bibliotheques standard de .NET.</summary>
public sealed class FileHasher
{
    private const int BufferSize = 1024 * 1024;

    /// <summary>SHA-256 d'un fichier, en flux, sans le charger entierement en memoire.</summary>
    public async Task<string> Sha256Async(string chemin, CancellationToken cancellationToken = default)
    {
        await using var flux = new FileStream(
            chemin,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        var empreinte = await SHA256.HashDataAsync(flux, cancellationToken).ConfigureAwait(false);
        return Convert.ToHexStringLower(empreinte);
    }

    /// <summary>SHA-256 d'un contenu deja en memoire.</summary>
    public static string Sha256(ReadOnlySpan<byte> contenu) =>
        Convert.ToHexStringLower(SHA256.HashData(contenu));
}
