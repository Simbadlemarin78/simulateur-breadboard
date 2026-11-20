# Écrire une fiche composant

Référence : `schema/fiche-composant.schema.json` (le test `tests/schema.test.ts` le fait respecter) et les fiches existantes de `fiches/`. Ce guide rassemble ce que le schéma, le test de cohérence et le moteur attendent.

## En-tête

```json
{
  "format": "fiche-composant/1",
  "id": "lm2596-module",              // minuscules, chiffres, tirets ; = nom du fichier
  "nom": "Module abaisseur LM2596",
  "categorie": "module",              // puce, module, carte, passif, source, moteur, connectique
  "fabricant": "...", "reference": "...",
  "description": "À quoi il sert, en 2-3 phrases ; ce que la fiche couvre et ne couvre pas.",
  "documents": [{ "id": "lm2596-ds", "titre": "...", "editeur": "...", "revision": "...", "date": "AAAA-MM-JJ",
                  "url": "lien officiel", "sha256": "empreinte du PDF de datasheets/" }],
  "validation": { "statut": "brouillon", "extraite_par": "Claude", "date_extraction": "AAAA-MM-JJ",
                  "remarques": "Ce qui reste incertain, ce qu'il faut vérifier sur le vrai matériel." }
}
```

- `"statut": "brouillon"` toujours. Seul Jean passe une fiche à `relue` (avec `relue_par` et `date_relecture`).
- Puce et module : deux fiches (règle 5). Le module déclare `"sous_composants": [{ "ref": "U1", "fiche": "<id de la puce>" }]` et chaque broche reliée à la puce porte `"vers": "U1.<broche de la puce>"`.
- Si Wokwi a la pièce : `"wokwi": { "type": "wokwi-..." }`, et les noms de broches de la fiche sont ceux de Wokwi (alias pour les autres noms).

## Sources : chaque nombre en porte une (règle 1)

Une valeur est une grandeur : `{ "min"?, "typ"?, "max"?, "unite", "conditions"?, "src", "note"? }`. L'unité est prise dans la liste du schéma (V, mV, A, mA, µA, Ω, kΩ, µF, W, °C, K/W, Hz, « 1 » pour une fraction...).

- Datasheet : `{ "type": "datasheet", "doc": "<id du document>", "page": <numéro du lecteur PDF>, "ou": "Table 5, Absolute Maximum Ratings", "citation": "moins de 15 mots, recopiés de la ligne" }`.
- Hypothèse : `{ "type": "hypothese", "justification": "pourquoi cette valeur, et quels documents la donnent" }`. Pour un composant sans datasheet officielle, les pages web concordantes, nommées, et où elles divergent.
- Mesure : `{ "type": "mesure", "par": "Jean", "date": "AAAA-MM-JJ", "methode": "..." }`.
- Héritée : `{ "type": "heritee", "fiche": "<id>", "chemin": "modele/valeurs/..." }`.

Jamais de valeur ni de page de mémoire (règle 2) : tout vient du texte extrait de la datasheet.

## Broches

Chaque broche : `nom` (unique), `role`, et ce que la datasheet donne :

- `role` : alim_entree, alim_sortie, masse, entree_logique, sortie_logique, entree_sortie_logique, entree_analogique, sortie_puissance, configuration, communication, non_connectee, autre.
- `position` : `{ "connecteur": "J1", "numero": 3 }` ; c'est elle qui place les broches sur le dessin.
- `domaine` : `{ "alim": "<broche>", "masse": "<broche>" }`, les broches de référence de ses tensions.
- `max_absolus` / `recommande` : `{ "tension": grandeur, "courant": grandeur }`, tensions par rapport à la masse du domaine. Maxima absolus et conditions recommandées restent séparés (règle 4).
- `niveaux` : `vil_max`, `vih_min`, `vol_max`, `voh_min`. En fraction de l'alim, l'unité est « 1 ».
- `entree` : `resistance` (résistance d'entrée), `tirage` (`{ "vers": "alim"|"masse", "resistance": grandeur }`), `diodes_protection` (`{ "vers_alim": true, "vers_masse": true, "courant_injection_max": grandeur, "src": ... }`).
- `sortie` : `resistance_sortie`, `courant_max`.
- `capacites` : `{ "entree", "sortie", "tirage_haut_interne", "tirage_bas_interne", "src" }`. `"sortie": false` pour une entrée seule.
- `etat_demarrage` : `{ "etat": "haute_impedance"|"tirage_haut"|"tirage_bas"|"sortie_haute"|"sortie_basse"|"impulsions"|"inconnu", "src" }`.
- `note` : ce qu'un débutant doit savoir (imprimé « GND » sur la carte, couleur du fil...).

Diodes de protection : le moteur a besoin de leur loi. Mettre une seule fois dans `modele.valeurs.diodes_protection` un objet `{ "tension_directe", "courant", "idealite" }` (trois grandeurs sourcées). Voir `fiches/esp32.json` et `fiches/tmc2209.json`, qui reprennent la note NXP AN4731 faute de donnée du fabricant.

## Liaisons internes d'un module

`"liaisons_internes": [{ "entre": ["EN", "VDD"], "type": "resistance", "valeur": grandeur, "src": ... }]`. Types : `direct` (même nœud, sans valeur), `resistance`, `condensateur` (ouvert en continu), `diode`. Valeurs lues sur le schéma du module.

## Réglages

`"parametres": { "tension": { "description", "unite", "defaut", "min", "max", "choix"?, "src" } }`. Ce sont les `attrs` du diagram.json, réglables dans le panneau Réglages et par l'assistant.

## Modèle de comportement (`modele`) : seulement un type que le moteur connaît

`"modele": { "type": "...", "valeurs": { ... } }`. Ce que `src/moteur/circuit.ts` lit pour chaque type :

| type | réglages (`parametres`) | valeurs (`modele.valeurs`) |
| --- | --- | --- |
| `resistance` | `value` (Ω), `puissance_nominale` (W) | — |
| `condensateur` | `capacite`, `tension_nominale` | `polarise` (fait) ; ouvert en continu |
| `alim_laboratoire` | `tension`, `limite_courant` | `absorbe_courant` (fait), `passage_tension_courant_constant` |
| `batterie` | `tension_element` | `tension_element`, `tension_batterie`, `resistance_interne`, `courant_decharge_continu_max` |
| `moteur_pas_a_pas` | — | `bobines` (table bobine, debut, fin), `resistance_phase`, `courant_nominal_phase` |
| `driver_pas_a_pas` | puce : — ; module : `vref`, `courant_uart` | puce : `tension_pleine_echelle`, `resistance_interne_br`, `tension_vref_pleine_echelle`, `rdson_haut`, `rdson_bas`, `courant_vs_fonctionnement`, `courant_vs_desactive`, `seuil_sous_tension_vs`, `seuil_sous_tension_vcc_io`, `diodes_pont_modele`, `courant_max_diodes_pont`, `courant_rms_continu` ; module : `resistance_mesure` |
| `microcontroleur` | carte : `alimentation_usb`, `consommation` | puce : `diodes_protection`, `resistance_tirage` ; carte : `tension_3v3` |
| `breadboard`, `fil` | — | voir `breadboard-830.json`, `fil-dupont.json` |

Les types `regulateur_lineaire`, `diode`, `led` et `contact` existent dans le schéma, mais le moteur ne les simule pas encore. Un composant d'un autre genre (régulateur, capteur, pont en H d'une autre marque...) n'a donc pas de `modele` qui marche : on ne l'invente pas. On le laisse sans `modele` (ses broches restent vérifiées) et on le dit à Jean. Ajouter un nouveau type, c'est du code dans `circuit.ts`, avec des circuits de test calculés à la main.

## Thermique et règles

- `thermique` : `resistance_thermique` (K/W), `temperature_max`, `seuils` ([{ nom, temperature, effet }]), lus dans la datasheet.
- `regles` : `[{ "id", "verdict", "explication", "correction", "src", "parametres"? }]`. Seuls ces identifiants ont du code (`src/moteur/regles.ts`) : condensateur-reservoir, pas-de-branchement-a-chaud, micro-pas-identiques, en-au-demarrage, entree-seule, broches-de-demarrage, broches-flash, condensateur-polarite, condensateur-surtension, surintensite-batterie. Une nouvelle règle demande son code et un test ; sinon elle apparaît « non simulée ». Une règle ne donne jamais « grillé » (règle 3).

## Dessin

`src/ui/pieces/dessins.ts` choisit un dessin par fiche. Sans dessin dédié, le dessin générique place les broches en rangées au pas de 0,1 pouce (P = 10 px), dans l'ordre de la fiche, avec leurs noms. Un composant qui s'enfiche dans la breadboard doit avoir ses broches là où sont celles du vrai boîtier : sinon, écrire un dessin dédié (modèle : `dessinModuleTmc`), noms de broches compris. Le test `tests/dessins.test.ts` vérifie que chaque broche de chaque fiche a une position, unique, dans le dessin.
