using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using SentinelAI.App.ViewModels;
using SentinelAI.Core.Models;

namespace SentinelAI.App.Converters;

/// <summary>Couleur associée au niveau de risque.</summary>
public sealed class NiveauVersCouleur : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var niveau = value as RiskLevel? ?? RiskLevel.Sain;
        return new SolidColorBrush((Color)ColorConverter.ConvertFromString(niveau.Couleur()));
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Libellé français du niveau de risque.</summary>
public sealed class NiveauVersLibelle : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is RiskLevel niveau ? niveau.Libelle() : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Taille de fichier lisible.</summary>
public sealed class TailleLisible : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is long octets ? Formats.Octets(octets) : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Libellé de l'état de signature.</summary>
public sealed class SignatureVersLibelle : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is SignatureInfo signature ? signature.Libelle : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Date UTC affichée en heure locale.</summary>
public sealed class DateLocale : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value switch
    {
        DateTime date => date.ToLocalTime().ToString("yyyy-MM-dd HH:mm", culture),
        null => "",
        _ => value.ToString() ?? ""
    };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
