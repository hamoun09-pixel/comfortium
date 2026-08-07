using SentinelAI.Core.Models;

namespace SentinelAI.Core.Analysis;

/// <summary>Verification de la signature numerique d'un fichier.</summary>
public interface IAuthenticodeVerifier
{
    /// <summary>Vrai si la verification est possible sur la plateforme courante.</summary>
    bool Disponible { get; }

    SignatureInfo Verifier(string chemin);
}

/// <summary>Implementation neutre utilisee hors Windows (developpement, tests, integration continue).</summary>
public sealed class UnsupportedAuthenticodeVerifier : IAuthenticodeVerifier
{
    public bool Disponible => false;

    public SignatureInfo Verifier(string chemin) =>
        SignatureInfo.Inconnue("Vérification de signature disponible uniquement sous Windows.");
}

/// <summary>Fabrique le verificateur adapte au systeme courant.</summary>
public static class AuthenticodeVerifierFactory
{
    public static IAuthenticodeVerifier Create() =>
        OperatingSystem.IsWindows() ? new WindowsAuthenticodeVerifier() : new UnsupportedAuthenticodeVerifier();
}
