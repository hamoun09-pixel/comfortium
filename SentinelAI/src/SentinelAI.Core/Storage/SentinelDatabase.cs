using Microsoft.Data.Sqlite;

namespace SentinelAI.Core.Storage;

/// <summary>
/// Base SQLite locale. Un seul fichier, cree et migre au demarrage.
/// Les acces concurrents passent par le mode WAL.
/// </summary>
public sealed class SentinelDatabase
{
    public SentinelDatabase(string? fichier = null)
    {
        Fichier = fichier ?? SentinelPaths.DatabaseFile;
        var dossier = Path.GetDirectoryName(Fichier);
        if (!string.IsNullOrEmpty(dossier))
        {
            Directory.CreateDirectory(dossier);
        }

        ChaineConnexion = new SqliteConnectionStringBuilder
        {
            DataSource = Fichier,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true
        }.ToString();

        Initialiser();
    }

    public string Fichier { get; }

    public string ChaineConnexion { get; }

    public SqliteConnection Ouvrir()
    {
        var connexion = new SqliteConnection(ChaineConnexion);
        connexion.Open();
        using var commande = connexion.CreateCommand();
        commande.CommandText = "PRAGMA foreign_keys = ON;";
        commande.ExecuteNonQuery();
        return connexion;
    }

    private void Initialiser()
    {
        using var connexion = new SqliteConnection(ChaineConnexion);
        connexion.Open();

        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS analyses (
                id                TEXT PRIMARY KEY,
                cible             TEXT NOT NULL,
                debut             TEXT NOT NULL,
                fin               TEXT,
                fichiers_analyses INTEGER NOT NULL DEFAULT 0,
                suspects          INTEGER NOT NULL DEFAULT 0,
                critiques         INTEGER NOT NULL DEFAULT 0,
                erreurs           INTEGER NOT NULL DEFAULT 0,
                octets            INTEGER NOT NULL DEFAULT 0,
                annulee           INTEGER NOT NULL DEFAULT 0,
                mode              TEXT NOT NULL DEFAULT 'manuel'
            );

            CREATE TABLE IF NOT EXISTS resultats (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                analyse_id    TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
                chemin        TEXT NOT NULL,
                nom           TEXT NOT NULL,
                extension     TEXT,
                taille        INTEGER NOT NULL DEFAULT 0,
                sha256        TEXT,
                categorie     TEXT,
                sensible      INTEGER NOT NULL DEFAULT 0,
                type_reel     TEXT,
                signature     TEXT,
                signataire    TEXT,
                score         INTEGER NOT NULL DEFAULT 0,
                niveau        TEXT NOT NULL,
                indicateurs   TEXT,
                explications  TEXT,
                erreur        TEXT,
                analyse_le    TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_resultats_analyse ON resultats(analyse_id);
            CREATE INDEX IF NOT EXISTS idx_resultats_sha256  ON resultats(sha256);
            CREATE INDEX IF NOT EXISTS idx_resultats_niveau  ON resultats(niveau);
            CREATE INDEX IF NOT EXISTS idx_resultats_chemin  ON resultats(chemin);

            CREATE TABLE IF NOT EXISTS quarantaine (
                id             TEXT PRIMARY KEY,
                chemin_origine TEXT NOT NULL,
                nom            TEXT NOT NULL,
                taille         INTEGER NOT NULL DEFAULT 0,
                sha256         TEXT,
                motif          TEXT,
                score          INTEGER NOT NULL DEFAULT 0,
                niveau         TEXT,
                date_mise      TEXT NOT NULL,
                date_sortie    TEXT,
                etat           TEXT NOT NULL,
                fichier_coffre TEXT NOT NULL,
                attributs      INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_quarantaine_etat ON quarantaine(etat);

            CREATE TABLE IF NOT EXISTS parametres (
                cle    TEXT PRIMARY KEY,
                valeur TEXT
            );
            """;
        commande.ExecuteNonQuery();
    }

    public string? LireParametre(string cle)
    {
        using var connexion = Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = "SELECT valeur FROM parametres WHERE cle = $cle";
        commande.Parameters.AddWithValue("$cle", cle);
        return commande.ExecuteScalar() as string;
    }

    public void EcrireParametre(string cle, string valeur)
    {
        using var connexion = Ouvrir();
        using var commande = connexion.CreateCommand();
        commande.CommandText = """
            INSERT INTO parametres (cle, valeur) VALUES ($cle, $valeur)
            ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur;
            """;
        commande.Parameters.AddWithValue("$cle", cle);
        commande.Parameters.AddWithValue("$valeur", valeur);
        commande.ExecuteNonQuery();
    }
}
