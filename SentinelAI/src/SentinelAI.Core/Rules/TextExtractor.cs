using System.Text;
using SentinelAI.Core.Analysis;

namespace SentinelAI.Core.Rules;

/// <summary>
/// Transforme le contenu brut d'un fichier en texte analysable.
/// Les scripts sont decodes selon leur encodage ; les binaires sont reduits
/// a leurs chaines lisibles (ASCII et UTF-16), ce qui suffit aux regles de contenu.
/// </summary>
public static class TextExtractor
{
    private const int LongueurMinimaleChaine = 5;

    public static string Extraire(ReadOnlySpan<byte> contenu)
    {
        if (contenu.IsEmpty)
        {
            return string.Empty;
        }

        if (FileTypeInspector.EstProbablementTexte(contenu))
        {
            var encodage = FileTypeInspector.DetecterEncodage(contenu);
            try
            {
                return encodage.GetString(contenu);
            }
            catch (DecoderFallbackException)
            {
                // Contenu annonce comme texte mais mal forme : on repasse par l'extraction binaire.
            }
        }

        return ExtraireChaines(contenu);
    }

    /// <summary>Extrait les sequences imprimables ASCII et UTF-16 petit-boutiste.</summary>
    public static string ExtraireChaines(ReadOnlySpan<byte> contenu)
    {
        var resultat = new StringBuilder(Math.Min(contenu.Length / 2, 4 * 1024 * 1024));
        var courante = new StringBuilder(256);

        // Passe 1 : chaines ASCII.
        for (var i = 0; i < contenu.Length; i++)
        {
            var octet = contenu[i];
            if (octet >= 0x20 && octet <= 0x7E)
            {
                courante.Append((char)octet);
                continue;
            }

            Vider(courante, resultat);
        }

        Vider(courante, resultat);

        // Passe 2 : chaines UTF-16 petit-boutiste (courantes dans les binaires Windows).
        for (var i = 0; i + 1 < contenu.Length; i += 2)
        {
            var bas = contenu[i];
            var haut = contenu[i + 1];
            if (haut == 0 && bas >= 0x20 && bas <= 0x7E)
            {
                courante.Append((char)bas);
                continue;
            }

            Vider(courante, resultat);
        }

        Vider(courante, resultat);
        return resultat.ToString();
    }

    private static void Vider(StringBuilder courante, StringBuilder resultat)
    {
        if (courante.Length >= LongueurMinimaleChaine)
        {
            resultat.Append(courante).Append('\n');
        }

        courante.Clear();
    }
}
