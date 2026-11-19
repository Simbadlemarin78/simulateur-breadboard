# Simulateur de breadboard — puissance et casse

Avant de câbler un vrai montage, savoir s'il va marcher et s'il va griller quelque chose.

On décrit le montage, on le met « sous tension ». L'appli calcule tensions et courants, compare chaque broche à la fiche de son composant, et montre ce qui grille, ce qui chauffe et ce qui ne marchera pas. Chaque verdict donne la broche, la valeur, la limite, la page de la datasheet et la correction.

**État : en construction (V1).** Étude, format des fiches et plan : [docs/etude-et-plan.md](docs/etude-et-plan.md).

Version en ligne : https://simbadlemarin78.github.io/simulateur-breadboard/

## Développer

Il faut Node.js 22.12 ou plus récent.

```sh
npm install      # installe les outils
npm run dev      # serveur local sur http://localhost:5173
npm test         # tests (dont la validation des fiches composants)
npm run build    # construit le site dans dist/
```

Licence MIT.
