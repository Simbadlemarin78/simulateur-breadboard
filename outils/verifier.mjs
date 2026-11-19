// Vérifie un ou plusieurs montages en ligne de commande :
//   npm run verifier -- montages/base-roulante.diagram.json
// Le moteur est en TypeScript et lit les fiches avec import.meta.glob de Vite : on le charge
// donc par Vite (runnerImport), sans rien installer de plus.
// Code de sortie : 0 rien à signaler, 1 au moins un constat, 2 montage illisible ou calcul impossible.
import { readFile } from 'node:fs/promises';
import { runnerImport } from 'vite';

const fichiers = process.argv.slice(2);
if (fichiers.length === 0) {
  console.error('Usage : npm run verifier -- <montage.diagram.json> [autres montages...]');
  process.exit(2);
}

const { module } = await runnerImport('/src/moteur/rapport-texte.ts', { logLevel: 'error' });
let code = 0;
for (const fichier of fichiers) {
  let donnees;
  try {
    donnees = JSON.parse(await readFile(fichier, 'utf8'));
  } catch (e) {
    console.log(`${fichier} : lecture impossible (${e.message})\n`);
    code = 2;
    continue;
  }
  const r = module.verifierEnTexte(donnees, fichier);
  console.log(`${r.texte}\n`);
  code = Math.max(code, r.code);
}
process.exit(code);
