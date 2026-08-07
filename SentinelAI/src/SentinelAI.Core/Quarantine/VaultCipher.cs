using System.Buffers.Binary;
using System.Security.Cryptography;

namespace SentinelAI.Core.Quarantine;

/// <summary>
/// Chiffrement du coffre de quarantaine : AES-256-GCM par blocs.
/// Le contenu mis en quarantaine est chiffre pour deux raisons : il ne peut plus
/// etre execute par accident, et il n'est plus detecte comme menace par les autres
/// outils de securite installes sur le poste.
/// </summary>
public static class VaultCipher
{
    private static readonly byte[] Magie = "SNTQ"u8.ToArray();
    private const byte Version = 1;
    private const int TailleBloc = 64 * 1024;
    private const int TailleNonce = 12;
    private const int TailleTag = 16;

    /// <summary>Chiffre <paramref name="source"/> vers <paramref name="destination"/>.</summary>
    public static async Task ChiffrerAsync(
        string source,
        string destination,
        byte[] cle,
        CancellationToken cancellationToken = default)
    {
        var nonceBase = RandomNumberGenerator.GetBytes(TailleNonce);

        await using var entree = new FileStream(source, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, TailleBloc, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var sortie = new FileStream(destination, FileMode.Create, FileAccess.Write,
            FileShare.None, TailleBloc, FileOptions.Asynchronous);

        await sortie.WriteAsync(Magie, cancellationToken).ConfigureAwait(false);
        await sortie.WriteAsync(new[] { Version }, cancellationToken).ConfigureAwait(false);
        await sortie.WriteAsync(nonceBase, cancellationToken).ConfigureAwait(false);

        using var aes = new AesGcm(cle, TailleTag);
        var clair = new byte[TailleBloc];
        var chiffre = new byte[TailleBloc];
        var tag = new byte[TailleTag];
        var entete = new byte[4];
        var compteur = 0L;

        while (true)
        {
            var lus = await entree.ReadAsync(clair.AsMemory(0, TailleBloc), cancellationToken).ConfigureAwait(false);
            if (lus == 0)
            {
                break;
            }

            var nonce = NoncePourBloc(nonceBase, compteur++);
            aes.Encrypt(nonce, clair.AsSpan(0, lus), chiffre.AsSpan(0, lus), tag);

            BinaryPrimitives.WriteInt32LittleEndian(entete, lus);
            await sortie.WriteAsync(entete, cancellationToken).ConfigureAwait(false);
            await sortie.WriteAsync(chiffre.AsMemory(0, lus), cancellationToken).ConfigureAwait(false);
            await sortie.WriteAsync(tag, cancellationToken).ConfigureAwait(false);
        }

        // Bloc de longueur nulle : marque de fin, empeche la troncature silencieuse.
        BinaryPrimitives.WriteInt32LittleEndian(entete, 0);
        await sortie.WriteAsync(entete, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Dechiffre le coffre vers <paramref name="destination"/>.</summary>
    public static async Task DechiffrerAsync(
        string source,
        string destination,
        byte[] cle,
        CancellationToken cancellationToken = default)
    {
        await using var entree = new FileStream(source, FileMode.Open, FileAccess.Read,
            FileShare.Read, TailleBloc, FileOptions.Asynchronous | FileOptions.SequentialScan);

        var magie = new byte[Magie.Length];
        await entree.ReadExactlyAsync(magie, cancellationToken).ConfigureAwait(false);
        if (!magie.AsSpan().SequenceEqual(Magie))
        {
            throw new InvalidDataException("Fichier de quarantaine non reconnu.");
        }

        var version = new byte[1];
        await entree.ReadExactlyAsync(version, cancellationToken).ConfigureAwait(false);
        if (version[0] != Version)
        {
            throw new InvalidDataException($"Version de coffre non prise en charge : {version[0]}.");
        }

        var nonceBase = new byte[TailleNonce];
        await entree.ReadExactlyAsync(nonceBase, cancellationToken).ConfigureAwait(false);

        await using var sortie = new FileStream(destination, FileMode.Create, FileAccess.Write,
            FileShare.None, TailleBloc, FileOptions.Asynchronous);

        using var aes = new AesGcm(cle, TailleTag);
        var entete = new byte[4];
        var chiffre = new byte[TailleBloc];
        var clair = new byte[TailleBloc];
        var tag = new byte[TailleTag];
        var compteur = 0L;

        while (true)
        {
            var lus = await entree.ReadAtLeastAsync(entete, 4, throwOnEndOfStream: false, cancellationToken)
                .ConfigureAwait(false);
            if (lus < 4)
            {
                throw new InvalidDataException("Fichier de quarantaine tronqué.");
            }

            var taille = BinaryPrimitives.ReadInt32LittleEndian(entete);
            if (taille == 0)
            {
                break;
            }

            if (taille < 0 || taille > TailleBloc)
            {
                throw new InvalidDataException("Fichier de quarantaine corrompu.");
            }

            await entree.ReadExactlyAsync(chiffre.AsMemory(0, taille), cancellationToken).ConfigureAwait(false);
            await entree.ReadExactlyAsync(tag, cancellationToken).ConfigureAwait(false);

            var nonce = NoncePourBloc(nonceBase, compteur++);
            aes.Decrypt(nonce, chiffre.AsSpan(0, taille), tag, clair.AsSpan(0, taille));

            await sortie.WriteAsync(clair.AsMemory(0, taille), cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Nonce unique par bloc : les 8 derniers octets portent le numero de bloc.
    /// Un nonce reutilise avec la meme cle romprait completement la garantie d'AES-GCM.
    /// </summary>
    private static byte[] NoncePourBloc(byte[] nonceBase, long compteur)
    {
        var nonce = new byte[TailleNonce];
        nonceBase.CopyTo(nonce, 0);

        Span<byte> numero = stackalloc byte[8];
        BinaryPrimitives.WriteInt64LittleEndian(numero, compteur);
        for (var i = 0; i < 8; i++)
        {
            nonce[TailleNonce - 8 + i] ^= numero[i];
        }

        return nonce;
    }
}
