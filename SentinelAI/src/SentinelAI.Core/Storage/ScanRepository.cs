using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using SentinelAI.Core.Models;

namespace SentinelAI.Core.Storage;

/// <summary>Resume d'une analyse tel qu'il apparait dans l'onglet Journal.</summary>
public sealed class ScanSummary
{
    public required string Id { get; init; }
    public required string Cible { get; init; }
    public DateTime Debut { get; init; }
    public DateTime? Fin { get; init; }
    public int FichiersAnalyses { get; init; }
    public int Suspects { get; init; }
    public int Critiques { get; init; }
    public int Erreurs { get; init; }
    public long Octets { get; init; }
    public bool Annulee { get; init; }
    public string Mode { get; init; } = "manuel";
}

/// <summary>Lecture et ecriture des analyses et de leurs resultats.</summary>
public sealed class ScanRepository(SentinelDatabase base_)
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

    public void DebuterAnalyse(string id, string cible, DateTime debut, string mode = "manuel")
    {
        using var connexion = base_.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            INSERT INTO analyses (id, cible, debut, mode) VALUES ($id, $cible, $debut, $mode);
            """;
        commande.Parameters.AddWithValue("$id", id);
        commande.Parameters.AddWithValue("$cible", cible);
        commande.Parameters.AddWithValue("$debut", Iso(debut));
        commande.Parameters.AddWithValue("$mode", mode);
        commande.ExecuteNonQuery();
    }

    public void TerminerAnalyse(ScanReport rapport)
    {
        using var connexion = base_.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            UPDATE analyses
               SET fin = $fin, fichiers_analyses = $fichiers, suspects = $suspects,
                   critiques = $critiques, erreurs = $erreurs, octets = $octets, annulee = $annulee
             WHERE id = $id;
            """;
        commande.Parameters.AddWithValue("$id", rapport.Id);
        commande.Parameters.AddWithValue("$fin", Iso(rapport.Fin));
        commande.Parameters.AddWithValue("$fichiers", rapport.FichiersAnalyses);
        commande.Parameters.AddWithValue("$suspects", rapport.Suspects);
        commande.Parameters.AddWithValue("$critiques", rapport.Critiques);
        commande.Parameters.AddWithValue("$erreurs", rapport.Erreurs);
        commande.Parameters.AddWithValue("$octets", rapport.OctetsAnalyses);
        commande.Parameters.AddWithValue("$annulee", rapport.Annulee ? 1 : 0);
        commande.ExecuteNonQuery();
    }

    /// <summary>Enregistre les resultats par lot, dans une seule transaction.</summary>
    public void EnregistrerResultats(string analyseId, IEnumerable<FileAnalysis> resultats)
    {
        using var connexion = base_.Ouvrir();
        using var transaction = connexion.BeginTransaction();
        using var commande = connexion.CreateCommand();
        commande.Transaction = transaction;
        commande.CommandText = """
            INSERT INTO resultats
                (analyse_id, chemin, nom, extension, taille, sha256, categorie, sensible,
                 type_reel, signature, signataire, score, niveau, indicateurs, explications, erreur, analyse_le)
            VALUES
                ($analyse, $chemin, $nom, $extension, $taille, $sha256, $categorie, $sensible,
                 $typeReel, $signature, $signataire, $score, $niveau, $indicateurs, $explications, $erreur, $date);
            """;

        var parametres = new[]
        {
            "$analyse", "$chemin", "$nom", "$extension", "$taille", "$sha256", "$categorie", "$sensible",
            "$typeReel", "$signature", "$signataire", "$score", "$niveau", "$indicateurs", "$explications",
            "$erreur", "$date"
        };

        foreach (var nom in parametres)
        {
            commande.Parameters.Add(new SqliteParameter(nom, SqliteType.Text));
        }

        foreach (var resultat in resultats)
        {
            commande.Parameters["$analyse"].Value = analyseId;
            commande.Parameters["$chemin"].Value = resultat.Chemin;
            commande.Parameters["$nom"].Value = resultat.Nom;
            commande.Parameters["$extension"].Value = resultat.Extension;
            commande.Parameters["$taille"].Value = resultat.Taille;
            commande.Parameters["$sha256"].Value = (object?)resultat.Sha256 ?? DBNull.Value;
            commande.Parameters["$categorie"].Value = resultat.Categorie.ToString();
            commande.Parameters["$sensible"].Value = resultat.TypeSensible ? 1 : 0;
            commande.Parameters["$typeReel"].Value = (object?)resultat.TypeReel ?? DBNull.Value;
            commande.Parameters["$signature"].Value = resultat.Signature.Status.ToString();
            commande.Parameters["$signataire"].Value = (object?)resultat.Signature.Signataire ?? DBNull.Value;
            commande.Parameters["$score"].Value = resultat.Score;
            commande.Parameters["$niveau"].Value = resultat.Niveau.ToString();
            commande.Parameters["$indicateurs"].Value = JsonSerializer.Serialize(
                resultat.Indicateurs.Select(i => new { i.Id, i.Nom, i.Poids, i.Preuve, Source = i.Source.ToString() }), Json);
            commande.Parameters["$explications"].Value = JsonSerializer.Serialize(resultat.Explications, Json);
            commande.Parameters["$erreur"].Value = (object?)resultat.Erreur ?? DBNull.Value;
            commande.Parameters["$date"].Value = Iso(resultat.AnalyseLe);
            commande.ExecuteNonQuery();
        }

        transaction.Commit();
    }

    public IReadOnlyList<ScanSummary> DernieresAnalyses(int limite = 50)
    {
        using var connexion = base_.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            SELECT id, cible, debut, fin, fichiers_analyses, suspects, critiques, erreurs, octets, annulee, mode
              FROM analyses ORDER BY debut DESC LIMIT $limite;
            """;
        commande.Parameters.AddWithValue("$limite", limite);

        var analyses = new List<ScanSummary>();
        using var lecteur = commande.ExecuteReader();
        while (lecteur.Read())
        {
            analyses.Add(new ScanSummary
            {
                Id = lecteur.GetString(0),
                Cible = lecteur.GetString(1),
                Debut = Depuis(lecteur.GetString(2)),
                Fin = lecteur.IsDBNull(3) ? null : Depuis(lecteur.GetString(3)),
                FichiersAnalyses = lecteur.GetInt32(4),
                Suspects = lecteur.GetInt32(5),
                Critiques = lecteur.GetInt32(6),
                Erreurs = lecteur.GetInt32(7),
                Octets = lecteur.GetInt64(8),
                Annulee = lecteur.GetInt32(9) != 0,
                Mode = lecteur.GetString(10)
            });
        }

        return analyses;
    }

    /// <summary>Resultats d'une analyse donnee, du plus risque au moins risque.</summary>
    public IReadOnlyList<StoredResult> Resultats(string analyseId, int scoreMinimum = 0, int limite = 5000)
    {
        using var connexion = base_.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            SELECT chemin, nom, extension, taille, sha256, categorie, signature, signataire,
                   score, niveau, explications, erreur, analyse_le
              FROM resultats
             WHERE analyse_id = $analyse AND score >= $score
             ORDER BY score DESC, nom ASC
             LIMIT $limite;
            """;
        commande.Parameters.AddWithValue("$analyse", analyseId);
        commande.Parameters.AddWithValue("$score", scoreMinimum);
        commande.Parameters.AddWithValue("$limite", limite);
        return Lire(commande);
    }

    /// <summary>Historique de toutes les detections dont le score depasse un seuil.</summary>
    public IReadOnlyList<StoredResult> Detections(int scoreMinimum = RiskSeuils.Suspect, int limite = 500)
    {
        using var connexion = base_.Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            SELECT chemin, nom, extension, taille, sha256, categorie, signature, signataire,
                   score, niveau, explications, erreur, analyse_le
              FROM resultats
             WHERE score >= $score
             ORDER BY analyse_le DESC, score DESC
             LIMIT $limite;
            """;
        commande.Parameters.AddWithValue("$score", scoreMinimum);
        commande.Parameters.AddWithValue("$limite", limite);
        return Lire(commande);
    }

    private static List<StoredResult> Lire(SqliteCommand commande)
    {
        var resultats = new List<StoredResult>();
        using var lecteur = commande.ExecuteReader();
        while (lecteur.Read())
        {
            resultats.Add(new StoredResult
            {
                Chemin = lecteur.GetString(0),
                Nom = lecteur.GetString(1),
                Extension = lecteur.IsDBNull(2) ? "" : lecteur.GetString(2),
                Taille = lecteur.GetInt64(3),
                Sha256 = lecteur.IsDBNull(4) ? null : lecteur.GetString(4),
                Categorie = lecteur.IsDBNull(5) ? "Autre" : lecteur.GetString(5),
                Signature = lecteur.IsDBNull(6) ? "Inconnu" : lecteur.GetString(6),
                Signataire = lecteur.IsDBNull(7) ? null : lecteur.GetString(7),
                Score = lecteur.GetInt32(8),
                Niveau = Enum.TryParse<RiskLevel>(lecteur.GetString(9), out var niveau) ? niveau : RiskLevel.Sain,
                Explications = lecteur.IsDBNull(10)
                    ? []
                    : JsonSerializer.Deserialize<string[]>(lecteur.GetString(10)) ?? [],
                Erreur = lecteur.IsDBNull(11) ? null : lecteur.GetString(11),
                AnalyseLe = Depuis(lecteur.GetString(12))
            });
        }

        return resultats;
    }

    internal static string Iso(DateTime valeur) =>
        valeur.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    internal static DateTime Depuis(string valeur) =>
        DateTime.Parse(valeur, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}

/// <summary>Resultat lu depuis la base (vue simplifiee de FileAnalysis).</summary>
public sealed class StoredResult
{
    public required string Chemin { get; init; }
    public required string Nom { get; init; }
    public string Extension { get; init; } = "";
    public long Taille { get; init; }
    public string? Sha256 { get; init; }
    public string Categorie { get; init; } = "Autre";
    public string Signature { get; init; } = "Inconnu";
    public string? Signataire { get; init; }
    public int Score { get; init; }
    public RiskLevel Niveau { get; init; }
    public IReadOnlyList<string> Explications { get; init; } = [];
    public string? Erreur { get; init; }
    public DateTime AnalyseLe { get; init; }
}

/// <summary>Seuils partages par l'interface et les requetes.</summary>
public static class RiskSeuils
{
    /// <summary>Score a partir duquel un fichier est affiche comme « à vérifier ».</summary>
    public const int Suspect = 30;
}
