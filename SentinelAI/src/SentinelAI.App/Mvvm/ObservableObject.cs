using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;

namespace SentinelAI.App.Mvvm;

/// <summary>Base minimale de notification de changement, sans dépendance externe.</summary>
public abstract class ObservableObject : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected void Notifier([CallerMemberName] string? propriete = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propriete));

    protected bool Definir<T>(ref T champ, T valeur, [CallerMemberName] string? propriete = null)
    {
        if (EqualityComparer<T>.Default.Equals(champ, valeur))
        {
            return false;
        }

        champ = valeur;
        Notifier(propriete);
        return true;
    }
}

/// <summary>Commande simple pour les boutons de l'interface.</summary>
public sealed class RelayCommand(Action<object?> action, Func<object?, bool>? peutExecuter = null) : ICommand
{
    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parametre) => peutExecuter?.Invoke(parametre) ?? true;

    public void Execute(object? parametre) => action(parametre);

    public void Reevaluer() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

/// <summary>Commande asynchrone qui se désactive pendant son exécution.</summary>
public sealed class AsyncRelayCommand(
    Func<object?, Task> action,
    Func<object?, bool>? peutExecuter = null) : ICommand
{
    private bool _enCours;

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parametre) => !_enCours && (peutExecuter?.Invoke(parametre) ?? true);

    public async void Execute(object? parametre)
    {
        _enCours = true;
        Reevaluer();

        try
        {
            await action(parametre);
        }
        finally
        {
            _enCours = false;
            Reevaluer();
        }
    }

    public void Reevaluer() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
