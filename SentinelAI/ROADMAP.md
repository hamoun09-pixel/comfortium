# Feuille de route — SentinelAI

Principe qui ne change pas : SentinelAI travaille **avec** Microsoft Defender. Aucune
version prévue ne désactive Defender ni ne s'y substitue.

---

## V0.1 — Scanner local sécurisé ✅

Analyse manuelle, SHA-256, types sensibles, signature Authenticode, règles locales,
score expliqué, journal complet, quarantaine réversible, interface française.

---

## V0.2 — Surveillance en temps réel

Ajout d'une surveillance continue avec `FileSystemWatcher` sur un petit nombre de
dossiers choisis (Téléchargements, Bureau, `%TEMP%`, clés USB à leur montage).

Ce qu'il faudra résoudre, et qui n'est pas trivial :

- **Rafale d'événements.** Un seul enregistrement de fichier produit souvent
  plusieurs notifications. Il faut regrouper les événements par chemin sur une
  fenêtre courte (≈ 500 ms) avant de déclencher une analyse.
- **Fichier encore verrouillé.** L'événement arrive avant que l'écriture soit
  terminée. Prévoir une file d'attente avec réessais espacés plutôt qu'une lecture
  immédiate.
- **Débordement du tampon.** `FileSystemWatcher` perd des événements quand le tampon
  interne déborde (`InternalBufferSize`), et signale l'incident par `Error`. La
  réponse correcte est de relancer une analyse complète du dossier concerné, pas
  d'ignorer.
- **Empreintes déjà connues.** Un cache SHA-256 → verdict évite de réanalyser
  cent fois le même fichier.
- **Ne pas se mordre la queue.** Les écritures de SentinelAI lui-même (journal,
  coffre, base) doivent être exclues de la surveillance.

L'analyse en temps réel réutilise `ScanEngine` tel quel : seule la source des chemins
change. Une nouvelle valeur `mode = 'temps-réel'` distingue ces analyses dans la base.

Interface : un onglet **Surveillance** avec la liste des dossiers surveillés, un
interrupteur marche/arrêt, et le flux des derniers événements.

---

## V0.3 — Intégration AMSI

AMSI (*Antimalware Scan Interface*) est l'interface officielle de Windows qui permet
à une application de transmettre un contenu au produit antimalware installé sur le
poste. Elle est particulièrement utile pour les scripts et les menaces sans fichier,
car elle reçoit le contenu **après** dé-obfuscation, au moment où l'interpréteur
s'apprête à l'exécuter.

Plan technique :

- `amsi.dll` via P/Invoke : `AmsiInitialize`, `AmsiOpenSession`, `AmsiScanBuffer`,
  `AmsiScanString`, puis `AmsiCloseSession` / `AmsiUninitialize`.
- Interprétation de `AMSI_RESULT` : `AMSI_RESULT_CLEAN` (0),
  `AMSI_RESULT_NOT_DETECTED` (1), plage 32–32767 « détecté avec risque croissant »,
  `AMSI_RESULT_DETECTED` (32768).
- Nouvel indicateur `AMSI-001`, de poids élevé, avec le résultat brut en preuve.
- Abstraction `IAmsiScanner` avec une implémentation neutre hors Windows, sur le
  modèle de `IAuthenticodeVerifier` — pour que `Core` reste testable partout.

Point important : AMSI transmet le contenu au produit antimalware **déjà installé**,
c'est-à-dire à Defender dans le cas courant. C'est exactement la logique du projet —
demander un second avis à l'outil du poste plutôt que de réimplémenter un moteur.

---

## Au-delà

Par ordre d'utilité décroissante, sous réserve de ce qu'aura montré l'usage réel :

- **Inspection des archives** (`.zip`, `.7z`, `.cab`, `.iso`) avec limite de
  profondeur et garde-fou contre les bombes de décompression.
- **Analyse structurelle des PE** : sections en écriture et exécution, entropie
  élevée révélant un empaquetage, table d'importation, horodatage incohérent.
- **Macros Office** : extraction du projet VBA des conteneurs OOXML et OLE, puis
  passage par le moteur de règles existant.
- **Rapport exportable** (HTML ou PDF) pour une analyse donnée.
- **Planification** d'analyses régulières via le Planificateur de tâches Windows.
- **Règles partagées** : format d'échange pour diffuser un jeu de règles entre
  plusieurs postes, avec signature du fichier de règles.

## Ce qui restera hors périmètre

- Remplacer Defender ou s'enregistrer comme produit antivirus du système.
- Pilote noyau ou mini-filtre de système de fichiers.
- Envoi de fichiers ou d'empreintes vers un service en ligne.
- Suppression automatique sans action de l'utilisateur : la quarantaine reste un
  geste volontaire, et elle reste réversible.
