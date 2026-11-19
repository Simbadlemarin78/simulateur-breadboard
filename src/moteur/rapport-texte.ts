// Rapport de vérification en texte, pour la ligne de commande (outils/verifier.mjs).
import { NOMS_VERDICTS, type Constat } from './constats';
import type { Source } from './fiche';
import { catalogueIntegre } from './fiches-integrees';
import { lireMontage, MontageInvalide } from './montage';
import { verifier } from './verifications';

function texteSource(s: { fiche: string; src: Source }): string {
  const src = s.src as Source & { doc?: string; page?: number; ou?: string; justification?: string; fiche?: string; chemin?: string; par?: string; date?: string };
  switch (src.type) {
    case 'datasheet':
      return `${src.doc}, p. ${src.page}${src.ou ? ` (${src.ou})` : ''}`;
    case 'hypothese':
      return `hypothèse de la fiche ${s.fiche}`;
    case 'mesure':
      return `mesure de ${src.par} le ${src.date}`;
    case 'heritee':
      return `valeur reprise de la fiche ${src.fiche} (${src.chemin})`;
  }
}

function texteConstat(c: Constat): string {
  const lignes = [`${NOMS_VERDICTS[c.verdict].toUpperCase().padEnd(16)} ${c.titre}${c.regle ? `   [règle ${c.regle}]` : '   [calcul]'}`];
  lignes.push(`    Pourquoi : ${c.explication}`);
  if (c.correction) lignes.push(`    Correction : ${c.correction}`);
  if (c.source) lignes.push(`    Source : ${texteSource(c.source)}${c.brouillon ? ' (fiche en brouillon)' : ''}`);
  return lignes.join('\n');
}

/** Vérifie un diagram.json et renvoie le rapport en texte, avec un code de sortie (0 : rien à signaler). */
export function verifierEnTexte(donnees: unknown, nom: string): { texte: string; code: number } {
  let montage;
  try {
    montage = lireMontage(donnees, catalogueIntegre);
  } catch (e) {
    const erreurs = e instanceof MontageInvalide ? e.erreurs : [String(e)];
    return { texte: `${nom} : montage illisible\n${erreurs.map((x) => `  - ${x}`).join('\n')}`, code: 2 };
  }
  const debut = performance.now();
  const r = verifier(montage, catalogueIntegre);
  const duree = Math.round(performance.now() - debut);
  const lignes = [`${nom} : ${montage.pieces.length} pièces, ${montage.connexions.length} connexions, calcul en ${duree} ms`];
  if (!r.converge) {
    lignes.push(`  Calcul impossible : ${r.message}`);
    return { texte: lignes.join('\n'), code: 2 };
  }
  if (r.constats.length === 0) lignes.push('  Rien à signaler.');
  else {
    lignes.push(`  ${r.constats.length} constat${r.constats.length > 1 ? 's' : ''} :`, '');
    for (const c of r.constats) lignes.push(texteConstat(c).replace(/^/gm, '  '), '');
    lignes.push(`  Pire verdict par pièce : ${[...r.parPiece].map(([p, v]) => `${p} ${NOMS_VERDICTS[v]}`).join(', ')}`);
  }
  for (const a of [...montage.avertissements, ...r.nonSimule]) lignes.push(`  Non simulé : ${a}`);
  return { texte: lignes.join('\n'), code: r.constats.length > 0 ? 1 : 0 };
}
