using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography.X509Certificates;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Analysis;

/// <summary>
/// Verification Authenticode via WinVerifyTrust, avec repli sur les catalogues systeme.
/// Le repli est indispensable : la plupart des fichiers de Windows ne portent pas de
/// signature embarquee, ils sont signes dans un catalogue (.cat). Sans cette etape,
/// chaque DLL du systeme serait signalee « non signée ».
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsAuthenticodeVerifier : IAuthenticodeVerifier
{
    public bool Disponible => true;

    public SignatureInfo Verifier(string chemin)
    {
        if (!FileTypeInspector.PeutEtreSigne(chemin))
        {
            return SignatureInfo.NonApplicable();
        }

        try
        {
            var resultat = VerifierSignatureEmbarquee(chemin);

            if (resultat == NativeMethods.TRUST_E_NOSIGNATURE ||
                resultat == NativeMethods.TRUST_E_SUBJECT_FORM_UNKNOWN ||
                resultat == NativeMethods.TRUST_E_PROVIDER_UNKNOWN)
            {
                return VerifierViaCatalogue(chemin);
            }

            return Interpreter(resultat, LireCertificat(chemin), viaCatalogue: false);
        }
        catch (Exception ex)
        {
            return SignatureInfo.Inconnue($"Vérification impossible : {ex.Message}");
        }
    }

    private static uint VerifierSignatureEmbarquee(string chemin)
    {
        var infoFichier = new NativeMethods.WINTRUST_FILE_INFO
        {
            cbStruct = (uint)Marshal.SizeOf<NativeMethods.WINTRUST_FILE_INFO>(),
            pcwszFilePath = Marshal.StringToHGlobalUni(chemin),
            hFile = IntPtr.Zero,
            pgKnownSubject = IntPtr.Zero
        };

        var pointeurFichier = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.WINTRUST_FILE_INFO>());
        var pointeurDonnees = IntPtr.Zero;

        try
        {
            Marshal.StructureToPtr(infoFichier, pointeurFichier, false);

            var donnees = NativeMethods.WINTRUST_DATA.PourFichier(pointeurFichier);
            pointeurDonnees = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.WINTRUST_DATA>());
            Marshal.StructureToPtr(donnees, pointeurDonnees, false);

            var action = NativeMethods.WINTRUST_ACTION_GENERIC_VERIFY_V2;
            var resultat = NativeMethods.WinVerifyTrust(IntPtr.Zero, ref action, pointeurDonnees);

            FermerEtat(pointeurDonnees, ref action);
            return unchecked((uint)resultat);
        }
        finally
        {
            if (pointeurDonnees != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(pointeurDonnees);
            }

            Marshal.FreeHGlobal(infoFichier.pcwszFilePath);
            Marshal.FreeHGlobal(pointeurFichier);
        }
    }

    private static void FermerEtat(IntPtr pointeurDonnees, ref Guid action)
    {
        // WinVerifyTrust conserve un etat interne qu'il faut liberer explicitement.
        var donnees = Marshal.PtrToStructure<NativeMethods.WINTRUST_DATA>(pointeurDonnees);
        donnees.dwStateAction = NativeMethods.WTD_STATEACTION_CLOSE;
        Marshal.StructureToPtr(donnees, pointeurDonnees, false);
        NativeMethods.WinVerifyTrust(IntPtr.Zero, ref action, pointeurDonnees);
    }

    private static SignatureInfo VerifierViaCatalogue(string chemin)
    {
        var contexteAdmin = IntPtr.Zero;
        var contexteCatalogue = IntPtr.Zero;

        try
        {
            if (!NativeMethods.CryptCATAdminAcquireContext2(out contexteAdmin, IntPtr.Zero, "SHA256", IntPtr.Zero, 0))
            {
                return new SignatureInfo
                {
                    Status = SignatureStatus.NonSigne,
                    Message = "Aucune signature numérique embarquée et catalogues système inaccessibles."
                };
            }

            using var flux = new FileStream(chemin, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var handle = flux.SafeFileHandle.DangerousGetHandle();

            uint tailleEmpreinte = 0;
            NativeMethods.CryptCATAdminCalcHashFromFileHandle2(contexteAdmin, handle, ref tailleEmpreinte, null, 0);
            if (tailleEmpreinte == 0)
            {
                return SansSignature();
            }

            var empreinte = new byte[tailleEmpreinte];
            if (!NativeMethods.CryptCATAdminCalcHashFromFileHandle2(contexteAdmin, handle, ref tailleEmpreinte, empreinte, 0))
            {
                return SansSignature();
            }

            var precedent = IntPtr.Zero;
            contexteCatalogue = NativeMethods.CryptCATAdminEnumCatalogFromHash(contexteAdmin, empreinte, tailleEmpreinte, 0, ref precedent);
            if (contexteCatalogue == IntPtr.Zero)
            {
                return SansSignature();
            }

            var infoCatalogue = new NativeMethods.CATALOG_INFO
            {
                cbStruct = (uint)Marshal.SizeOf<NativeMethods.CATALOG_INFO>()
            };

            if (!NativeMethods.CryptCATCatalogInfoFromContext(contexteCatalogue, ref infoCatalogue, 0))
            {
                return SansSignature();
            }

            var etiquette = Convert.ToHexString(empreinte);
            var resultat = VerifierMembreDeCatalogue(chemin, infoCatalogue.wszCatalogFile, etiquette, empreinte, contexteAdmin, contexteCatalogue);

            X509Certificate2? certificat = null;
            try
            {
                certificat = LireCertificat(infoCatalogue.wszCatalogFile);
            }
            catch
            {
                // Le catalogue existe mais son certificat n'a pas pu etre lu : on garde le verdict.
            }

            return Interpreter(resultat, certificat, viaCatalogue: true);
        }
        catch (Exception ex)
        {
            return SignatureInfo.Inconnue($"Vérification du catalogue impossible : {ex.Message}");
        }
        finally
        {
            if (contexteCatalogue != IntPtr.Zero)
            {
                NativeMethods.CryptCATAdminReleaseCatalogContext(contexteAdmin, contexteCatalogue, 0);
            }

            if (contexteAdmin != IntPtr.Zero)
            {
                NativeMethods.CryptCATAdminReleaseContext(contexteAdmin, 0);
            }
        }
    }

    private static uint VerifierMembreDeCatalogue(
        string chemin,
        string cheminCatalogue,
        string etiquetteMembre,
        byte[] empreinte,
        IntPtr contexteAdmin,
        IntPtr contexteCatalogue)
    {
        var pointeurEmpreinte = Marshal.AllocHGlobal(empreinte.Length);
        var pointeurCatalogue = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.WINTRUST_CATALOG_INFO>());
        var pointeurDonnees = IntPtr.Zero;

        var info = new NativeMethods.WINTRUST_CATALOG_INFO
        {
            cbStruct = (uint)Marshal.SizeOf<NativeMethods.WINTRUST_CATALOG_INFO>(),
            dwCatalogVersion = 0,
            pcwszCatalogFilePath = Marshal.StringToHGlobalUni(cheminCatalogue),
            pcwszMemberTag = Marshal.StringToHGlobalUni(etiquetteMembre),
            pcwszMemberFilePath = Marshal.StringToHGlobalUni(chemin),
            hMemberFile = IntPtr.Zero,
            pbCalculatedFileHash = pointeurEmpreinte,
            cbCalculatedFileHash = (uint)empreinte.Length,
            pcCatalogContext = contexteCatalogue,
            hCatAdmin = contexteAdmin
        };

        try
        {
            Marshal.Copy(empreinte, 0, pointeurEmpreinte, empreinte.Length);
            Marshal.StructureToPtr(info, pointeurCatalogue, false);

            var donnees = NativeMethods.WINTRUST_DATA.PourCatalogue(pointeurCatalogue);
            pointeurDonnees = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.WINTRUST_DATA>());
            Marshal.StructureToPtr(donnees, pointeurDonnees, false);

            var action = NativeMethods.WINTRUST_ACTION_GENERIC_VERIFY_V2;
            var resultat = NativeMethods.WinVerifyTrust(IntPtr.Zero, ref action, pointeurDonnees);
            FermerEtat(pointeurDonnees, ref action);
            return unchecked((uint)resultat);
        }
        finally
        {
            if (pointeurDonnees != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(pointeurDonnees);
            }

            Marshal.FreeHGlobal(info.pcwszCatalogFilePath);
            Marshal.FreeHGlobal(info.pcwszMemberTag);
            Marshal.FreeHGlobal(info.pcwszMemberFilePath);
            Marshal.FreeHGlobal(pointeurEmpreinte);
            Marshal.FreeHGlobal(pointeurCatalogue);
        }
    }

    private static SignatureInfo SansSignature() => new()
    {
        Status = SignatureStatus.NonSigne,
        Message = "Aucune signature numérique (ni embarquée, ni dans un catalogue système)."
    };

    private static X509Certificate2? LireCertificat(string chemin)
    {
        try
        {
            // CreateFromSignedFile reste la seule API gérée qui extrait le certificat
            // d'un fichier signé Authenticode ; le certificat est ensuite rechargé
            // avec l'API moderne pour éviter les constructeurs obsolètes.
#pragma warning disable SYSLIB0057
            using var brut = X509Certificate.CreateFromSignedFile(chemin);
#pragma warning restore SYSLIB0057
            return X509CertificateLoader.LoadCertificate(brut.GetRawCertData());
        }
        catch
        {
            return null;
        }
    }

    private static SignatureInfo Interpreter(uint code, X509Certificate2? certificat, bool viaCatalogue)
    {
        var (statut, message) = code switch
        {
            0 => (SignatureStatus.Valide, viaCatalogue
                ? "Signature valide via un catalogue système approuvé."
                : "Signature valide et autorité de certification approuvée."),
            NativeMethods.TRUST_E_NOSIGNATURE => (SignatureStatus.NonSigne, "Aucune signature numérique."),
            NativeMethods.TRUST_E_SUBJECT_FORM_UNKNOWN => (SignatureStatus.NonSigne, "Aucune signature numérique exploitable."),
            NativeMethods.TRUST_E_PROVIDER_UNKNOWN => (SignatureStatus.Inconnu, "Fournisseur de vérification indisponible."),
            NativeMethods.TRUST_E_BAD_DIGEST => (SignatureStatus.Invalide, "Le fichier a été modifié après sa signature."),
            NativeMethods.TRUST_E_EXPLICIT_DISTRUST => (SignatureStatus.NonApprouvee, "Signature explicitement rejetée sur ce poste."),
            NativeMethods.TRUST_E_SUBJECT_NOT_TRUSTED => (SignatureStatus.NonApprouvee, "Signataire non approuvé sur ce poste."),
            NativeMethods.CERT_E_EXPIRED => (SignatureStatus.Expiree, "Certificat de signature expiré et sans horodatage valable."),
            NativeMethods.CERT_E_UNTRUSTEDROOT => (SignatureStatus.NonApprouvee, "Racine de certification non approuvée (certificat auto-signé ?)."),
            NativeMethods.CERT_E_CHAINING => (SignatureStatus.NonApprouvee, "Chaîne de certification incomplète."),
            NativeMethods.CERT_E_REVOKED => (SignatureStatus.Invalide, "Certificat de signature révoqué."),
            NativeMethods.CRYPT_E_SECURITY_SETTINGS => (SignatureStatus.NonApprouvee, "Signature refusée par la stratégie de sécurité locale."),
            _ => (SignatureStatus.Inconnu, $"Code de vérification 0x{code:X8}.")
        };

        var nomSignataire = certificat is null ? null : NomCourt(certificat.Subject);

        return new SignatureInfo
        {
            Status = statut,
            Signataire = nomSignataire,
            Emetteur = certificat is null ? null : NomCourt(certificat.Issuer),
            Empreinte = certificat?.Thumbprint?.ToLowerInvariant(),
            ValideDu = certificat?.NotBefore,
            ValideJusquau = certificat?.NotAfter,
            ViaCatalogue = viaCatalogue,
            Message = nomSignataire is null ? message : $"{message} Signataire : {nomSignataire}."
        };
    }

    /// <summary>Extrait le CN d'un nom distinctif X.500.</summary>
    internal static string NomCourt(string nomDistinctif)
    {
        foreach (var partie in nomDistinctif.Split(',', StringSplitOptions.TrimEntries))
        {
            if (partie.StartsWith("CN=", StringComparison.OrdinalIgnoreCase))
            {
                return partie[3..].Trim('"');
            }
        }

        return nomDistinctif;
    }

    [SupportedOSPlatform("windows")]
    private static class NativeMethods
    {
        internal const uint WTD_UI_NONE = 2;
        internal const uint WTD_REVOKE_NONE = 0;
        internal const uint WTD_CHOICE_FILE = 1;
        internal const uint WTD_CHOICE_CATALOG = 2;
        internal const uint WTD_STATEACTION_VERIFY = 1;
        internal const uint WTD_STATEACTION_CLOSE = 2;
        internal const uint WTD_SAFER_FLAG = 0x00000100;
        internal const uint WTD_CACHE_ONLY_URL_RETRIEVAL = 0x00001000;

        internal const uint TRUST_E_NOSIGNATURE = 0x800B0100;
        internal const uint TRUST_E_SUBJECT_FORM_UNKNOWN = 0x800B0003;
        internal const uint TRUST_E_PROVIDER_UNKNOWN = 0x800B0001;
        internal const uint TRUST_E_SUBJECT_NOT_TRUSTED = 0x800B0004;
        internal const uint TRUST_E_BAD_DIGEST = 0x80096010;
        internal const uint TRUST_E_EXPLICIT_DISTRUST = 0x800B0111;
        internal const uint CERT_E_EXPIRED = 0x800B0101;
        internal const uint CERT_E_UNTRUSTEDROOT = 0x800B0109;
        internal const uint CERT_E_CHAINING = 0x800B010A;
        internal const uint CERT_E_REVOKED = 0x800B010C;
        internal const uint CRYPT_E_SECURITY_SETTINGS = 0x80092026;

        internal static Guid WINTRUST_ACTION_GENERIC_VERIFY_V2 =
            new("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");

        [StructLayout(LayoutKind.Sequential)]
        internal struct WINTRUST_FILE_INFO
        {
            internal uint cbStruct;
            internal IntPtr pcwszFilePath;
            internal IntPtr hFile;
            internal IntPtr pgKnownSubject;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct WINTRUST_CATALOG_INFO
        {
            internal uint cbStruct;
            internal uint dwCatalogVersion;
            internal IntPtr pcwszCatalogFilePath;
            internal IntPtr pcwszMemberTag;
            internal IntPtr pcwszMemberFilePath;
            internal IntPtr hMemberFile;
            internal IntPtr pbCalculatedFileHash;
            internal uint cbCalculatedFileHash;
            internal IntPtr pcCatalogContext;
            internal IntPtr hCatAdmin;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct WINTRUST_DATA
        {
            internal uint cbStruct;
            internal IntPtr pPolicyCallbackData;
            internal IntPtr pSIPClientData;
            internal uint dwUIChoice;
            internal uint fdwRevocationChecks;
            internal uint dwUnionChoice;
            internal IntPtr pUnion;
            internal uint dwStateAction;
            internal IntPtr hWVTStateData;
            internal IntPtr pwszURLReference;
            internal uint dwProvFlags;
            internal uint dwUIContext;
            internal IntPtr pSignatureSettings;

            private static WINTRUST_DATA Base(uint choix, IntPtr union) => new()
            {
                cbStruct = (uint)Marshal.SizeOf<WINTRUST_DATA>(),
                dwUIChoice = WTD_UI_NONE,
                // La revocation en ligne est volontairement desactivee : une analyse locale
                // ne doit pas dependre du reseau ni bloquer sur un serveur OCSP injoignable.
                fdwRevocationChecks = WTD_REVOKE_NONE,
                dwUnionChoice = choix,
                pUnion = union,
                dwStateAction = WTD_STATEACTION_VERIFY,
                dwProvFlags = WTD_SAFER_FLAG | WTD_CACHE_ONLY_URL_RETRIEVAL
            };

            internal static WINTRUST_DATA PourFichier(IntPtr infoFichier) => Base(WTD_CHOICE_FILE, infoFichier);

            internal static WINTRUST_DATA PourCatalogue(IntPtr infoCatalogue) => Base(WTD_CHOICE_CATALOG, infoCatalogue);
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct CATALOG_INFO
        {
            internal uint cbStruct;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            internal string wszCatalogFile;
        }

        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = false)]
        internal static extern int WinVerifyTrust(IntPtr hwnd, ref Guid pgActionID, IntPtr pWVTData);

        [DllImport("wintrust.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CryptCATAdminAcquireContext2(
            out IntPtr phCatAdmin,
            IntPtr pgSubsystem,
            [MarshalAs(UnmanagedType.LPWStr)] string pwszHashAlgorithm,
            IntPtr pStrongHashPolicy,
            uint dwFlags);

        [DllImport("wintrust.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CryptCATAdminCalcHashFromFileHandle2(
            IntPtr hCatAdmin,
            IntPtr hFile,
            ref uint pcbHash,
            byte[]? pbHash,
            uint dwFlags);

        [DllImport("wintrust.dll", SetLastError = true)]
        internal static extern IntPtr CryptCATAdminEnumCatalogFromHash(
            IntPtr hCatAdmin,
            byte[] pbHash,
            uint cbHash,
            uint dwFlags,
            ref IntPtr phPrevCatInfo);

        [DllImport("wintrust.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CryptCATCatalogInfoFromContext(
            IntPtr hCatInfo,
            ref CATALOG_INFO psCatInfo,
            uint dwFlags);

        [DllImport("wintrust.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CryptCATAdminReleaseCatalogContext(IntPtr hCatAdmin, IntPtr hCatInfo, uint dwFlags);

        [DllImport("wintrust.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CryptCATAdminReleaseContext(IntPtr hCatAdmin, uint dwFlags);
    }
}
