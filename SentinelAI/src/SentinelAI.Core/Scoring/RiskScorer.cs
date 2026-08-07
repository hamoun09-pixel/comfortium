using SentinelAI.Core.Models;

namespace SentinelAI.Core.Scoring;

/// <summary>Resultat du calcul de risque : score borne, niveau et explications.</summary>
public sealed class RiskAssessment
{
    public required int Score { get; init; }

    public required RiskLevel Niveau { get; init; }

    public required IReadOnlyList<RuleHit> Indicateurs { get; init; }

    public required IReadOnlyList<string> Explications { get; init; }
}

/// <summary>
/// Agrege les indicateurs en un score de 0 a 100.
/// Le principe : chaque indicateur ajoute son poids, une signature valide en retire.
/// Chaque contribution est conservee sous forme de phrase, pour que l'utilisateur
/// puisse toujours savoir *pourquoi* un fichier a ete signale.
/// </summary>
public sealed class RiskScorer
{
    // Seuils de basculement d'un niveau a l'autre.
    public const int SeuilFaible = 10;
    public const int SeuilMoyen = 30;
    public const int SeuilEleve = 55;
    public const int SeuilCritique = 80;

    /// <summary>Ajustements lies a l'etat de la signature numerique.</summary>
    private static (int Poids, string Nom, string Description)? PourSignature(SignatureInfo signature, bool typeSensible)
    {
        return signature.Status switch
        {
            SignatureStatus.Valide => (-25, "Signature numérique valide",
                $"Le fichier est signé par {signature.Signataire ?? "un éditeur approuvé"} et la signature est vérifiée."),

            SignatureStatus.Invalide => (40, "Signature numérique invalide",
                "Le fichier a été modifié après avoir été signé. Un fichier légitime altéré est une menace sérieuse."),

            SignatureStatus.NonApprouvee => (20, "Signataire non approuvé",
                "Le fichier est signé, mais l'autorité de certification n'est pas approuvée sur ce poste."),

            SignatureStatus.Expiree => (8, "Certificat de signature expiré",
                "Le certificat a expiré sans horodatage valable. Fréquent sur les vieux logiciels, mais à vérifier."),

            SignatureStatus.NonSigne when typeSensible => (18, "Fichier exécutable non signé",
                "Aucune signature numérique : l'éditeur du fichier ne peut pas être vérifié."),

            _ => null
        };
    }

    public RiskAssessment Evaluer(IEnumerable<RuleHit> indicateurs, SignatureInfo signature, bool typeSensible)
    {
        var tous = new List<RuleHit>(indicateurs);

        var ajustement = PourSignature(signature, typeSensible);
        if (ajustement is { } valeur)
        {
            tous.Add(new RuleHit
            {
                Id = $"SIG-{signature.Status}",
                Nom = valeur.Nom,
                Description = valeur.Description,
                Poids = valeur.Poids,
                Source = HitSource.Signature,
                Preuve = signature.Signataire
            });
        }

        var correspondanceEmpreinte = tous.Any(i => i.Source == HitSource.Empreinte);

        // Une empreinte repertoriee est une certitude : elle prime sur tout bonus de signature.
        var score = correspondanceEmpreinte
            ? 100
            : Math.Clamp(tous.Sum(i => i.Poids), 0, 100);

        var niveau = NiveauPour(score);
        var ordonnes = tous
            .OrderByDescending(i => Math.Abs(i.Poids))
            .ThenBy(i => i.Id, StringComparer.Ordinal)
            .ToList();

        return new RiskAssessment
        {
            Score = score,
            Niveau = niveau,
            Indicateurs = ordonnes,
            Explications = ConstruireExplications(ordonnes, score, niveau, correspondanceEmpreinte)
        };
    }

    public static RiskLevel NiveauPour(int score) => score switch
    {
        >= SeuilCritique => RiskLevel.Critique,
        >= SeuilEleve => RiskLevel.Eleve,
        >= SeuilMoyen => RiskLevel.Moyen,
        >= SeuilFaible => RiskLevel.Faible,
        _ => RiskLevel.Sain
    };

    private static List<string> ConstruireExplications(
        List<RuleHit> indicateurs,
        int score,
        RiskLevel niveau,
        bool correspondanceEmpreinte)
    {
        var explications = new List<string>
        {
            $"Score de risque : {score}/100 — niveau {niveau.Libelle()}."
        };

        if (correspondanceEmpreinte)
        {
            explications.Add("Le score est fixé à 100 : l'empreinte du fichier figure dans la liste locale des menaces connues.");
        }

        if (indicateurs.Count == 0)
        {
            explications.Add("Aucun indicateur relevé par les règles locales.");
        }
        else
        {
            foreach (var indicateur in indicateurs)
            {
                var ligne = indicateur.Explication;
                if (indicateur.Occurrences > 1)
                {
                    ligne += $" ({indicateur.Occurrences} occurrences)";
                }

                explications.Add(ligne);

                if (!string.IsNullOrWhiteSpace(indicateur.Description))
                {
                    explications.Add($"    ↳ {indicateur.Description}");
                }
            }
        }

        explications.Add(niveau.Recommandation());
        return explications;
    }
}
