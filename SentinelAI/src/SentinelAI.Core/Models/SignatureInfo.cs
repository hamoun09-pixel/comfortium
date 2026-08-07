namespace SentinelAI.Core.Models;

/// <summary>Etat de la signature numerique Authenticode d'un fichier.</summary>
public enum SignatureStatus
{
    /// <summary>Verification non pertinente pour ce type de fichier.</summary>
    NonApplicable = 0,

    /// <summary>Aucune signature trouvee (ni embarquee, ni catalogue).</summary>
    NonSigne,

    /// <summary>Signature valide et chaine de confiance verifiee.</summary>
    Valide,

    /// <summary>Signature presente mais invalide (fichier modifie apres signature).</summary>
    Invalide,

    /// <summary>Signature dont le certificat est expire, sans horodatage valable.</summary>
    Expiree,

    /// <summary>Signature presente mais l'autorite n'est pas approuvee sur ce poste.</summary>
    NonApprouvee,

    /// <summary>Verification impossible (plateforme non Windows, acces refuse, erreur).</summary>
    Inconnu
}

/// <summary>Detail de la verification de signature.</summary>
public sealed class SignatureInfo
{
    public SignatureStatus Status { get; init; } = SignatureStatus.Inconnu;

    /// <summary>Nom du signataire (CN du certificat feuille).</summary>
    public string? Signataire { get; init; }

    /// <summary>Autorite emettrice.</summary>
    public string? Emetteur { get; init; }

    public string? Empreinte { get; init; }

    public DateTime? ValideDu { get; init; }

    public DateTime? ValideJusquau { get; init; }

    /// <summary>Vrai si la signature provient d'un catalogue systeme et non du fichier lui-meme.</summary>
    public bool ViaCatalogue { get; init; }

    /// <summary>Message explicatif en francais.</summary>
    public string Message { get; init; } = string.Empty;

    public static SignatureInfo NonApplicable(string message = "Type de fichier non concerné par la signature Authenticode.")
        => new() { Status = SignatureStatus.NonApplicable, Message = message };

    public static SignatureInfo Inconnue(string message)
        => new() { Status = SignatureStatus.Inconnu, Message = message };

    public string Libelle => Status switch
    {
        SignatureStatus.NonApplicable => "Non applicable",
        SignatureStatus.NonSigne => "Non signé",
        SignatureStatus.Valide => "Valide",
        SignatureStatus.Invalide => "Invalide",
        SignatureStatus.Expiree => "Expirée",
        SignatureStatus.NonApprouvee => "Non approuvée",
        _ => "Inconnue"
    };
}
