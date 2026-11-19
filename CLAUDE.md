# Simulateur de breadboard — puissance et casse

Contexte complet : `docs/etude-et-plan.md` (étude de l'existant, format des fiches, plan de V1, limites).
Version en ligne du même document : https://claude.ai/artifact/TKwzr5rAX12MMULFPdoZy5
Ces décisions ont été prises dans une discussion claude.ai le 19/11/2026. Ce fichier les résume pour chaque session.
Le même jour, Jean a remplacé la « vue schéma » par un plan de travail 2D interactif : la version en ligne ci-dessus date d'avant ce changement, `docs/etude-et-plan.md` est à jour.

## Qui je suis, comment me parler

- Jean, élève à l'X (2A), après une prépa MP. Je prépare aussi la Coupe de France de robotique (Eurobot 2027) : ce projet ne doit pas lui prendre trop de temps.
- Débutant en électronique, quelques notions de TypeScript. Explique en 2-3 lignes chaque terme technique ou sigle la première fois qu'il apparaît.
- Réponds en français. Tutoie-moi.
- Je relis tout : quand tu crées ou modifies un fichier, dis en une ou deux lignes à quoi il sert.
- Avant une commande qui installe un paquet, supprime des fichiers ou pousse sur GitHub, annonce-la.

## Le projet en une phrase

Une appli web dans l'esprit de Wokwi : je pose mes composants sur un plan de travail 2D, avec ou sans breadboard, je trace les fils, je mets « sous tension » et je mesure ce que je veux. L'appli calcule tensions et courants, compare chaque broche à la fiche de son composant et montre ce qui grille, ce qui chauffe et ce qui ne marchera pas, avec l'explication (broche, valeur, limite, page de la datasheet, correction).

## Décisions de la V1

- **Pas de fork de Velxio.** Moteur d'analyse et éditeur maison en TypeScript, licence MIT. Velxio (AGPLv3) reste une piste pour la V2, surtout pour émuler le code ; décision à la fin de la V1.
- **Site statique** sur GitHub Pages, sans serveur. Dépôt public.
- **Pile technique** : Vite (outil de build), TypeScript, Vitest (tests). Pas de framework lourd sans raison ; pas de code copié depuis un projet GPL ou AGPL.
- **Montage** au format `diagram.json` de Wokwi (https://docs.wokwi.com/diagram-format), réglages dans `attrs`.
- **Interface V1 : plan de travail 2D interactif** (décision de Jean, 19/11/2026, remplace la « vue schéma »). Composants dessinés avec leurs broches, breadboard, pièces qu'on place et déplace, fils tracés à la souris, multimètre (tension entre deux points, courant dans un fil), bouton « Mettre sous tension » avec le verdict affiché sur chaque pièce. La 3D viendra après la V1.
- **Dessins 2D** : [wokwi-elements](https://github.com/wokwi/wokwi-elements) (MIT) quand la pièce existe (moteur pas à pas, résistance, LED...). Sinon, dessins SVG maison : breadboard, module TMC2209, alim de labo, LiPo, condensateur, ESP32 38 broches (wokwi-elements n'a que le DevKit V1 à 30 broches). Les dessins et la position des broches vivent dans `src/ui/` : le moteur n'en dépend pas.
- **Calcul** : régime continu par la méthode des nœuds (système G·V = I), solveur maison, Newton pour les diodes, alim de labo qui passe de tension constante à courant constant à sa limite. ngspice (paquet `eecircuit-engine`, MIT) seulement en V2, pour les phénomènes brefs.
- **Règles** pour ce que le calcul ne voit pas (débranchement à chaud, condensateur absent, état des broches au démarrage...). Le code d'une règle vit dans le moteur ; ses chiffres et sa source vivent dans la fiche.
- **Pas d'émulation du code ESP32** : l'état des broches se règle à la main ; le code se teste dans Wokwi.
- **Composant sans datasheet officielle** (décision de Jean, 19/11/2026) : prendre des valeurs réalistes sur des pages web, celles où les sources concordent ; les petits écarts entre sources ne comptent pas. Ces valeurs portent une source `hypothese` qui nomme les documents et dit où elles divergent.

## Règles non négociables

1. **Toute valeur numérique d'une fiche porte sa source** : datasheet + page du PDF, mesure (qui, quand, comment), hypothèse justifiée, ou valeur héritée d'une autre fiche. Le schéma `schema/fiche-composant.schema.json` refuse un nombre nu.
2. **Ne jamais citer une page ou une valeur de datasheet de mémoire.** Si le PDF n'est pas dans `datasheets/`, demande-le-moi.
3. **« grillé » ne sort que d'un calcul** : limite absolue dépassée ET source capable de fournir assez de courant pour détruire. Une règle donne au mieux « risque élevé ». Ce qui n'est pas simulé s'affiche « non simulé ».
4. **Maxima absolus et conditions recommandées sont deux choses distinctes.** Dépasser les premiers → grillé ou risque ; sortir des secondes → ne marchera pas.
5. **Puce et module = deux fiches** (ex. `tmc2209` et `tmc2209-module`). Chaque broche du module pointe vers la broche de la puce (`"vers": "U1.VS"`).
6. **Une fiche extraite par Claude a le statut `brouillon`.** Seul Jean la passe à `relue`.
7. **Les PDF des datasheets restent dans `datasheets/`**, ignoré par git (droits d'auteur des fabricants). Dans les fiches, on garde l'URL et l'empreinte sha256.
8. **Chaque étape du plan finit par un test automatique.** On ne passe pas à l'étape suivante avec des tests rouges.

## Les cinq verdicts

| Verdict | Quand | Source |
| --- | --- | --- |
| `grille` | Limite absolue dépassée, avec assez d'énergie pour détruire | Calcul seulement |
| `risque_eleve` | Cause de casse documentée, issue non simulable | Règle ou calcul sans donnée de courant |
| `risque` | Comportement dangereux possible, sans casse | Règle |
| `chauffe` | Courant ou puissance au-delà du nominal | Calcul + estimation thermique |
| `ne_marchera_pas` | Fonctionnement impossible ou faux | Calcul ou règle |

## Plan de V1 (environ 55 h, six à sept semaines à partir du 19/11/2026)

Réécrit le 19/11/2026 pour le plan de travail 2D. Le moteur (étapes 1 à 6) ne change pas ; l'éditeur ajoute les étapes 4, 7 et 8. Vers la fin de la quatrième semaine, le moteur doit déjà vérifier le vrai montage, avant le câblage de la base.

1. **Socle** (2 h, fait) : Vite + TypeScript + Vitest, CI GitHub Actions, déploiement GitHub Pages. Test : page en ligne, CI verte.
2. **Fiches** (6 h) : validateur du schéma dans `npm test`, puis fiches ESP32, TMC2209 (puce + module), 17HS4401, breadboard, alim de labo, LiPo 4S, condensateur, résistance, fil Dupont. Test : toutes valides et relues. État au 19/11/2026 : les 11 fiches sont écrites et valides, en brouillon ; reste la relecture de Jean.
3. **Du montage au réseau** (4 h) : lecture de diagram.json, nœuds avec liaisons internes et bandes du breadboard. Test : les 4 EN sur le même nœud que IO13.
4. **Affichage 2D du montage** (5 h) : chaque pièce dessinée à sa position du diagram.json, avec ses broches et ses fils, sans encore pouvoir modifier. Test : chaque broche de chaque fiche a une position sur son dessin ; la base roulante s'affiche en ligne.
5. **Calcul en continu** (8 h) : méthode des nœuds + Newton. Test : 6 circuits calculés à la main à moins de 1 % (dont 12 V via 10 kΩ sur une broche 3,3 V ≈ 0,8 mA dans la diode de protection).
6. **Vérifications, règles, verdicts** (7 h). Test : les 10 cas donnent le verdict attendu ; le montage corrigé ne donne aucune fausse alerte. Le moteur vérifie alors le vrai montage en ligne de commande.
7. **Éditeur** (12 h) : palette de composants, placer et déplacer, enficher dans la breadboard (accrochage aux trous), tracer et supprimer des fils, annuler, import/export du diagram.json. Test : tests automatiques de l'édition (une broche posée sur un trou est reliée à sa bande, un fil tracé apparaît dans le diagram.json, export puis import redonne le même montage).
8. **Mise sous tension et mesures** (8 h) : bouton « Mettre sous tension », verdict affiché sur chaque pièce et panneau d'explications, multimètre (tension entre deux points, courant dans un fil), réglages à la main (niveaux des broches, VREF, tension et limite de l'alim), les 10 scénarios, animations. Test : les mesures affichées égalent celles du moteur ; les 10 scénarios rejoués à la main.
9. **Confrontation au vrai montage** (2 h) au multimètre. Écarts notés dans le README.

Si le temps manque : couper les animations, puis la mesure de courant au clic. Le moteur, les 10 tests et l'édition de base (placer, enficher, tracer les fils) passent avant tout. La 3D est hors V1.

## Les 10 cas de test (critères de réussite)

| # | Cas | Détecté par | Verdict attendu |
| --- | --- | --- | --- |
| 1 | 12 V sur une broche de l'ESP32 | Calcul | `grille` |
| 2 | VM et GND inversés sur un TMC2209 | Calcul | 2a LiPo 4S : `grille`, risque d'incendie signalé ; 2b alim limitée à 1 A : `risque_eleve` (seuil tiré du courant max de la fiche) |
| 3 | Moteur débranché alors que VM est alimenté | Règle (événement) | `risque_eleve` (casse fréquente mais issue non simulable en continu) |
| 4 | Pas de condensateur de 100 µF près d'un driver | Règle | `risque_eleve` |
| 5 | EN qui flotte au démarrage | Règle (état de démarrage de la broche ESP32 + pas de tirage) | `risque` |
| 6 | STEP ou DIR sur IO34 à IO39 (entrées seulement) | Règle (capacité de la broche) | `ne_marchera_pas` |
| 7 | MS1/MS2 différents d'un driver à l'autre, sans UART | Règle (micro-pas comparés dans un groupe) | `ne_marchera_pas` |
| 8 | Masses ESP32 et alim moteurs non reliées | Connexité | `ne_marchera_pas` |
| 9 | Plus d'environ 1 A dans un contact de breadboard | Calcul | `chauffe` |
| 10 | Courant moteur réglé au-dessus de 1,7 A | Calcul + thermique | `chauffe` (`risque` si température estimée au-dessus du seuil de la fiche) |

Verdicts des cas 2 (découpé en 2a/2b) et 3 validés par Jean le 19/11/2026. Le cas 2 donne deux montages de test : 11 fichiers dans `montages/cas/`.

Si un seul driver est inversé et les autres bien câblés, ses deux GND (reliés sur le module) mettent le + de l'alim en court-circuit avec la masse commune : le calcul doit le trouver.

## Montage de référence : base roulante du robot

- ESP32 Keyestudio 38 broches (compatible DevKitC) → 4 TMC2209 → 4 NEMA 17 (17HS4401, 1,7 A max), sur breadboard.
- Alim de labo 12 V aujourd'hui, LiPo 4S 14,8 V (16,8 V chargée) demain.
- Brochage proposé (à confirmer dans le code du robot) : STEP/DIR — avant gauche IO32/IO33, avant droite IO25/IO26, arrière gauche IO27/IO14, arrière droite IO18/IO19. EN commun sur IO13. UART : TX IO17 (via 1 kΩ), RX IO16, sur PDN_UART des 4 drivers. Adresses MS1-MS2 : 0-0, 1-0, 0-1, 1-1.
- À ajouter sur le vrai montage : tirage 10 kΩ de EN vers 3,3 V ; un condensateur 100 µF 35 V par driver entre VM et GND.
- Schéma interactif : https://claude.ai/artifact/CLAxfvyscJcJFKTC59LJJ5
- Vérifié (datasheet TMC2209 rév. 1.08, p. 75) : 29 V est le haut de la plage de fonctionnement de VS ; le maximum absolu est 32 V (33 V pour VVMAX), et −0,5 V en inverse.

## Structure prévue du dépôt

```
schema/      schéma JSON des fiches
fiches/      une fiche JSON par composant
montages/    base-roulante.diagram.json + cas/ (les 10 cas)
src/moteur/  réseau, calcul, vérifications, règles (aucune dépendance à l'interface)
src/ui/      interface : plan de travail 2D, éditeur, multimètre
src/ui/pieces/  dessins 2D des composants et position de leurs broches
tests/       tests Vitest
datasheets/  PDF des fabricants (non publiés)
docs/        étude et plan
outils/      scripts annexes
```

## Bloquants connus

- Datasheet TMC2209 : rév. 1.08 récupérée chez DigiKey (`datasheets/tmc2209-datasheet-rev1.08.pdf`), fiches `tmc2209` et `tmc2209-module` faites (brouillon). La rév. 1.09 n'est que sur analog.com, qui refuse les téléchargements automatiques : Jean la télécharge à la main s'il veut la dernière.
- Marque et version des modules TMC2209 inconnues (photo recto-verso sinon). La fiche `tmc2209-module` suit le schéma BIGTREETECH V1.2 : il tire EN vers VDD par 20 kΩ, ce qui change le cas 5 ; à vérifier au multimètre sur un vrai module.
- 17HS4401 : pas de datasheet officielle. Fiche `fiches/17hs4401.json` (brouillon) faite le 19/11/2026 depuis trois pages web, avec les valeurs sur lesquelles deux sources concordent. À remplacer par la fiche du vendeur si elle arrive.
- ESP32 : fiches `esp32` (puce) et `esp32-devkitc` (carte, noms de broches de Wokwi) faites le 19/11/2026 (brouillon), depuis la datasheet v5.3, le WROOM-32 v3.8 et le schéma DevKitC V4. Restent à confirmer : le module exact (WROOM-32, 32D ou 32E) et l'ordre des broches de la carte Keyestudio. Espressif ne publie aucune limite de courant d'injection : le seuil de « grillé » du cas 1 (200 mA, tiré de l'essai de latch-up) est une hypothèse à valider.
- Cas 5 : après le reset, IO13 a un tirage interne de 45 kΩ vers la masse (p. 69). Avec le tirage de 20 kΩ vers VDD du module BIGTREETECH, EN tombe vers 2,3 V, dans la zone indécise du TMC2209 (entre 0,3 et 0,7 × VCC_IO). Le calcul doit le trouver.
- Fiches génériques (`breadboard-830`, `alim-labo`, `lipo-4s`, `condensateur-electrolytique`, `resistance`, `fil-dupont`) faites le 19/11/2026 sur des modèles courants (Velleman, MaxAmps, Chemi-Con, Samtec). À vérifier sur le vrai matériel : colonnes et rails coupés ou non de la breadboard, modèle de l'alim, capacité et résistance interne de la LiPo. Seuils de « chauffe » retenus : 1 A par contact de breadboard et par fil Dupont (hypothèses). Noms des trous de breadboard repris de projets Wokwi publics (`27t.a`, `tn.6`) : à confirmer à l'étape 3.
- Pas de `pdftoppm` sur la machine : l'outil Read ne peut pas afficher les pages d'un PDF. Pour lire le texte, installer `pypdf` (Python) dans le dossier temporaire de la session, en l'annonçant à Jean.

## Commandes

- `npm install` : installe les outils (une fois, puis après chaque changement de `package.json`).
- `npm run dev` : serveur local avec rechargement automatique (http://localhost:5173).
- `npm test` : lance les tests Vitest une fois (`npm run test:watch` pour les relancer à chaque modification).
- `npm run build` : vérifie les types TypeScript puis construit le site dans `dist/`.
- CI : `.github/workflows/ci.yml` lance tests et build à chaque push ; sur `main`, publie `dist/` sur https://simbadlemarin78.github.io/simulateur-breadboard/.
- Le test du schéma des fiches est `tests/schema.test.ts` (Ajv) ; il valide aussi chaque fichier de `fiches/`. `tests/coherence.test.ts` vérifie ce que le schéma ne voit pas : noms de broches uniques, renvois `vers` vers une broche réelle de la sous-fiche, références de `domaine` et de `liaisons_internes`.
