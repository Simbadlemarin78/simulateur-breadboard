---
name: ajouter-composant
description: Ajoute un composant au simulateur de breadboard à partir de son nom, de sa référence ou d'un lien. Trouve sa datasheet officielle, écrit sa fiche JSON sourcée (en brouillon) et son dessin 2D avec les noms des broches, lance les tests, puis republie l'appli. À utiliser quand Jean demande d'ajouter, de créer ou de modéliser un composant, une pièce ou un module absent du catalogue.
argument-hint: <nom, référence ou lien du composant>
---

# Ajouter un composant : $ARGUMENTS

Le but : que la pièce apparaisse dans la palette de l'appli, que le moteur vérifie ses broches et que l'assistant puisse l'expliquer. Tout se fait en respectant les règles non négociables de `CLAUDE.md`. Chaque valeur vient d'une source écrite, jamais de mémoire. La fiche reste en brouillon tant que Jean ne l'a pas relue.

Parle à Jean en français et tutoie-le. Explique en une ligne chaque terme technique la première fois. Annonce avant tout téléchargement, toute installation de paquet ou tout push.

## 1. Comprendre le contexte

Lis, sans les recopier :
- `CLAUDE.md`, pour les règles, les verdicts et l'état du projet ;
- [guide-fiche.md](guide-fiche.md), pour ce que le schéma, les tests et le moteur attendent d'une fiche ;
- `schema/fiche-composant.schema.json`, la référence ;
- la fiche existante la plus proche : `tmc2209-module.json` (module) et `tmc2209.json` (sa puce), `resistance.json` ou `condensateur-electrolytique.json` (passif), `alim-labo.json` ou `lipo-4s.json` (source), `17hs4401.json` (moteur), `esp32-devkitc.json` et `esp32.json` (carte et puce).

## 2. Identifier le composant

- **Référence exacte**, fabricant, boîtier : fais confirmer à Jean en une ligne s'il y a un doute (versions, clones, modules de marques différentes).
- **Puce nue ou module ?** Un module (petite carte qui porte une puce) demande deux fiches, la puce et le module (règle 5).
- **Fiche existante ?** Cherche dans `fiches/` : même puce, alias, type Wokwi. Si elle existe, propose de la compléter plutôt que d'en créer une autre.

## 3. Trouver et ranger la datasheet

1. **Datasheet officielle du fabricant d'abord**, dans sa dernière révision. Si Jean donne la page d'un vendeur, cherches-y le lien de la datasheet ou le nom exact de la puce.
2. **Avant de télécharger**, dis à Jean quel fichier, depuis quel site, et attends son accord.
3. **Téléchargement** dans `datasheets/` (ignoré par git : les PDF appartiennent aux fabricants, règle 7), avec un `curl` simple.
   - Jamais de faux user-agent ni de contournement d'une protection anti-robot.
   - Si le site bloque, cherche une copie officielle chez un distributeur (DigiKey, Mouser), ou demande à Jean de le télécharger à la main.
   - Nom : `<puce>-datasheet-<révision>.pdf`.
4. **Extraction du texte** :
   `python -I "${CLAUDE_SKILL_DIR}/scripts/extraire_pdf.py" datasheets/<fichier>.pdf <dossier temporaire>/<fichier>.txt`
   Le script donne aussi l'empreinte sha256. S'il manque pypdf ou pypdfium2, annonce-le, installe-les dans le dossier temporaire de la session (`pip install --target <dossier> pypdf pypdfium2`), puis passe ce dossier en troisième argument.
5. **Index** : ajoute une ligne au tableau de `datasheets/LISEZMOI.md` (fichier, document, source officielle, sha256, état).

Sans datasheet officielle (module générique, moteur sans fiche vendeur), applique la décision de Jean du 19/11/2026. Prends des valeurs réalistes sur des pages web, celles où les sources concordent. Ces valeurs portent une source `hypothese` qui nomme les documents et dit où ils divergent.

## 4. Écrire la fiche

Écris `fiches/<id>.json` en suivant [guide-fiche.md](guide-fiche.md). Lis les tableaux dans le texte extrait :
- Absolute Maximum Ratings → `max_absolus` ;
- Recommended Operating Conditions → `recommande` ;
- Electrical Characteristics → niveaux, résistances, courants ;
- Pin Description → rôles et noms ;
- le schéma d'application, pour comprendre le rôle du composant.

Pour chaque valeur, note la page (numéro du lecteur PDF), le tableau, et une citation de moins de 15 mots. Une valeur introuvable ne s'invente pas : laisse le champ vide, ou fais-en une hypothèse justifiée et signalée.

Pour le **comportement électrique**, utilise seulement un `modele.type` que le moteur sait simuler (tableau du guide). Sinon, pas de `modele` : le moteur vérifie quand même les broches (maxima absolus, diodes de protection, plages recommandées), et le fonctionnement interne reste « non simulé ». Dis-le à Jean, et propose d'ajouter ce type au moteur plus tard, avec des circuits de test calculés à la main.

## 5. Dessin et palette

- **Dessin** : le dessin générique (boîte, broches au pas de 0,1 pouce, noms des broches) suffit souvent. Si la pièce s'enfiche dans la breadboard et que ses broches réelles ne sont pas en une rangée simple, ou si elle mérite un dessin reconnaissable, écris un dessin dédié dans `src/ui/pieces/dessins.ts`. Prends `dessinModuleTmc` pour modèle, et mets les noms des broches tels qu'imprimés sur le composant ou dans la datasheet.
- **Palette** : ajoute un nom court dans `NOMS_COURTS` de `src/ui/main.ts`.

## 6. Vérifier (règle 8 : pas de tests rouges)

1. `npm test` : schéma, cohérence entre fiches (renvois `vers`, domaines, liaisons) et dessins (chaque broche a une position unique). Corrige jusqu'au vert.
2. `npm run build`.
3. **Essai réel** : pose la pièce sur un petit montage d'essai, alimenté normalement puis dans un cas d'erreur typique (tension trop haute). Vérifie avec `npm run verifier -- <montage d'essai>.diagram.json`, ou dans l'appli (`npm run dev`) : verdicts plausibles, aucune fausse alerte en usage normal.

## 7. Rendre compte, puis publier si Jean le demande

Dis à Jean, en quelques lignes :
- la ou les fiches créées, avec la datasheet et sa révision ;
- les valeurs en hypothèse, à relire en priorité, et ce qui est simulé ou non ;
- que la fiche est en brouillon : lui seul la passe à « relue ».

Ajoute la fiche à relire dans les « Bloquants connus » de `CLAUDE.md`.

Ne commite et ne pousse que s'il le demande. Après le push, republie la version claude.ai pour que l'assistant connaisse la pièce :
1. lance `npm run build:artifact` ;
2. publie avec l'outil Artifact sur le même fichier `dist/artifact/index.html`, ce qui garde l'URL notée dans `CLAUDE.md`, avec le nouveau script de `dist/artifact/assets/` dans `files`.
