// Plan de travail 2D, en lecture seule (étape 4) : chaque pièce dessinée à sa place,
// les fils, et les broches par-dessus. Une pièce enfichée dans une breadboard (connexion
// sans couleur vers un trou, comme les écrit Wokwi) est recalée pour que ses broches
// tombent pile sur leurs trous. Le résultat est une chaîne SVG, testable sans navigateur.
import type { Effet } from '../moteur/effets';
import type { Connexion, Extremite, Montage, Piece } from '../moteur/montage';
import type { Reseau } from '../moteur/reseau';
import { dessinPour, echapper, P, type Dessin, type Point } from './pieces/dessins';
import { router, type Bout, type Rect, type Sortie, type Trace } from './routage';

export interface Placement {
  piece: Piece;
  dessin: Dessin;
  x: number;
  y: number;
}

const estBreadboard = (p: Piece) => p.fiche.modele?.type === 'breadboard';

export function placerPieces(montage: Montage): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  const ordre = [...montage.pieces.filter(estBreadboard), ...montage.pieces.filter((p) => !estBreadboard(p))];
  for (const piece of ordre) {
    const dessin = dessinPour(piece.fiche);
    const placement: Placement = { piece, dessin, x: piece.position.left, y: piece.position.top };
    // Enfichage : première connexion sans couleur entre une broche de la pièce et un trou de breadboard.
    for (const c of montage.connexions) {
      if (c.couleur !== '' || estBreadboard(piece)) continue;
      const [moi, trou] = c.de.piece === piece.id ? [c.de, c.vers] : c.vers.piece === piece.id ? [c.vers, c.de] : [];
      const bb = trou && placements.get(trou.piece);
      if (!moi || !trou || !bb || !estBreadboard(bb.piece)) continue;
      const pTrou = bb.dessin.broches.get(trou.broche);
      const pBroche = dessin.broches.get(moi.broche);
      if (!pTrou || !pBroche) continue;
      placement.x = bb.x + pTrou.x - pBroche.x;
      placement.y = bb.y + pTrou.y - pBroche.y;
      break;
    }
    placements.set(piece.id, placement);
  }
  return placements;
}

/** Position absolue d'une broche sur le plan. */
export function positionBroche(placements: Map<string, Placement>, piece: string, broche: string): Point | undefined {
  const pl = placements.get(piece);
  const p = pl?.dessin.broches.get(broche);
  return pl && p ? { x: pl.x + p.x, y: pl.y + p.y } : undefined;
}

/** Les fils visibles : les connexions qui ont une couleur (les autres sont des enfichages). */
export function filsVisibles(montage: Montage): Connexion[] {
  return montage.connexions.filter((c) => c.couleur !== '');
}

/** Rectangle occupé par une pièce sur le plan. */
export function corpsDe(pl: Placement): Rect {
  return { x0: pl.x, y0: pl.y, x1: pl.x + pl.dessin.largeur, y1: pl.y + pl.dessin.hauteur };
}

/** Côté de la pièce le plus proche de la broche : c'est par là que le fil sort. */
function sortieDe(dessin: Dessin, p: Point): Sortie {
  const distances: [Sortie, number][] = [
    ['gauche', p.x],
    ['droite', dessin.largeur - p.x],
    ['haut', p.y],
    ['bas', dessin.hauteur - p.y],
  ];
  return distances.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

/** Tracé de chaque fil visible (même ordre que filsVisibles), routé sans superposition. */
export function tracerFils(montage: Montage, placements: Map<string, Placement>): Trace[] {
  const bout = (e: Extremite): Bout => {
    const pl = placements.get(e.piece);
    const p = pl?.dessin.broches.get(e.broche);
    if (!pl || !p) throw new Error(`broche sans position sur le plan : ${e.piece}:${e.broche}`);
    const b: Bout = { point: { x: pl.x + p.x, y: pl.y + p.y }, sortie: sortieDe(pl.dessin, p) };
    return estBreadboard(pl.piece) ? b : { ...b, corps: corpsDe(pl) };
  };
  const demandes = filsVisibles(montage).map((c) => ({ a: bout(c.de), b: bout(c.vers) }));
  const liste = [...placements.values()];
  const obstacles = liste.filter((pl) => !estBreadboard(pl.piece)).map(corpsDe);
  const broches = liste.flatMap((pl) => [...pl.dessin.broches.values()].map((p) => ({ x: pl.x + p.x, y: pl.y + p.y })));
  return router(demandes, obstacles, broches);
}

/** Zone du plan affichée (viewBox du SVG). */
export interface Cadre {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Plus petit cadre qui contient toutes les pièces, avec une marge. */
export function cadreDe(placements: Map<string, Placement>, marge = 2 * P): Cadre {
  const liste = [...placements.values()];
  if (liste.length === 0) return { x: 0, y: 0, largeur: 80 * P, hauteur: 40 * P };
  const minX = Math.min(...liste.map((p) => p.x)) - marge;
  const minY = Math.min(...liste.map((p) => p.y)) - marge;
  const maxX = Math.max(...liste.map((p) => p.x + p.dessin.largeur)) + marge;
  const maxY = Math.max(...liste.map((p) => p.y + p.dessin.hauteur)) + marge;
  return { x: minX, y: minY, largeur: maxX - minX, hauteur: maxY - minY };
}

/**
 * Zoom du cadre affiché d'un facteur (plus grand que 1 : on se rapproche), en gardant immobile
 * le point « centre » du plan (celui sous la souris). La largeur reste entre largeurMin et
 * largeurMax ; les proportions ne changent pas.
 */
export function zoomerCadre(cadre: Cadre, facteur: number, centre: Point, largeurMin: number, largeurMax: number): Cadre {
  const largeur = Math.min(Math.max(cadre.largeur / facteur, largeurMin), largeurMax);
  const f = cadre.largeur / largeur;
  return {
    x: centre.x - (centre.x - cadre.x) / f,
    y: centre.y - (centre.y - cadre.y) / f,
    largeur,
    hauteur: cadre.hauteur / f,
  };
}

export interface OptionsPlan {
  /** Zone affichée ; par défaut, juste autour des pièces. */
  cadre?: Cadre;
  /** Pièce ou fil (rang dans le diagram.json) à mettre en évidence. */
  choix?: { piece?: string; fil?: number };
  /** Sous tension : verdict de chaque pièce, fil (rang dans le diagram.json) et point (trou ou broche). */
  verdicts?: { pieces: Map<string, string>; fils: Map<number, string>; points: Map<string, string> };
  /** Sondes du multimètre, posées sur des points "piece:broche". */
  sondes?: { rouge?: string; noir?: string };
  /** Sous tension : effet visible de chaque pièce (roue qui tourne, LED allumée). */
  effets?: Map<string, Effet>;
}

export function dessinerPlan(montage: Montage, reseau: Reseau, options: OptionsPlan = {}): string {
  const placements = placerPieces(montage);
  const liste = [...placements.values()];
  const cadre = options.cadre ?? cadreDe(placements);

  const corps = (pl: Placement) => {
    const verdict = options.verdicts?.pieces.get(pl.piece.id);
    // Une pièce grillée fume : trois volutes qui montent au-dessus d'elle.
    const fumee =
      verdict === 'grille'
        ? `<g class="fumee" transform="translate(${pl.dessin.largeur / 2} 0)">${[0, 1, 2].map((k) => `<circle cx="${(k - 1) * 0.8 * P}" cy="0" r="${0.7 * P}" style="animation-delay:${k * 0.6}s"/>`).join('')}</g>`
        : '';
    return (
      `<g class="piece${options.choix?.piece === pl.piece.id ? ' choisie' : ''}${verdict ? ` verdict-${verdict}` : ''}" data-piece="${echapper(pl.piece.id)}" transform="translate(${pl.x} ${pl.y})">` +
      `<title>${echapper(`${pl.piece.id} : ${pl.piece.fiche.nom}`)}</title>${pl.dessin.corps(pl.piece, options.effets?.get(pl.piece.id))}${fumee}</g>`
    );
  };

  const broches = (pl: Placement) =>
    [...pl.dessin.broches]
      .map(([nom, p]) => {
        const point = `${pl.piece.id}:${nom}`;
        const noeud = reseau.noeudDe(point)?.id ?? '';
        const cote = estBreadboard(pl.piece) ? 0.36 * P : 0.5 * P;
        const verdict = options.verdicts?.points.get(point);
        return (
          `<rect class="broche${estBreadboard(pl.piece) ? ' trou' : ''}${verdict ? ` verdict-${verdict}` : ''}" data-point="${echapper(point)}" data-noeud="${noeud}" ` +
          `x="${pl.x + p.x - cote / 2}" y="${pl.y + p.y - cote / 2}" width="${cote}" height="${cote}"><title>${echapper(point)}</title></rect>`
        );
      })
      .join('');

  // Chaque fil : un liseré couleur du fond, puis le fil. Le liseré d'un fil tracé après
  // coupe ceux d'avant aux croisements, ce qui montre lequel passe dessus.
  const traces = tracerFils(montage, placements);
  const fils = filsVisibles(montage)
    .map((c, i) => {
      const trace = traces[i];
      if (!trace) return '';
      const d = trace.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
      const titre = `${c.de.piece}:${c.de.broche} → ${c.vers.piece}:${c.vers.broche}`;
      return (
        `<g class="fil-groupe${options.choix?.fil === c.indice ? ' choisi' : ''}${options.verdicts?.fils.has(c.indice) ? ` verdict-${options.verdicts.fils.get(c.indice)}` : ''}" data-connexion="${c.indice}"><title>${echapper(titre)}</title>` +
        `<path class="fil-halo" d="${d}"/><path class="fil" d="${d}" stroke="${echapper(c.couleur)}"/></g>`
      );
    })
    .join('');

  // Sondes du multimètre : un rond rouge et un rond noir sur les points mesurés.
  const sondes = (['rouge', 'noir'] as const)
    .map((couleur) => {
      const point = options.sondes?.[couleur];
      if (!point) return '';
      const i = point.indexOf(':');
      const p = positionBroche(placements, point.slice(0, i), point.slice(i + 1));
      return p ? `<circle class="sonde sonde-${couleur}" cx="${p.x}" cy="${p.y}" r="${0.6 * P}"><title>sonde ${couleur} : ${echapper(point)}</title></circle>` : '';
    })
    .join('');

  const breadboards = liste.filter((pl) => estBreadboard(pl.piece));
  const autres = liste.filter((pl) => !estBreadboard(pl.piece));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="plan" viewBox="${cadre.x} ${cadre.y} ${cadre.largeur} ${cadre.hauteur}">` +
    breadboards.map((pl) => corps(pl) + broches(pl)).join('') +
    autres.map(corps).join('') +
    `<g class="fils">${fils}</g>` +
    autres.map(broches).join('') +
    sondes +
    `</svg>`
  );
}
