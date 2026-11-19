import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : le site marche à la racine (npm run dev) comme sous
  // https://simbadlemarin78.github.io/simulateur-breadboard/ (GitHub Pages).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
