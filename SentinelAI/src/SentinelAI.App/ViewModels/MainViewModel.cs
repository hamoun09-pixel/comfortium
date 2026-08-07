using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using SentinelAI.App.Mvvm;
using SentinelAI.Core;
using SentinelAI.Core.Models;
using SentinelAI.Core.Quarantine;
using SentinelAI.Core.Rules;
using SentinelAI.Core.Scanning;
using SentinelAI.Core.Storage;

namespace SentinelAI.App.ViewModels;

/// <summary>Modèle de vue principal : analyse, journal, quarantaine et paramètres.</summary>
public sealed class MainViewModel : ObservableObject
{
    private readonly SentinelDatabase _base;
    private readonly JournalService _journal;
    private readonly ScanRepository _depot;
    private readonly QuarantineService _quarantaine;
    private readonly ScanEngine _moteur;

    private CancellationTokenSource? _annulation;

    private string _cible = "";
    private string _etat = "Prêt.";
    private double _avancement;
    private bool _analyseEnCours;
    private string _fichierCourant = "";
    private FileAnalysis? _selection;
    private string _synthese = "";
    private bool _typesSensiblesUniquement;
    private bool _recursif = true;
    private bool _afficherTout;

    public MainViewModel()
    {
        SentinelPaths.EnsureCreated();
        _base = new SentinelDatabase();
        _journal = new JournalService();
        _depot = new ScanRepository(_base);
        _quarantaine = new QuarantineService(_base, _journal);
        _moteur = ScanEngine.Standard(_base, _journal);

        NombreRegles = RuleEngine.Charger().Nombre;
        NombreEmpreintes = HashBlocklist.Charger().Nombre;

        ChoisirFichierCommande = new RelayCommand(_ => ChoisirFichier());
        ChoisirDossierCommande = new RelayCommand(_ => ChoisirDossier());
        AnalyserCommande = new AsyncRelayCommand(_ => AnalyserAsync(), _ => !AnalyseEnCours && Cible.Length > 0);
        ArreterCommande = new RelayCommand(_ => Arreter(), _ => AnalyseEnCours);
        MettreEnQuarantaineCommande = new AsyncRelayCommand(_ => MettreEnQuarantaineAsync(), _ => Selection is not null);
        OuvrirEmplacementCommande = new RelayCommand(_ => OuvrirEmplacement(), _ => Selection is not null);
        RestaurerCommande = new AsyncRelayCommand(p => RestaurerAsync(p as QuarantineEntry), p => p is QuarantineEntry);
        SupprimerDefinitivementCommande = new RelayCommand(p => SupprimerDefinitivement(p as QuarantineEntry), p => p is QuarantineEntry);
        RafraichirCommande = new RelayCommand(_ => RafraichirTout());
        OuvrirJournalCommande = new RelayCommand(_ => Ouvrir(SentinelPaths.JournalDirectory));
        OuvrirDonneesCommande = new RelayCommand(_ => Ouvrir(SentinelPaths.Root));

        RafraichirTout();
    }

    // ---- Analyse ------------------------------------------------------------

    public ObservableCollection<FileAnalysis> Resultats { get; } = [];

    public string Cible
    {
        get => _cible;
        set
        {
            if (Definir(ref _cible, value))
            {
                AnalyserCommande.Reevaluer();
            }
        }
    }

    public string Etat
    {
        get => _etat;
        private set => Definir(ref _etat, value);
    }

    public string Synthese
    {
        get => _synthese;
        private set => Definir(ref _synthese, value);
    }

    public double Avancement
    {
        get => _avancement;
        private set => Definir(ref _avancement, value);
    }

    public string FichierCourant
    {
        get => _fichierCourant;
        private set => Definir(ref _fichierCourant, value);
    }

    public bool AnalyseEnCours
    {
        get => _analyseEnCours;
        private set
        {
            if (Definir(ref _analyseEnCours, value))
            {
                Notifier(nameof(AnalyseTerminee));
                AnalyserCommande.Reevaluer();
                ArreterCommande.Reevaluer();
            }
        }
    }

    public bool AnalyseTerminee => !AnalyseEnCours;

    public bool Recursif
    {
        get => _recursif;
        set => Definir(ref _recursif, value);
    }

    public bool TypesSensiblesUniquement
    {
        get => _typesSensiblesUniquement;
        set => Definir(ref _typesSensiblesUniquement, value);
    }

    /// <summary>Afficher aussi les fichiers sans indicateur (désactivé par défaut).</summary>
    public bool AfficherTout
    {
        get => _afficherTout;
        set
        {
            if (Definir(ref _afficherTout, value))
            {
                AppliquerFiltre();
            }
        }
    }

    public FileAnalysis? Selection
    {
        get => _selection;
        set
        {
            if (Definir(ref _selection, value))
            {
                Notifier(nameof(DetailSelection));
                MettreEnQuarantaineCommande.Reevaluer();
                OuvrirEmplacementCommande.Reevaluer();
            }
        }
    }

    public string DetailSelection => Selection is null
        ? "Sélectionnez un fichier pour afficher le détail de son évaluation."
        : string.Join(Environment.NewLine, DetailPour(Selection));

    private static IEnumerable<string> DetailPour(FileAnalysis analyse)
    {
        yield return analyse.Chemin;
        yield return "";
        yield return $"SHA-256   : {analyse.Sha256}";
        yield return $"Taille    : {Formats.Octets(analyse.Taille)}";
        yield return $"Type      : {analyse.Categorie.Libelle()}" +
                     (analyse.TypeReel is null ? "" : $" (contenu détecté : {analyse.TypeReel})") +
                     (analyse.TypeSensible ? " — type sensible" : "");
        yield return $"Modifié   : {analyse.ModifieLe.ToLocalTime():yyyy-MM-dd HH:mm}";
        yield return $"Signature : {analyse.Signature.Libelle} — {analyse.Signature.Message}";

        if (analyse.Signature.ValideJusquau is { } fin)
        {
            yield return $"            Certificat valable jusqu'au {fin:yyyy-MM-dd}.";
        }

        yield return "";
        yield return "Évaluation du risque";
        yield return new string('─', 60);

        foreach (var explication in analyse.Explications)
        {
            yield return explication;
        }

        if (analyse.EnErreur)
        {
            yield return "";
            yield return $"Erreur : {analyse.Erreur}";
        }
    }

    public RelayCommand ChoisirFichierCommande { get; }
    public RelayCommand ChoisirDossierCommande { get; }
    public AsyncRelayCommand AnalyserCommande { get; }
    public RelayCommand ArreterCommande { get; }
    public AsyncRelayCommand MettreEnQuarantaineCommande { get; }
    public RelayCommand OuvrirEmplacementCommande { get; }
    public AsyncRelayCommand RestaurerCommande { get; }
    public RelayCommand SupprimerDefinitivementCommande { get; }
    public RelayCommand RafraichirCommande { get; }
    public RelayCommand OuvrirJournalCommande { get; }
    public RelayCommand OuvrirDonneesCommande { get; }

    private void ChoisirFichier()
    {
        var dialogue = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Choisir un fichier à analyser",
            Filter = "Tous les fichiers (*.*)|*.*",
            CheckFileExists = true
        };

        if (dialogue.ShowDialog() == true)
        {
            Cible = dialogue.FileName;
        }
    }

    private void ChoisirDossier()
    {
        var dialogue = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Choisir un dossier à analyser"
        };

        if (dialogue.ShowDialog() == true)
        {
            Cible = dialogue.FolderName;
        }
    }

    private List<FileAnalysis> _tousResultats = [];

    private async Task AnalyserAsync()
    {
        if (!File.Exists(Cible) && !Directory.Exists(Cible))
        {
            MessageBox.Show($"Chemin introuvable :\n{Cible}", "SentinelAI",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        Resultats.Clear();
        _tousResultats = [];
        Selection = null;
        AnalyseEnCours = true;
        Avancement = 0;
        Synthese = "";
        Etat = "Analyse en cours…";

        _annulation = new CancellationTokenSource();

        var options = new ScanOptions
        {
            Recursif = Recursif,
            TypesSensiblesUniquement = TypesSensiblesUniquement
        };

        var avancement = new Progress<ScanProgress>(p =>
        {
            Avancement = p.Pourcentage;
            FichierCourant = p.FichierCourant ?? "";
            Etat = $"{p.FichiersAnalyses} / {p.FichiersTotal} fichiers — {p.Suspects} à vérifier";
        });

        try
        {
            var rapport = await Task.Run(
                () => _moteur.AnalyserAsync(Cible, options, avancement, _annulation.Token),
                _annulation.Token);

            _tousResultats = [.. rapport.ParRisqueDecroissant];
            AppliquerFiltre();

            Synthese = rapport.Synthese;
            Etat = rapport.Annulee ? "Analyse interrompue." : "Analyse terminée.";
            Avancement = 100;
        }
        catch (OperationCanceledException)
        {
            Etat = "Analyse interrompue.";
        }
        catch (Exception ex)
        {
            Etat = "Analyse interrompue par une erreur.";
            MessageBox.Show($"L'analyse a échoué :\n{ex.Message}", "SentinelAI",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            AnalyseEnCours = false;
            FichierCourant = "";
            _annulation?.Dispose();
            _annulation = null;
            RafraichirJournal();
        }
    }

    private void AppliquerFiltre()
    {
        Resultats.Clear();
        foreach (var resultat in _tousResultats.Where(r => AfficherTout || r.Score > 0 || r.EnErreur))
        {
            Resultats.Add(resultat);
        }

        Notifier(nameof(NombreAffiche));
    }

    public string NombreAffiche => _tousResultats.Count == 0
        ? ""
        : $"{Resultats.Count} ligne(s) affichée(s) sur {_tousResultats.Count} fichier(s) analysé(s).";

    private void Arreter()
    {
        _annulation?.Cancel();
        Etat = "Interruption demandée…";
    }

    private async Task MettreEnQuarantaineAsync()
    {
        if (Selection is not { } analyse)
        {
            return;
        }

        var confirmation = MessageBox.Show(
            $"Mettre « {analyse.Nom} » en quarantaine ?\n\n" +
            "Le fichier sera chiffré dans un coffre local et retiré de son emplacement actuel.\n" +
            "Vous pourrez le restaurer à tout moment depuis l'onglet Quarantaine.",
            "Mise en quarantaine",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (confirmation != MessageBoxResult.Yes)
        {
            return;
        }

        var resultat = await _quarantaine.MettreEnQuarantaineAsync(analyse);
        MessageBox.Show(resultat.Message, "SentinelAI", MessageBoxButton.OK,
            resultat.Reussi ? MessageBoxImage.Information : MessageBoxImage.Warning);

        if (resultat.Reussi)
        {
            _tousResultats.Remove(analyse);
            Resultats.Remove(analyse);
            Selection = null;
            RafraichirQuarantaine();
        }
    }

    private void OuvrirEmplacement()
    {
        if (Selection is null)
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{Selection.Chemin}\"")
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Impossible d'ouvrir l'emplacement :\n{ex.Message}", "SentinelAI",
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ---- Journal ------------------------------------------------------------

    public ObservableCollection<ScanSummary> Analyses { get; } = [];

    public ObservableCollection<StoredResult> Detections { get; } = [];

    private void RafraichirJournal()
    {
        Analyses.Clear();
        foreach (var analyse in _depot.DernieresAnalyses(50))
        {
            Analyses.Add(analyse);
        }

        Detections.Clear();
        foreach (var detection in _depot.Detections(limite: 200))
        {
            Detections.Add(detection);
        }
    }

    // ---- Quarantaine --------------------------------------------------------

    public ObservableCollection<QuarantineEntry> ElementsQuarantaine { get; } = [];

    private void RafraichirQuarantaine()
    {
        ElementsQuarantaine.Clear();
        foreach (var element in _quarantaine.Lister(actifsUniquement: false))
        {
            ElementsQuarantaine.Add(element);
        }
    }

    private async Task RestaurerAsync(QuarantineEntry? element)
    {
        if (element is null)
        {
            return;
        }

        var confirmation = MessageBox.Show(
            $"Restaurer « {element.Nom} » vers :\n{element.CheminOrigine} ?\n\n" +
            "Le fichier redeviendra utilisable à son emplacement d'origine.",
            "Restauration",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (confirmation != MessageBoxResult.Yes)
        {
            return;
        }

        var resultat = await _quarantaine.RestaurerAsync(element.Id);

        if (!resultat.Reussi && resultat.Message.Contains("existe déjà"))
        {
            var ecraser = MessageBox.Show(
                resultat.Message + "\n\nRemplacer le fichier existant ?",
                "Restauration",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);

            if (ecraser == MessageBoxResult.Yes)
            {
                resultat = await _quarantaine.RestaurerAsync(element.Id, ecraser: true);
            }
        }

        MessageBox.Show(resultat.Message, "SentinelAI", MessageBoxButton.OK,
            resultat.Reussi ? MessageBoxImage.Information : MessageBoxImage.Warning);
        RafraichirQuarantaine();
    }

    private void SupprimerDefinitivement(QuarantineEntry? element)
    {
        if (element is null)
        {
            return;
        }

        var confirmation = MessageBox.Show(
            $"Supprimer définitivement « {element.Nom} » ?\n\n" +
            "Cette action est irréversible : le contenu chiffré sera détruit et le fichier ne pourra plus être restauré.",
            "Suppression définitive",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);

        if (confirmation != MessageBoxResult.Yes)
        {
            return;
        }

        var resultat = _quarantaine.SupprimerDefinitivement(element.Id);
        MessageBox.Show(resultat.Message, "SentinelAI", MessageBoxButton.OK,
            resultat.Reussi ? MessageBoxImage.Information : MessageBoxImage.Warning);
        RafraichirQuarantaine();
    }

    // ---- Paramètres ---------------------------------------------------------

    public int NombreRegles { get; }

    public int NombreEmpreintes { get; }

    public string DossierDonnees => SentinelPaths.Root;

    public string FichierBase => SentinelPaths.DatabaseFile;

    public string DossierJournaux => SentinelPaths.JournalDirectory;

    public string DossierRegles => SentinelPaths.RulesDirectory;

    public string EtatSignature => OperatingSystem.IsWindows()
        ? "Vérification Authenticode active (signature embarquée et catalogues système)."
        : "Vérification Authenticode indisponible sur cette plateforme.";

    private void RafraichirTout()
    {
        RafraichirJournal();
        RafraichirQuarantaine();
    }

    private static void Ouvrir(string chemin)
    {
        try
        {
            Process.Start(new ProcessStartInfo(chemin) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Impossible d'ouvrir « {chemin} » :\n{ex.Message}", "SentinelAI",
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }
}

/// <summary>Mises en forme partagées par l'interface.</summary>
public static class Formats
{
    public static string Octets(long valeur) => valeur switch
    {
        < 1024 => $"{valeur} o",
        < 1024 * 1024 => $"{valeur / 1024.0:0.0} Ko",
        < 1024 * 1024 * 1024 => $"{valeur / (1024.0 * 1024):0.0} Mo",
        _ => $"{valeur / (1024.0 * 1024 * 1024):0.00} Go"
    };
}
