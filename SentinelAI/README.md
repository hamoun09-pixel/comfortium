# SentinelAI — V0.1

Antivirus personnel pour Windows 11, construit progressivement.

**SentinelAI ne remplace pas Microsoft Defender et ne le désactive jamais.** C'est un
deuxième niveau de surveillance : il applique ses propres règles, explique chacune de
ses décisions, et laisse Defender assurer la protection principale du poste.

---

## Ce que fait la V0.1

| # | Fonction | État |
|---|----------|------|
| 1 | Analyse manuelle d'un fichier ou d'un dossier | ✅ |
| 2 | Empreinte SHA-256 de chaque fichier | ✅ |
| 3 | Détection des types sensibles (`.exe`, `.dll`, `.msi`, `.ps1`, `.bat`, `.cmd`, `.js`, `.vbs`) | ✅ |
| 4 | Vérification de la signature numérique Windows (Authenticode + catalogues) | ✅ |
| 5 | Analyse par règles locales (32 règles intégrées + règles personnelles) | ✅ |
| 6 | Score de risque expliqué, ligne par ligne | ✅ |
| 7 | Journal complet (JSONL + texte + base SQLite) | ✅ |
| 8 | Mise en quarantaine réversible (coffre chiffré AES-256-GCM) | ✅ |
| 9 | Interface simple en français (WPF) | ✅ |

Aucune connexion réseau n'est effectuée pendant l'analyse. Aucun fichier ni aucune
empreinte n'est envoyé à l'extérieur du poste.

---

## Installation

Prérequis : Windows 11, SDK .NET 10, PowerShell en administrateur.

```powershell
cd SentinelAI\install
powershell -ExecutionPolicy Bypass -File .\Install-SentinelAI.ps1
```

Le script vérifie les prérequis, affiche l'état de Defender (sans le modifier),
compile la solution, publie dans `C:\Program Files\SentinelAI`, prépare
`%ProgramData%\SentinelAI` avec des droits restreints sur le coffre et les clés,
puis ajoute un raccourci au menu Démarrer.

Désinstallation :

```powershell
powershell -ExecutionPolicy Bypass -File .\Uninstall-SentinelAI.ps1
# -SupprimerDonnees pour retirer aussi journaux et quarantaine
```

---

## Utilisation

### Interface graphique

`SentinelAI.exe` — quatre onglets : **Analyse**, **Journal**, **Quarantaine**, **Paramètres**.

Choisissez un fichier ou un dossier, lancez l'analyse, et sélectionnez une ligne du
tableau pour voir le détail : empreinte, type réel, état de la signature, et chaque
indicateur qui a contribué au score.

### Ligne de commande

```
sentinelai analyser <chemin> [--sensibles] [--non-recursif] [--seuil 30] [--json]
sentinelai journal [--detections] [--limite 50]
sentinelai quarantaine lister [--tout]
sentinelai quarantaine ajouter <chemin> [--motif "texte"]
sentinelai quarantaine restaurer <id> [--ecraser]
sentinelai quarantaine supprimer <id>
sentinelai regles
```

Code de sortie : `0` normal, `1` si au moins un fichier critique a été trouvé,
`2` en cas d'erreur d'utilisation. `--json` produit une sortie exploitable par script.

---

## Le score de risque

Le score va de 0 à 100. Chaque indicateur ajoute son poids ; une signature valide en
retire. Le score n'est jamais un verdict opaque : l'interface et le journal listent
toujours les contributions.

| Score | Niveau | Signification |
|-------|--------|---------------|
| 0–9 | Sain | Aucun indicateur notable |
| 10–29 | Faible | Indicateurs mineurs, généralement bénins |
| 30–54 | Moyen | À vérifier avant exécution |
| 55–79 | Élevé | Ne pas exécuter, quarantaine recommandée |
| 80–100 | Critique | Menace sérieuse, analyse Defender complète conseillée |

Ajustements liés à la signature numérique :

| État de la signature | Effet |
|----------------------|-------|
| Valide et approuvée | −25 |
| Invalide (fichier modifié après signature) | +40 |
| Signataire non approuvé | +20 |
| Certificat expiré | +8 |
| Non signé, sur un type sensible | +18 |

Une empreinte figurant dans la liste locale des menaces force le score à 100, même
si le fichier est correctement signé.

---

## Règles locales

32 règles sont intégrées à l'application. Elles couvrent l'obfuscation, l'exécution
dynamique, la persistance, le sabotage de Defender ou du pare-feu, le vol
d'identifiants, la suppression des sauvegardes, et les indices de rançongiciel.

Vous pouvez ajouter les vôtres : déposez un fichier `.json` dans
`%ProgramData%\SentinelAI\regles\`. Une règle qui reprend l'identifiant d'une règle
intégrée la remplace.

```json
{
  "version": "0.1",
  "regles": [
    {
      "id": "PERSO-001",
      "nom": "Référence à notre serveur interne",
      "description": "Un script qui contacte le serveur de fichiers depuis un poste client.",
      "poids": 20,
      "cibles": ["Script"],
      "regex": true,
      "motifs": ["\\\\\\\\srv-fichiers\\\\"]
    }
  ]
}
```

Champs : `id`, `nom`, `description`, `categorie`, `poids`, `cibles` (catégories de
fichiers ou `*`), `extensions`, `motifs`, `regex`, `sensibleCasse`, `motifsRequis`,
`active`.

Liste d'empreintes bloquées — un enregistrement par ligne dans
`%ProgramData%\SentinelAI\regles\empreintes-bloquees.txt` :

```
# empreinte sha256;nom de la menace
5d41402abc4b2a76b9719d911017c592...;Exemple.Menace.A
```

---

## Quarantaine

La mise en quarantaine est réversible et l'ordre des opérations garantit qu'aucun
fichier n'est perdu :

1. Le contenu est chiffré (AES-256-GCM, clé locale) dans le coffre.
2. La copie est **déchiffrée et son empreinte est comparée à l'originale**.
3. Seulement en cas de correspondance, l'original est supprimé.

À la restauration, la même vérification est faite avant de rendre le fichier. La clé
du coffre est protégée par DPAPI en portée machine : le coffre n'est déchiffrable que
sur ce poste.

Le chiffrement du coffre a un deuxième effet utile : un fichier en quarantaine n'est
plus exécutable par accident, et les autres outils de sécurité du poste ne le
signalent plus.

---

## Emplacements

| Chemin | Contenu |
|--------|---------|
| `%ProgramData%\SentinelAI\sentinelai.db` | Base SQLite : analyses, résultats, quarantaine |
| `%ProgramData%\SentinelAI\journaux\` | `sentinelai-AAAA-MM-JJ.jsonl` et `.log` |
| `%ProgramData%\SentinelAI\quarantaine\` | Coffre chiffré (droits administrateurs) |
| `%ProgramData%\SentinelAI\cles\` | Clé du coffre, protégée par DPAPI |
| `%ProgramData%\SentinelAI\regles\` | Vos règles et empreintes |

La variable d'environnement `SENTINELAI_DATA` permet de déplacer l'ensemble
(pratique pour un usage portable ou pour des essais).

---

## Développement

```bash
dotnet build SentinelAI.slnx
dotnet test tests/SentinelAI.Core.Tests/SentinelAI.Core.Tests.csproj
dotnet run --project src/SentinelAI.Cli -- analyser C:\Users\moi\Downloads
```

`SentinelAI.Core` cible `net10.0` et non `net10.0-windows` : la bibliothèque reste
compilable et testable hors Windows, ce qui permet de faire tourner les 65 tests en
intégration continue. Les appels spécifiques à Windows sont annotés
`[SupportedOSPlatform("windows")]` et protégés à l'exécution.

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour la structure interne et
[ROADMAP.md](ROADMAP.md) pour la suite (temps réel, AMSI).

---

## Limites connues de la V0.1

- Analyse **manuelle uniquement** : rien n'est surveillé en continu (voir V0.2).
- Pas d'inspection du contenu des archives (`.zip`, `.7z`, `.iso`).
- Pas d'analyse des macros Office : le fichier est vu comme un conteneur.
- L'application ne s'exécute pas en administrateur : les fichiers illisibles par
  l'utilisateur courant sont signalés en erreur, pas analysés.
- Les règles de contenu ne s'appliquent pas au-delà de 128 Mo ; l'empreinte SHA-256
  reste calculée quelle que soit la taille.
- La révocation en ligne des certificats est volontairement désactivée : une analyse
  locale ne doit pas dépendre du réseau.
