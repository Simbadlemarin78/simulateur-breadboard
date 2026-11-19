# Simulateur de breadboard — puissance et casse

Contexte complet : `docs/etude-et-plan.md` (étude de l'existant, format des fiches, plan de V1, limites).
Version en ligne du même document : https://claude.ai/artifact/TKwzr5rAX12MMULFPdoZy5
Ces décisions ont été prises dans une discussion claude.ai le 19/11/2026. Ce fichier les résume pour chaque session.

## Qui je suis, comment me parler

- Jean, élève à l'X (2A), après une prépa MP. Je prépare aussi la Coupe de France de robotique (Eurobot 2027) : ce projet ne doit pas lui prendre trop de temps.
- Débutant en électronique, quelques notions de TypeScript. Explique en 2-3 lignes chaque terme technique ou sigle la première fois qu'il apparaît.
- Réponds en français. Tutoie-moi.
- Je relis tout : quand tu crées ou modifies un fichier, dis en une ou deux lignes à quoi il sert.
- Avant une commande qui installe un paquet, supprime des fichiers ou pousse sur GitHub, annonce-la.

## Le projet en une phrase

Une appli web dans l'esprit de Wokwi : je décris un montage, je le mets « sous tension », l'appli calcule tensions et courants, compare chaque broche à la fiche de son composant et montre ce qui grille, ce qui chauffe et ce qui ne marchera pas, avec l'explication (broche, valeur, limite, page de la datasheet, correction).

## Décisions de la V1

- **Pas de fork de Velxio.** Moteur d'analyse maison en TypeScript, licence MIT. Velxio (AGPLv3) reste la cible d'intégration en V2 ; décision à la fin de la V1.
- **Site statique** sur GitHub Pages, sans serveur. Dépôt public.
- **Pile technique** : Vite (outil de build), TypeScript, Vitest (tests). Pas de framework lourd sans raison ; pas de code copié depuis un projet GPL ou AGPL.
- **Montage** au format `diagram.json` de Wokwi (https://docs.wokwi.com/diagram-format), réglages dans `attrs`.
- **Interface V1** : vue schéma générée depuis le montage. Pas de breadboard en glisser-déposer en V1.
- **Calcul** : régime continu par la méthode des nœuds (système G·V = I), solveur maison, Newton pour les diodes, alim de labo qui passe de tension constante à courant constant à sa limite. ngspice (paquet `eecircuit-engine`, MIT) seulement en V2, pour les phénomènes brefs.
- **Règles** pour ce que le calcul ne voit pas (débranchement à chaud, condensateur absent, état des broches au démarrage...). Le code d'une règle vit dans le moteur ; ses chiffres et sa source vivent dans la fiche.
- **Pas d'émulation du code ESP32** : l'état des broches se règle à la main ; le code se teste dans Wokwi.

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

## Plan de V1 (environ 36 h, quatre semaines à partir du 19/11/2026)

1. **Socle** : Vite + TypeScript + Vitest, CI GitHub Actions, déploiement GitHub Pages. Test : page en ligne, CI verte.
2. **Fiches** : validateur du schéma dans `npm test`, puis fiches ESP32, TMC2209 (puce + module), 17HS4401, breadboard, alim de labo, LiPo 4S, condensateur, résistance, fil Dupont. Test : toutes valides et relues.
3. **Du montage au réseau** : lecture de diagram.json, nœuds avec liaisons internes et bandes du breadboard. Test : les 4 EN sur le même nœud que IO13.
4. **Calcul en continu** : méthode des nœuds + Newton. Test : 6 circuits calculés à la main à moins de 1 % (dont 12 V via 10 kΩ sur une broche 3,3 V ≈ 0,8 mA dans la diode de protection).
5. **Vérifications, règles, verdicts**. Test : les 10 cas donnent le verdict attendu ; le montage corrigé ne donne aucune fausse alerte.
6. **Interface** : vue schéma, « Mettre sous tension », explications, animations, réglages manuels, 10 scénarios, import/export. Test : scénarios rejoués à la main.
7. **Confrontation au vrai montage** au multimètre. Écarts notés dans le README.

Si le temps manque : couper les animations, puis l'édition des fils. Le moteur et les 10 tests passent avant tout.

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
- À vérifier dans la datasheet : le schéma donne 29 V comme « maximum absolu » du TMC2209 ; c'est peut-être le haut de la plage de fonctionnement.

## Structure prévue du dépôt

```
schema/      schéma JSON des fiches
fiches/      une fiche JSON par composant
montages/    base-roulante.diagram.json + cas/ (les 10 cas)
src/moteur/  réseau, calcul, vérifications, règles (aucune dépendance à l'interface)
src/ui/      interface
tests/       tests Vitest
datasheets/  PDF des fabricants (non publiés)
docs/        étude et plan
outils/      scripts annexes
```

## Bloquants connus

- Datasheet TMC2209 (PDF) à déposer dans `datasheets/`.
- Marque et version des modules TMC2209 inconnues (photo recto-verso sinon).
- Datasheets ESP32 (Espressif) et 17HS4401 à récupérer pour l'étape 2.

## Commandes

- `npm install` : installe les outils (une fois, puis après chaque changement de `package.json`).
- `npm run dev` : serveur local avec rechargement automatique (http://localhost:5173).
- `npm test` : lance les tests Vitest une fois (`npm run test:watch` pour les relancer à chaque modification).
- `npm run build` : vérifie les types TypeScript puis construit le site dans `dist/`.
- CI : `.github/workflows/ci.yml` lance tests et build à chaque push ; sur `main`, publie `dist/` sur https://simbadlemarin78.github.io/simulateur-breadboard/.
- Le test du schéma des fiches est `tests/schema.test.ts` (Ajv) ; il valide aussi chaque fichier de `fiches/`.
