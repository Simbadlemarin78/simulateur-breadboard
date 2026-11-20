// Prépare la version claude.ai (Artifact) du simulateur à partir du site construit (dist/).
//   npm run build:artifact
// claude.ai enveloppe lui-même la page dans <html>, <head> et <body> : on garde le titre, la
// meta des marges, le style, le contenu du <body> et le script, et on copie le JavaScript à côté.
// Résultat : dist/artifact/index.html et dist/artifact/assets/*.js, à publier avec l'outil
// Artifact (capacités sample et downloads).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const source = readFileSync('dist/index.html', 'utf8');
const un = (motif, nom) => {
  const m = motif.exec(source);
  if (!m) throw new Error(`dist/index.html : ${nom} introuvable (lancer npm run build d'abord)`);
  return m[0];
};
const titre = un(/<title>[\s\S]*?<\/title>/, 'titre');
const marges = un(/<meta name="claude:viewport-fit-sides"[^>]*>/, 'meta des marges');
const style = un(/<style>[\s\S]*?<\/style>/, 'style');
const corps = /<body>([\s\S]*?)<\/body>/.exec(source)?.[1];
if (corps === undefined) throw new Error('dist/index.html : <body> introuvable');
const scripts = [...source.matchAll(/<script[^>]*src="[^"]*"[^>]*><\/script>/g)].map((m) => m[0]);
if (scripts.length === 0) throw new Error('dist/index.html : aucun script');

rmSync('dist/artifact', { recursive: true, force: true });
mkdirSync('dist/artifact/assets', { recursive: true });
writeFileSync('dist/artifact/index.html', [titre, marges, style, corps.trim(), ...scripts].join('\n') + '\n');
const fichiers = readdirSync('dist/assets');
for (const f of fichiers) copyFileSync(`dist/assets/${f}`, `dist/artifact/assets/${f}`);
console.log('dist/artifact/index.html écrit ; fichiers à publier à côté :');
for (const f of fichiers) console.log(`  assets/${f}`);
