using System.Globalization;
using System.Windows;
using System.Windows.Markup;
using System.Windows.Threading;

namespace SentinelAI.App;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        // L'interface est en français : dates, nombres et messages suivent la culture locale.
        var culture = new CultureInfo("fr-CA");
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;
        FrameworkElement.LanguageProperty.OverrideMetadata(
            typeof(FrameworkElement),
            new FrameworkPropertyMetadata(XmlLanguage.GetLanguage(culture.IetfLanguageTag)));

        DispatcherUnhandledException += SurErreurNonGeree;

        base.OnStartup(e);
    }

    private static void SurErreurNonGeree(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show(
            $"Une erreur inattendue s'est produite :\n\n{e.Exception.Message}\n\n" +
            "L'application reste ouverte. Consultez le journal pour le détail.",
            "SentinelAI",
            MessageBoxButton.OK,
            MessageBoxImage.Error);

        e.Handled = true;
    }
}
