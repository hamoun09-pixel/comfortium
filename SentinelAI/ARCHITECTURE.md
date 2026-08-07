# Architecture — SentinelAI V0.1

## Projets

```
SentinelAI.slnx
├── src/SentinelAI.Core   (net10.0)          bibliothèque d'analyse, sans interface
├── src/SentinelAI.App    (net10.0-windows)  interface WPF en français
├── src/SentinelAI.Cli    (net10.0)          outil en ligne de commande
└── tests/SentinelAI.Core.Tests              65 tests xUnit
```

`Core` ne référence ni WPF ni aucune API d'interface. Les deux applications sont de
simples pilotes autour d'elle : tout ce qui décide d'un verdict est testable sans
Windows.

## Chaîne d'analyse d'un fichier

`ScanEngine.AnalyserFichierAsync` exécute sept étapes, dans cet ordre :

| # | Étape | Composant | Note |
|---|-------|-----------|------|
| 1 | Empreinte SHA-256 | `FileHasher` | En flux, toujours calculée |
| 2 | Type réel (512 premiers octets) | `FileTypeInspector` | Compare l'extension au contenu |
| 3 | Indicateurs structurels | `StructuralAnalyzer` | Nom, emplacement, attributs, zone Internet |
| 4 | Empreinte répertoriée | `HashBlocklist` | Force le niveau critique |
| 5 | Règles de contenu | `RuleEngine` + `TextExtractor` | ≤ 128 Mo par défaut |
| 6 | Signature Authenticode | `WindowsAuthenticodeVerifier` | Embarquée puis catalogues |
| 7 | Score expliqué | `RiskScorer` | Somme pondérée, bornée 0–100 |

L'ordre n'est pas arbitraire : les étapes les moins coûteuses viennent en premier, et
l'étape 2 peut reclasser le fichier (un PE nommé `.txt` devient un exécutable), ce qui
change les règles applicables aux étapes suivantes.

Une exception sur un fichier produit un `FileAnalysis` en erreur, jamais un arrêt de
l'analyse. Le parallélisme est géré par `Parallel.ForEachAsync`, avec annulation
coopérative.

## Points de conception

**Vérification de signature en deux temps.** `WinVerifyTrust` sur le fichier seul ne
détecte pas les signatures par catalogue — or la plupart des binaires de Windows sont
signés ainsi. Sans le repli catalogue (`CryptCATAdmin*` + `WINTRUST_CATALOG_INFO`),
chaque DLL du système serait signalée « non signée » et le bruit rendrait l'outil
inutilisable. Le code fait donc : signature embarquée → si absente, recherche du
fichier dans les catalogues système → vérification du membre de catalogue.

**Extraction de texte adaptée au format.** Les scripts sont décodés selon leur
encodage (BOM détecté). Les binaires sont réduits à leurs chaînes lisibles, en ASCII
et en UTF-16 petit-boutiste — c'est ce second passage qui permet de retrouver
`powershell.exe -nop` dans un exécutable.

**Le score peut descendre.** Une signature valide vaut −25. C'est ce qui évite
d'inonder l'utilisateur d'alertes sur des logiciels légitimes qui font des choses
légitimement inhabituelles. Seule une correspondance d'empreinte ignore cet
ajustement.

**Quarantaine en trois temps.** Chiffrer → relire et comparer l'empreinte →
seulement alors supprimer l'original. Si une étape échoue, le fichier d'origine est
toujours là. Le coffre utilise AES-256-GCM par blocs de 64 Kio, avec un nonce dérivé
d'une base aléatoire et du numéro de bloc, et un bloc de longueur nulle en marque de
fin pour détecter une troncature.

**Aucun réseau.** Ni téléchargement de signatures, ni télémétrie, ni vérification de
révocation en ligne (`WTD_REVOKE_NONE`) : une analyse locale ne doit pas dépendre
d'un serveur OCSP joignable.

## Stockage

Base SQLite unique en mode WAL, créée au démarrage :

- `analyses` — une ligne par session d'analyse
- `resultats` — un résultat par fichier, avec indicateurs et explications en JSON
- `quarantaine` — état du coffre, y compris les éléments restaurés ou supprimés
- `parametres` — clé/valeur

Le journal est écrit en double : `.jsonl` pour l'exploitation automatisée, `.log`
pour la lecture directe. L'écriture du journal ne peut jamais faire échouer une
analyse (les erreurs d'entrée-sortie y sont absorbées).

## Sécurité de l'outil lui-même

- Le coffre et les clés sont protégés par ACL (administrateurs + SYSTEM), appliquées
  par le script d'installation.
- La clé du coffre est protégée par DPAPI en portée machine : elle n'est
  déchiffrable que sur le poste où elle a été créée.
- Les extraits de preuve affichés sont tronqués à 120 caractères et débarrassés de
  leurs caractères de contrôle, pour qu'un contenu hostile ne puisse pas perturber
  l'affichage ni le journal.
- Le dossier de quarantaine est toujours exclu de l'énumération : SentinelAI ne
  s'analyse pas lui-même.
- Les expressions régulières ont un délai maximal de 2 secondes ; un motif trop
  coûteux est abandonné, pas bloquant.
- L'application tourne sans élévation (`asInvoker`).

## Tests

65 tests couvrent les empreintes, la détection de type et les incohérences, les
règles (déclenchement et absence de faux positif sur un script d'administration
ordinaire), les seuils de score, l'aller-retour de chiffrement du coffre, le refus
d'un coffre altéré, le cycle complet de quarantaine, et l'analyse de dossier.

La parallélisation xUnit est désactivée : `SentinelPaths.Root` est un état global au
processus, ce qui est voulu pour une application de bureau mais incompatible avec des
classes de test concurrentes.
