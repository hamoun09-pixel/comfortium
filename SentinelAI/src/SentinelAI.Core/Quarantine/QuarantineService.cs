using Microsoft.Data.Sqlite;
using SentinelAI.Core.Analysis;
using SentinelAI.Core.Models;
using SentinelAI.Core.Storage;

namespace SentinelAI.Core.Quarantine;

/// <summary>Resultat d'une operation de quarantaine ou de restauration.</summary>
public sealed class QuarantineResult
{
    public required bool Reussi { get; init; }
    public required string Message { get; init; }
    public QuarantineEntry? Element { get; init; }

    public static QuarantineResult Echec(string message) => new() { Reussi = false, Message = message };
}

/// <summary>
/// Coffre de quarantaine reversible.
/// Mise en quarantaine : le contenu est copie chiffre dans le coffre, verifie, puis
/// l'original est supprime. Restauration : le contenu est dechiffre a son emplacement
/// d'origine et son empreinte est comparee a celle enregistree.
/// L'ordre des operations garantit qu'aucun fichier n'est perdu si une etape echoue.
/// </summary>
public sealed class QuarantineService(
    SentinelDatabase baseDonnees,
    JournalService journal,
    string? dossierCoffre = null)
{
    private readonly string _coffre = dossierCoffre ?? SentinelPaths.QuarantineDirectory;
    private readonly FileHasher _empreinteur = new();

    public async Task<QuarantineResult> MettreEnQuarantaineAsync(
        FileAnalysis analyse,
        string? motif = null,
        CancellationToken cancellationToken = default)
    {
        return await MettreEnQuarantaineAsync(
            analyse.Chemin,
            motif ?? $"Score {analyse.Score}/100 — {analyse.Niveau.Libelle()}",
            analyse.Score,
            analyse.Niveau,
            analyse.Sha256,
            cancellationToken).ConfigureAwait(false);
    }

    public async Task<QuarantineResult> MettreEnQuarantaineAsync(
        string chemin,
        string motif,
        int score = 0,
        RiskLevel niveau = RiskLevel.Eleve,
        string? sha256 = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(chemin))
        {
            return QuarantineResult.Echec($"Fichier introuvable : {chemin}");
        }

        Directory.CreateDirectory(_coffre);

        var fichier = new FileInfo(chemin);
        var id = Guid.NewGuid().ToString("N");
        var fichierCoffre = Path.Combine(_coffre, id + ".sntq");

        try
        {
            sha256 ??= await _empreinteur.Sha256Async(chemin, cancellationToken).ConfigureAwait(false);
            var cle = VaultKey.ObtenirOuCreer();

            // 1. Chiffrer une copie dans le coffre.
            await VaultCipher.ChiffrerAsync(chemin, fichierCoffre, cle, cancellationToken).ConfigureAwait(false);

            // 2. Verifier que la copie est relisible AVANT de toucher a l'original.
            var verification = Path.Combine(_coffre, id + ".verif");
            try
            {
                await VaultCipher.DechiffrerAsync(fichierCoffre, verification, cle, cancellationToken).ConfigureAwait(false);
                var empreinteVerifiee = await _empreinteur.Sha256Async(verification, cancellationToken).ConfigureAwait(false);
                if (!string.Equals(empreinteVerifiee, sha256, StringComparison.OrdinalIgnoreCase))
                {
                    return QuarantineResult.Echec(
                        "La copie de sécurité ne correspond pas à l'original. Le fichier n'a pas été déplacé.");
                }
            }
            finally
            {
                SupprimerSansErreur(verification);
            }

            // 3. Retirer l'attribut lecture seule si besoin, puis supprimer l'original.
            var attributs = fichier.Attributes;
            if (attributs.HasFlag(FileAttributes.ReadOnly))
            {
                File.SetAttributes(chemin, attributs & ~FileAttributes.ReadOnly);
            }

            File.Delete(chemin);

            var element = new QuarantineEntry
            {
                Id = id,
                CheminOrigine = fichier.FullName,
                Nom = fichier.Name,
                Taille = fichier.Length,
                Sha256 = sha256,
                Motif = motif,
                Score = score,
                Niveau = niveau,
                MiseEnQuarantaineLe = DateTime.UtcNow,
                Etat = QuarantineState.EnQuarantaine,
                FichierCoffre = Path.GetFileName(fichierCoffre),
                Attributs = attributs
            };

            Enregistrer(element);

            journal.Action("quarantaine.ajout", $"« {element.Nom} » mis en quarantaine.", new
            {
                element.Id,
                element.CheminOrigine,
                element.Sha256,
                element.Score,
                niveau = element.Niveau.ToString(),
                element.Motif
            });

            return new QuarantineResult
            {
                Reussi = true,
                Message = $"« {element.Nom} » a été mis en quarantaine. La restauration reste possible à tout moment.",
                Element = element
            };
        }
        catch (Exception ex)
        {
            SupprimerSansErreur(fichierCoffre);
            journal.Ecrire(JournalLevel.Erreur, "quarantaine.echec", $"{chemin} : {ex.Message}");
            return QuarantineResult.Echec($"Mise en quarantaine impossible : {ex.Message}");
        }
    }

    public async Task<QuarantineResult> RestaurerAsync(
        string id,
        string? cheminAlternatif = null,
        bool ecraser = false,
        CancellationToken cancellationToken = default)
    {
        var element = Lire(id);
        if (element is null)
        {
            return QuarantineResult.Echec($"Élément de quarantaine introuvable : {id}");
        }

        if (element.Etat != QuarantineState.EnQuarantaine)
        {
            return QuarantineResult.Echec($"Cet élément est déjà « {element.EtatLibelle.ToLowerInvariant()} ».");
        }

        var destination = cheminAlternatif ?? element.CheminOrigine;
        var fichierCoffre = Path.Combine(_coffre, element.FichierCoffre);

        if (!File.Exists(fichierCoffre))
        {
            return QuarantineResult.Echec("Le contenu chiffré est absent du coffre.");
        }

        if (File.Exists(destination) && !ecraser)
        {
            return QuarantineResult.Echec(
                $"Un fichier existe déjà à l'emplacement d'origine : {destination}. Confirmez le remplacement pour continuer.");
        }

        var temporaire = destination + ".sentinelai-restauration";

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            var cle = VaultKey.ObtenirOuCreer();

            await VaultCipher.DechiffrerAsync(fichierCoffre, temporaire, cle, cancellationToken).ConfigureAwait(false);

            var empreinte = await _empreinteur.Sha256Async(temporaire, cancellationToken).ConfigureAwait(false);
            if (element.Sha256 is not null &&
                !string.Equals(empreinte, element.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                SupprimerSansErreur(temporaire);
                return QuarantineResult.Echec(
                    "L'empreinte du fichier restauré ne correspond pas à celle enregistrée. Restauration annulée.");
            }

            File.Move(temporaire, destination, overwrite: true);
            File.SetAttributes(destination, element.Attributs);

            MarquerSortie(id, QuarantineState.Restaure);
            SupprimerSansErreur(fichierCoffre);

            journal.Action("quarantaine.restauration", $"« {element.Nom} » restauré vers {destination}.", new
            {
                element.Id,
                destination,
                element.Sha256
            });

            return new QuarantineResult
            {
                Reussi = true,
                Message = $"« {element.Nom} » a été restauré vers {destination}.",
                Element = element
            };
        }
        catch (Exception ex)
        {
            SupprimerSansErreur(temporaire);
            journal.Ecrire(JournalLevel.Erreur, "quarantaine.restauration.echec", $"{id} : {ex.Message}");
            return QuarantineResult.Echec($"Restauration impossible : {ex.Message}");
        }
    }

    /// <summary>Suppression definitive : le contenu chiffre est detruit, l'historique conserve.</summary>
    public QuarantineResult SupprimerDefinitivement(string id)
    {
        var element = Lire(id);
        if (element is null)
        {
            return QuarantineResult.Echec($"Élément de quarantaine introuvable : {id}");
        }

        if (element.Etat != QuarantineState.EnQuarantaine)
        {
            return QuarantineResult.Echec($"Cet élément est déjà « {element.EtatLibelle.ToLowerInvariant()} ».");
        }

        try
        {
            SupprimerSansErreur(Path.Combine(_coffre, element.FichierCoffre));
            MarquerSortie(id, QuarantineState.SupprimeDefinitivement);

            journal.Action("quarantaine.suppression", $"« {element.Nom} » supprimé définitivement.", new
            {
                element.Id,
                element.CheminOrigine,
                element.Sha256
            });

            return new QuarantineResult
            {
                Reussi = true,
                Message = $"« {element.Nom} » a été supprimé définitivement. Cette action est irréversible.",
                Element = element
            };
        }
        catch (Exception ex)
        {
            return QuarantineResult.Echec($"Suppression impossible : {ex.Message}");
        }
    }

    public IReadOnlyList<QuarantineEntry> Lister(bool actifsUniquement = true)
    {
        using var connexion = baseDonnees.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = actifsUniquement
            ? "SELECT * FROM quarantaine WHERE etat = 'EnQuarantaine' ORDER BY date_mise DESC"
            : "SELECT * FROM quarantaine ORDER BY date_mise DESC";

        var elements = new List<QuarantineEntry>();
        using var lecteur = commande.ExecuteReader();
        while (lecteur.Read())
        {
            elements.Add(Materialiser(lecteur));
        }

        return elements;
    }

    public QuarantineEntry? Lire(string id)
    {
        using var connexion = baseDonnees.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = "SELECT * FROM quarantaine WHERE id = $id";
        commande.Parameters.AddWithValue("$id", id);

        using var lecteur = commande.ExecuteReader();
        return lecteur.Read() ? Materialiser(lecteur) : null;
    }

    private void Enregistrer(QuarantineEntry element)
    {
        using var connexion = baseDonnees.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            INSERT INTO quarantaine
                (id, chemin_origine, nom, taille, sha256, motif, score, niveau, date_mise, etat, fichier_coffre, attributs)
            VALUES
                ($id, $origine, $nom, $taille, $sha256, $motif, $score, $niveau, $date, $etat, $coffre, $attributs);
            """;
        commande.Parameters.AddWithValue("$id", element.Id);
        commande.Parameters.AddWithValue("$origine", element.CheminOrigine);
        commande.Parameters.AddWithValue("$nom", element.Nom);
        commande.Parameters.AddWithValue("$taille", element.Taille);
        commande.Parameters.AddWithValue("$sha256", (object?)element.Sha256 ?? DBNull.Value);
        commande.Parameters.AddWithValue("$motif", element.Motif);
        commande.Parameters.AddWithValue("$score", element.Score);
        commande.Parameters.AddWithValue("$niveau", element.Niveau.ToString());
        commande.Parameters.AddWithValue("$date", ScanRepository.Iso(element.MiseEnQuarantaineLe));
        commande.Parameters.AddWithValue("$etat", element.Etat.ToString());
        commande.Parameters.AddWithValue("$coffre", element.FichierCoffre);
        commande.Parameters.AddWithValue("$attributs", (int)element.Attributs);
        commande.ExecuteNonQuery();
    }

    private void MarquerSortie(string id, QuarantineState etat)
    {
        using var connexion = baseDonnees.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = "UPDATE quarantaine SET etat = $etat, date_sortie = $date WHERE id = $id";
        commande.Parameters.AddWithValue("$etat", etat.ToString());
        commande.Parameters.AddWithValue("$date", ScanRepository.Iso(DateTime.UtcNow));
        commande.Parameters.AddWithValue("$id", id);
        commande.ExecuteNonQuery();
    }

    private static QuarantineEntry Materialiser(SqliteDataReader lecteur) => new()
    {
        Id = lecteur.GetString(lecteur.GetOrdinal("id")),
        CheminOrigine = lecteur.GetString(lecteur.GetOrdinal("chemin_origine")),
        Nom = lecteur.GetString(lecteur.GetOrdinal("nom")),
        Taille = lecteur.GetInt64(lecteur.GetOrdinal("taille")),
        Sha256 = Texte(lecteur, "sha256"),
        Motif = Texte(lecteur, "motif") ?? string.Empty,
        Score = lecteur.GetInt32(lecteur.GetOrdinal("score")),
        Niveau = Enum.TryParse<RiskLevel>(Texte(lecteur, "niveau"), out var niveau) ? niveau : RiskLevel.Eleve,
        MiseEnQuarantaineLe = ScanRepository.Depuis(lecteur.GetString(lecteur.GetOrdinal("date_mise"))),
        RestaureLe = Texte(lecteur, "date_sortie") is { } sortie ? ScanRepository.Depuis(sortie) : null,
        Etat = Enum.TryParse<QuarantineState>(lecteur.GetString(lecteur.GetOrdinal("etat")), out var etat)
            ? etat
            : QuarantineState.EnQuarantaine,
        FichierCoffre = lecteur.GetString(lecteur.GetOrdinal("fichier_coffre")),
        Attributs = (FileAttributes)lecteur.GetInt32(lecteur.GetOrdinal("attributs"))
    };

    private static string? Texte(SqliteDataReader lecteur, string colonne)
    {
        var position = lecteur.GetOrdinal(colonne);
        return lecteur.IsDBNull(position) ? null : lecteur.GetString(position);
    }

    private static void SupprimerSansErreur(string chemin)
    {
        try
        {
            if (File.Exists(chemin))
            {
                File.Delete(chemin);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Le fichier sera nettoye au prochain demarrage.
        }
    }
}
