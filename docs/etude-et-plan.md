# Simulateur de breadboard — étude, fiches et plan de V1

19/11/2026 · Jean Alaniou

## En bref

Pour la V1, on ne forke pas Velxio. On écrit notre propre moteur d'analyse en TypeScript : fiches composants, calcul électrique et règles. Il sera publié sous licence MIT sur GitHub Pages. Velxio reste la cible d'intégration pour la V2.

- **Contexte retenu** : V1 avant de câbler la base (moins d'un mois), au moins 8 h par semaine, code public, notions de TypeScript.
- **Pourquoi pas de fork** : les 10 cas reposent sur des fiches et des règles qu'aucun outil existant ne possède. Velxio est un gros projet : à mon estimation, on passerait la moitié du mois à le comprendre.
- **Interface de la V1** : une vue schéma, dans l'esprit de ton [schéma interactif de la base roulante](https://claude.ai/artifact/CLAxfvyscJcJFKTC59LJJ5). Pas encore de breadboard en glisser-déposer. Le montage est un fichier diagram.json, le format de Wokwi.
- **Calcul** : méthode des nœuds écrite par nous, en régime continu. ngspice arrive en V2, pour les pics brefs.
- **Deux cas de test à reformuler** pour respecter ta règle « risque, pas grillé » : le cas 3 (débranchement à chaud) et le cas 2 (inversion VM/GND). Détails dans « Limites de la V1 ».
- **Bloquant** : la datasheet du TMC2209 et la marque exacte de tes modules.

## Étude de l'existant

Velxio est le seul outil open source qui mélange déjà émulation du code et calcul électrique. Aucun outil ne compare chaque broche à une limite sourcée dans une datasheet, et aucun n'explique en détail pourquoi un composant casse.

| Outil | Ce qui marche bien | Ce qui manque pour nous | Ce qu'on reprend |
| --- | --- | --- | --- |
| [Velxio](https://github.com/davidmonterocrespo24/velxio) (AGPLv3, ou licence commerciale) | Exécute le vrai code (Arduino, ESP32, Pico). Couche électrique [SPICE](https://velxio.dev/docs/instruments/analog-simulation/) qui montre tensions, courants et courts-circuits. Plus de 150 composants. Vérificateur qui bloque les montages qui abîmeraient de vraies pièces, par exemple une LED sans résistance. Très actif : 2,7 k étoiles, 1 626 commits. | Pas de fiche par broche avec des maxima sourcés. Pas de TMC2209 annoncé. L'ESP32 tourne sur le serveur (QEMU) : un fork complet en ligne demande un serveur. Gros code TypeScript + Python. Contributions soumises à un CLA. L'auteur [travaille encore](https://forum.arduino.cc/t/velxio-an-open-source-arduino-rp2040-emulator-running-entirely-in-the-browser/1434847) sur les limites de courant et la casse. | Ses idées d'interface (vérification avant lancement, badge SPICE). À terme, l'intégration de notre moteur. |
| Wokwi (code fermé, bibliothèques MIT) | Meilleure émulation du code ESP32 et Arduino. Format [diagram.json](https://docs.wokwi.com/diagram-format) documenté. Dessins [wokwi-elements](https://github.com/wokwi/wokwi-elements) sous MIT. | L'électricité n'est pas simulée. Sa doc de l'[A4988](https://docs.wokwi.com/parts/wokwi-a4988) indique que VMOT ne sert pas dans la simulation. Pas de TMC2209. | Le format diagram.json (import/export), les dessins, et Wokwi lui-même pour tester le code. |
| [EEcircuit / eecircuit-engine](https://github.com/eelab-dev/EEcircuit-engine) (MIT) | ngspice complet dans le navigateur, avec une API simple (start, setNetList, runSim). C'est le moteur qu'utilise Velxio. | Aucune interface de montage, aucun module de robotique. Il faut lui écrire les circuits en langage SPICE, avec un modèle par composant. | Moteur des phénomènes brefs en V2. |
| [CircuitJS](https://lushprojects.com/circuitjs/) (GPLv2) | Simulation dans le temps, par pas de 5 µs par défaut. Courants animés très parlants. | Composants idéaux : une source fournit un courant infini si on la laisse faire. Pas d'ESP32 ni de driver, pas de casse. Code Java converti par GWT, difficile à intégrer. Reprendre son code impose la GPL. | L'idée d'animer le courant et de colorer les fils selon la tension. |
| Tinkercad Circuits (code fermé) | Alerte posée sur le composant, avec la valeur et la limite (LED au-delà de 20 mA). Un débutant comprend tout de suite. | Ni ESP32, ni driver pas-à-pas. Rien à réutiliser en code. | L'expérience : le verdict s'affiche sur la pièce, avec la valeur, la limite et la correction. |

Quatre termes du tableau :

- **SPICE** : famille de logiciels de référence, née à Berkeley, qui calcule tensions et courants, y compris au cours du temps. ngspice en est la version libre.
- **WebAssembly (WASM)** : format qui fait tourner dans le navigateur du code compilé (ici le C de ngspice), presque à vitesse native.
- **QEMU** : émulateur de processeur. Velxio l'exécute sur son serveur pour faire tourner le vrai programme de l'ESP32.
- **CLA** (accord de contribution) : document à signer avant qu'une contribution soit acceptée. Il permet à l'auteur de redistribuer ton code aussi sous sa licence commerciale.

## Recommandation : notre moteur d'abord, Velxio en V2

Pour la V1, on part de zéro, sur des briques MIT. On décide entre forker Velxio et faire notre propre éditeur à la fin de la V1, pas maintenant.

1. **Ce qui a de la valeur, ce sont les fiches et les règles, pas l'éditeur.** Aucun outil étudié n'a de limite sourcée par broche. Ce moteur peut vivre sans interface et se tester automatiquement sur les 10 cas.
2. **Le délai.** Tu as moins d'un mois, soit 35 à 40 h de travail. Forker Velxio, c'est d'abord comprendre 1 626 commits en TypeScript et en Python. Ensuite, il faudrait brancher les fiches dans sa génération de circuits SPICE. Je l'estime à la moitié du temps disponible avant le premier verdict.
3. **L'hébergement.** Un fork complet a besoin d'un serveur pour la compilation et QEMU. Notre V1 est un site statique : GitHub Pages, gratuit, sans serveur.
4. **Le bon modèle n'est pas SPICE seul.** Un driver qui règle le courant de ses bobines se décrit mieux par un comportement que par ses transistors. Il consomme une puissance sur VM et impose un courant aux bobines. On maîtrise mieux ça dans notre propre solveur.
5. **On garde la porte ouverte.** Du code MIT peut entrer tel quel dans un fork AGPL de Velxio, ou lui être proposé. On lit et on écrit du diagram.json, donc un montage passe d'un outil à l'autre.

Ce qu'on perd en V1 : pas d'éditeur en glisser-déposer, pas d'émulation du code. Le code se teste déjà dans Wokwi. Les fils se modifient dans une liste, et tu peux dessiner le montage dans Wokwi puis l'importer.

Critère de choix pour la V2 :

- Velxio a ajouté la casse de composants, ou accepte des fiches externes : on y contribue avec notre moteur.
- Sinon, on compare deux devis en heures : fork de Velxio, ou notre éditeur sur wokwi-elements.

Licences : MIT = libre avec mention de l'auteur. GPL et AGPL obligent à publier le code dérivé sous la même licence ; l'AGPL l'impose aussi pour un site en ligne. Notre code étant public, l'AGPL d'un éventuel fork ne te gênerait pas.

### Architecture retenue

![Architecture de la V1](architecture-v1.png)

Les règles lisent aussi le réseau et les fiches directement : les cas 3 à 8 n'ont pas besoin du calcul. En V2, on pourra remplacer l'interface (fork de Velxio ou éditeur maison) sans toucher au moteur.

## Format d'une fiche composant

Chaque composant a un fichier JSON, `fiches/<id>.json`. Chaque nombre y porte sa source, et un validateur refuse toute fiche qui contient un nombre nu. Ce validateur est un JSON Schema : un fichier qui décrit les champs permis et que des bibliothèques savent vérifier automatiquement. Le schéma est joint : `fiche-composant.schema.json`. Il est testé : un exemple valide passe, et 10 exemples fautifs sont refusés.

Sept principes :

1. **Une valeur = valeur + unité + source.** La source est l'un de quatre types. `datasheet` donne le document, la page du PDF et le tableau. `mesure` dit qui a mesuré, quand et comment. `hypothese` est justifiée et affichée comme telle. `heritee` renvoie à une autre fiche.
2. **Maxima absolus et conditions recommandées sont deux champs distincts.** Les maxima absolus ne doivent jamais être dépassés, même un instant, sous peine de dégâts. Les conditions recommandées sont la plage où le fabricant garantit le fonctionnement. Dépasser les premiers donne « grillé » ou « risque » ; sortir des secondes donne « ne marchera pas ».
3. **La puce et le module sont deux fiches.** La datasheet du TMC2209 décrit la puce. Ton module ajoute ses propres broches, une résistance de mesure du courant, un potentiomètre et des liaisons internes (les deux GND reliés). Chaque broche du module pointe vers sa broche de puce (`"vers": "U1.VS"`) et en hérite les limites.
4. **Chaque broche dit tout ce dont les règles ont besoin.** On y trouve son rôle, sa masse de référence, ses seuils logiques et son modèle électrique. On y trouve aussi ce qu'elle sait faire (IO34 : `"sortie": false`) et son état au démarrage (pour le cas EN flottant).
5. **Un modèle de comportement par type de composant.** Pas de transistors : le driver est décrit par sa consommation sur VM, le courant qu'il impose aux bobines et sa résistance interne. Le moteur de calcul connaît une liste fermée de types (`driver_pas_a_pas`, `alim_laboratoire`, `batterie`, `contact`…).
6. **Les règles sont déclarées dans la fiche.** Exemple : condensateur d'au moins 100 µF entre VM et GND. Chaque règle porte son verdict, son explication, sa correction et sa source. Le code de la règle vit dans le moteur ; ses chiffres vivent dans la fiche.
7. **Une fiche est « brouillon » tant que tu ne l'as pas relue.** Je l'extrais de la datasheet ; tu la relis et passes son statut à « relue », avec ton nom et la date. Un verdict fondé sur une fiche brouillon est signalé comme tel dans l'appli.

Extrait de forme pour une broche du module TMC2209. Les valeurs et les pages seront remplies depuis la datasheet ; les « ? » ne sont pas des données.

```json
{
  "nom": "VM",
  "role": "alim_entree",
  "vers": "U1.VS",
  "domaine": { "masse": "GND" },
  "max_absolus": {
    "tension": { "min": "?", "max": "?", "unite": "V",
      "src": { "type": "datasheet", "doc": "tmc2209-ds", "page": "?", "ou": "Absolute Maximum Ratings" } }
  },
  "recommande": {
    "tension": { "min": "?", "max": "?", "unite": "V",
      "src": { "type": "datasheet", "doc": "tmc2209-ds", "page": "?", "ou": "Operational Range" } }
  }
}
```

Les cinq verdicts, du plus grave au moins grave. Un verdict « grillé » ne sort jamais d'une règle seule.

| Verdict | Quand | D'où il vient | Exemple |
| --- | --- | --- | --- |
| Grillé | Une limite absolue est dépassée, et la source peut fournir assez de courant pour détruire | Calcul | 12 V sans résistance sur IO32 |
| Risque élevé | Cause de casse documentée, dont l'issue dépend de ce qu'on ne simule pas | Règle, ou calcul sans donnée de courant | Moteur débranché sous tension |
| Risque | Comportement dangereux possible, sans casse | Règle | EN qui flotte au démarrage |
| Chauffe | Courant ou puissance au-delà du nominal | Calcul et estimation thermique | 1,2 A dans un contact |
| Ne marchera pas | Fonctionnement impossible ou faux | Calcul ou règle | STEP sur IO34 |

Chaque verdict affiche le composant, la broche, la valeur calculée, la limite, la page source, l'explication et la correction. Il dit aussi s'il vient d'un calcul ou d'une règle.

## Fiche TMC2209 : en attente de la datasheet

La fiche n'est pas faite : la datasheet n'était pas jointe. Je refuse de citer des pages de mémoire. Dès réception du PDF, je produis deux fiches : `tmc2209` (la puce) et `tmc2209-module` (ta carte).

Ce dont j'ai besoin :

- [ ] Le PDF officiel de la datasheet TMC2209 (Analog Devices / Trinamic), avec sa révision.
- [ ] La marque et la version de tes modules à radiateur bleu (BIGTREETECH, FYSETC, MKS, générique…). Sinon, une photo nette des deux faces : elle donne l'ordre des broches et la valeur de la résistance de mesure.
- [ ] Si le vendeur en publie un, le schéma du module (liaisons internes, tirages sur MS1, MS2 et EN).

Points que je vérifierai dans la datasheet, parce qu'ils changent des verdicts :

- **Le chiffre de 29 V.** Ton schéma de la base roulante le donne comme « maximum absolu ». Il faut vérifier s'il s'agit du maximum absolu ou du haut de la plage de fonctionnement. C'est important pour la LiPo 4S : elle monte à 16,8 V chargée, et un pic au branchement peut approcher le double. La marge dépend de ce chiffre.
- **La tension inverse permise sur VS.** C'est la base du cas 2 (inversion VM/GND).
- **Le courant maximal des sorties**, en valeur efficace et en crête, et la formule qui relie la tension de réglage (Vref) au courant, avec la résistance de mesure du module.
- **La table MS1/MS2 → micro-pas**, et l'existence de tirages internes sur MS1, MS2 et EN. Ton schéma suppose que MS1/MS2 débranchées valent 0 : c'est à vérifier.
- **Les seuils thermiques** (pré-alerte, coupure) et la résistance thermique du boîtier.
- **Le condensateur recommandé sur VS** (valeur et placement), et toute mise en garde sur le branchement du moteur sous tension. Ce sont les sources des cas 3 et 4.

Les autres fiches de la V1 et leur source :

| Fiche | Document nécessaire | Pour quels cas |
| --- | --- | --- |
| ESP32 Keyestudio 38 broches | Datasheet ESP32 d'Espressif + schéma DevKitC (ou celui de Keyestudio) | 1, 5, 6, 8 |
| 17HS4401 | Fiche technique du vendeur du moteur | 10 |
| Breadboard | Fiche du fabricant si elle existe, sinon hypothèse justifiée (environ 1 A par contact) | 9 |
| Alim de labo, LiPo 4S | Réglages donnés dans le montage (tension, limite de courant) | 2, 9 |
| Condensateur, résistance, fil Dupont | Valeurs données dans le montage | 4, 5 |

## Plan de V1

Sept étapes, environ 36 h, sur quatre semaines à partir du 19 novembre. Chaque étape se termine par un test qu'on peut relancer. Les 10 cas deviennent 10 fichiers de montage, vérifiés automatiquement à chaque modification du code.

1. **Socle** (environ 2 h, semaine 1). Dépôt GitHub public sous licence MIT, avec Vite, TypeScript et Vitest, et une mise en ligne automatique sur GitHub Pages.
   - Vite construit et sert l'appli web ; Vitest lance les tests automatiques.
   - La CI (intégration continue) : GitHub relance tous les tests à chaque envoi de code.
   - Test : la page en ligne s'affiche et la CI est verte.
2. **Fiches** (environ 5 h, semaine 1). Le schéma et son validateur, puis les fiches ESP32, TMC2209 (puce et module), 17HS4401, breadboard, alim de labo, LiPo 4S, condensateur, résistance et fil Dupont. Je les extrais des PDF ; tu les relis.
   - Test : toutes les fiches passent le validateur et sont au statut « relue ».
3. **Du montage au réseau** (environ 4 h, semaine 2). Lecture du diagram.json et des réglages : tension et limite de courant des alims, courant réglé des drivers, niveau des broches choisi à la main. On construit les nœuds (les points du circuit au même potentiel) en tenant compte des liaisons internes des modules et des bandes du breadboard.
   - Test : sur la base roulante, les quatre EN sont sur le même nœud que IO13, et le nombre de nœuds est celui compté à la main.
4. **Calcul en continu** (environ 8 h, semaine 2). Méthode des nœuds : la loi des nœuds en chaque point donne un système linéaire G·V = I, qu'on résout. Les diodes ne sont pas linéaires : on linéarise et on itère avec la méthode de Newton, vue en prépa. L'alim de labo passe de « tension constante » à « courant constant » quand elle atteint sa limite.
   - Test : six circuits calculés à la main, à moins de 1 % près. Pont diviseur, LED + résistance, alim limitée en court-circuit, deux sources qui se battent, consommation d'un driver. Et 12 V à travers 10 kΩ sur une broche 3,3 V : environ 0,8 mA dans la diode de protection, soit (12 − 3,3 − 0,6) V / 10 kΩ.
5. **Vérifications, règles, verdicts** (environ 7 h, semaine 3). Chaque broche est comparée à sa fiche, la température est estimée (T ≈ T ambiante + Rth × P), et les règles tournent. Chaque verdict sort avec sa valeur, sa limite, sa source, son explication et sa correction.
   - Test : les 10 montages donnent chacun le verdict attendu, sur la bonne broche.
   - Test : le montage corrigé ne donne aucun verdict rouge. C'est le critère « zéro fausse alerte ». Corrigé veut dire : condensateurs, tirage sur EN, masse commune, MS1/MS2 identiques.
   - À la fin de cette étape, le moteur vérifie déjà ton vrai montage en ligne de commande, avant l'interface.
6. **Interface** (environ 8 h, semaines 3 et 4). Vue schéma générée depuis le montage, bouton « Mettre sous tension » et panneau d'explications. Animations : rouge et fumée pour « grillé », orange pulsé pour « chauffe ». Réglages à la main (niveaux des broches, EN, UART), choix parmi les 10 scénarios, édition des fils en liste, import et export du diagram.json.
   - Test : les 10 scénarios rejoués à la main dans le navigateur, avec une liste à cocher.
7. **Confrontation au vrai montage** (environ 2 h, semaine 4). On mesure trois grandeurs au multimètre sur la base câblée et on les compare au calcul. Les trois grandeurs : courant sur VM moteurs activés à l'arrêt, tension sur EN au démarrage, chute de tension sur le rail VM.
   - Test : les écarts sont notés dans le README. Au-delà de 20 %, on corrige la fiche ou le modèle.

Si le temps manque, on coupe d'abord les animations puis l'édition des fils. Le moteur et les 10 tests sont le cœur de la V1.

Les 10 cas et ce qui doit les détecter :

| # | Cas | Détecté par | Verdict attendu | Étape |
| --- | --- | --- | --- | --- |
| 1 | 12 V sur une broche de l'ESP32 | Calcul : tension de broche au-delà du maximum absolu, courant dans la diode de protection | Grillé (source sans résistance) | 4, 5 |
| 2 | VM et GND inversés sur un TMC2209 | Calcul : tension inverse sur VS, courant fourni par la source | Grillé ou risque élevé selon la source (voir Limites) | 4, 5 |
| 3 | Moteur débranché avec VM alimenté | Règle : fil de bobine retiré pendant que VM est sous tension | Risque élevé (voir Limites) | 5 |
| 4 | Pas de 100 µF près d'un driver | Règle : condensateur assez gros entre VM et GND du driver, à quelques trous | Risque élevé | 5 |
| 5 | EN qui flotte au démarrage | Règle : état de démarrage de la broche ESP32 (fiche) et aucun tirage sur le nœud EN | Risque | 5 |
| 6 | STEP ou DIR sur IO34 à IO39 | Règle : broche sans capacité de sortie reliée à une entrée qui attend un signal | Ne marchera pas | 5 |
| 7 | MS1/MS2 différents d'un driver à l'autre, sans UART | Règle : micro-pas déduit des niveaux (table de la fiche), comparé entre drivers | Ne marchera pas (vitesses différentes) | 5 |
| 8 | Masses non reliées | Connexité : la masse de référence de l'émetteur et du récepteur n'est pas le même nœud | Ne marchera pas | 3, 5 |
| 9 | Plus d'environ 1 A dans un contact | Calcul : courant dans chaque contact, comparé à la fiche du breadboard | Chauffe | 4, 5 |
| 10 | Courant moteur réglé au-delà de 1,7 A | Calcul : réglage comparé au nominal du moteur ; puissance perdue dans le driver | Chauffe ; risque si la température estimée dépasse le seuil de la fiche | 4, 5 |

Une prédiction à vérifier à l'étape 7 : ton montage de référence déclenchera sans doute le cas 9. Réglé à 1 A efficace, le courant d'une bobine monte jusqu'à √2 × 1 A ≈ 1,4 A en crête. Sur tes photos, les sorties moteur passent par les contacts du breadboard.

## Limites de la V1, et deux cas à reformuler

La V1 calcule le régime établi, rien de ce qui dure une fraction de seconde. Pour chaque phénomène non simulé, une règle dit « risque » quand elle existe. Sinon, l'écran l'indique clairement : « non simulé ».

| Non simulé en V1 | Conséquence | Quand |
| --- | --- | --- |
| Pic de tension au branchement d'une alim (fils longs + condensateurs céramiques) | Couvert par la règle du condensateur 100 µF (cas 4) | V2 avec ngspice |
| Tension renvoyée par un moteur qui freine ou tourne vite | Non couvert | V2 |
| Découpage du courant par le driver (chopper) | On calcule des moyennes et des crêtes, pas la forme d'onde | V2 si utile |
| Échauffement au fil du temps | On estime la température finale seulement | V2 |
| Décharges électrostatiques, faux contacts | Non couvert | Hors projet |
| Le programme de l'ESP32 | Niveaux des broches réglés à la main ; le code se teste dans Wokwi | Plus tard |

**Cas 3, à reformuler : « risque élevé » au lieu de « grillé ».** Débrancher un moteur sous tension casse souvent un driver, mais pas toujours. L'issue dépend du courant dans la bobine à l'instant où le contact s'ouvre. Un calcul en continu ne peut pas le savoir. D'après ta propre règle, le verdict honnête est « risque élevé : casse fréquente, ne jamais le faire ».

**Cas 2, à découper selon la source.**

- **2a, LiPo 4S** : aucune limite de courant, des dizaines d'ampères disponibles. Le verdict attendu est « grillé », avec un risque d'incendie signalé.
- **2b, alim de labo limitée à 1 A** : le courant est borné et le driver peut survivre. Le verdict attendu est « risque élevé ». Le seuil exact viendra du courant maximal de la fiche.

Un détail que seul le calcul voit : si un seul driver est inversé et les trois autres sont bien câblés, le GND du driver inversé reçoit le + de l'alim. Comme ses deux GND sont reliés sur le module, il met le + en court-circuit avec la masse commune. Le calcul doit trouver ce court-circuit franc, en plus de la tension inverse.

## Prochaines étapes

Rien n'est codé tant que tu n'as pas validé ce document. Ensuite, je commence par l'étape 1 du plan.

- [ ] Toi : joindre la datasheet TMC2209 et la référence (ou une photo) de tes modules.
- [ ] Toi : valider les deux reformulations (cas 2 découpé en 2a/2b, cas 3 en « risque élevé »).
- [ ] Toi : choisir le nom du dépôt sur ton compte GitHub Simbadlemarin78, et me dire si je peux y pousser le socle.
- [ ] Moi : fiches TMC2209 (puce et module) dès réception du PDF, puis ESP32 et 17HS4401.
- [ ] Moi : étape 1 (socle) après ton feu vert.

Questions encore ouvertes :

- Que veut dire « près du driver » pour le condensateur ? Je propose d'abord « sur les mêmes bandes du breadboard que VM et GND du driver », à affiner.
- Les quatre drivers forment-ils un « groupe » déclaré dans le montage (la base roulante) ? Le cas 7 compare les micro-pas à l'intérieur d'un groupe. Je propose oui, via un attribut du montage.

## Sources

Pages consultées le 19 novembre 2026 :

- [Dépôt GitHub de Velxio](https://github.com/davidmonterocrespo24/velxio) : architecture, licence double AGPLv3 / commerciale, CLA, activité.
- [Velxio, documentation de la simulation analogique](https://velxio.dev/docs/instruments/analog-simulation/) : composants modélisés, vérificateur avant lancement.
- [Annonce de Velxio sur le forum Arduino](https://forum.arduino.cc/t/velxio-an-open-source-arduino-rp2040-emulator-running-entirely-in-the-browser/1434847) : travaux sur les limites de courant et la casse, version 2.5 avec ngspice.
- [Wokwi, format diagram.json](https://docs.wokwi.com/diagram-format)
- [Wokwi, pièce A4988](https://docs.wokwi.com/parts/wokwi-a4988) : VMOT non utilisé dans la simulation.
- [wokwi-elements](https://github.com/wokwi/wokwi-elements) : licence MIT.
- [eecircuit-engine](https://github.com/eelab-dev/EEcircuit-engine) : licence MIT, API.
- [CircuitJS1](https://lushprojects.com/circuitjs/) : GPLv2, pas de temps de 5 µs, composants idéaux.
- [Schéma interactif de la base roulante](https://claude.ai/artifact/CLAxfvyscJcJFKTC59LJJ5) : broches, câblage, chiffre de 29 V à vérifier.
