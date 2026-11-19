// Routage des fils : chaque fil devient une suite de segments horizontaux et verticaux
// sur une grille fine (pas de 5 px, la moitié de l'écart entre deux trous de breadboard).
// Règles :
// - deux fils ne partagent jamais un segment (pas de superposition) ;
// - un fil peut en croiser un autre à angle droit, mais ne tourne pas là où passe un autre fil ;
// - un fil ne passe ni sur une broche ou un trou (on croirait qu'il y est enfiché), ni à travers
//   le corps d'une pièce (ESP32, module, moteur...) ; la breadboard, elle, peut être survolée ;
// - un fil sort de sa broche par le côté de la pièce le plus proche.
// Algorithme : A* (plus court chemin avec estimation) fil par fil, les plus courts d'abord ;
// chaque virage et chaque croisement coûte un peu plus qu'un pas, pour des tracés sobres.
import type { Point } from './pieces/dessins';

export type Sortie = 'haut' | 'bas' | 'gauche' | 'droite';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Bout {
  point: Point;
  sortie: Sortie;
  /** Corps de la pièce, si c'est un obstacle : le fil en sort tout droit avant de tourner. */
  corps?: Rect;
}

export interface Trace {
  /** Coins du tracé, du premier bout au second. */
  points: Point[];
  /** Faux si le routeur a dû tolérer une superposition pour trouver un chemin. */
  propre: boolean;
}

export const PAS_GRILLE = 5;
const MARGE = 60;
const COUT_VIRAGE = 4;
const COUT_CROISEMENT = 3;

// Directions : 0 haut, 1 bas, 2 gauche, 3 droite.
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const OPPOSE = [1, 0, 3, 2];
const NUMERO: Record<Sortie, number> = { haut: 0, bas: 1, gauche: 2, droite: 3 };
const horizontale = (d: number) => d >= 2;

// Usage d'un nœud de la grille par les fils déjà routés.
const TRAVERSE_H = 1;
const TRAVERSE_V = 2;
const COIN = 4; // virage ou extrémité d'un fil

class Tas {
  private readonly cles: number[] = [];
  private readonly valeurs: number[] = [];

  get taille(): number {
    return this.cles.length;
  }

  pousser(cle: number, valeur: number): void {
    let i = this.cles.length;
    this.cles.push(cle);
    this.valeurs.push(valeur);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.cles[p] ?? 0) <= cle) break;
      this.echanger(i, p);
      i = p;
    }
  }

  extraire(): number {
    const sommet = this.valeurs[0] ?? -1;
    const dernierCle = this.cles.pop() ?? 0;
    const dernierValeur = this.valeurs.pop() ?? 0;
    if (this.cles.length > 0) {
      this.cles[0] = dernierCle;
      this.valeurs[0] = dernierValeur;
      let i = 0;
      for (;;) {
        const g = 2 * i + 1;
        const d = g + 1;
        let min = i;
        if (g < this.cles.length && (this.cles[g] ?? 0) < (this.cles[min] ?? 0)) min = g;
        if (d < this.cles.length && (this.cles[d] ?? 0) < (this.cles[min] ?? 0)) min = d;
        if (min === i) break;
        this.echanger(i, min);
        i = min;
      }
    }
    return sommet;
  }

  private echanger(i: number, j: number): void {
    [this.cles[i], this.cles[j]] = [this.cles[j] ?? 0, this.cles[i] ?? 0];
    [this.valeurs[i], this.valeurs[j]] = [this.valeurs[j] ?? 0, this.valeurs[i] ?? 0];
  }
}

/**
 * Route les fils demandés. `obstacles` : corps des pièces à contourner ; `broches` : toutes les
 * broches et tous les trous, sur lesquels aucun fil ne doit passer (sauf ses propres bouts).
 * Renvoie un tracé par demande, dans l'ordre des demandes.
 */
export function router(demandes: { a: Bout; b: Bout }[], obstacles: Rect[], broches: Point[]): Trace[] {
  const tous = [
    ...obstacles.flatMap((r) => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y1 }]),
    ...broches,
    ...demandes.flatMap((d) => [d.a.point, d.b.point]),
  ];
  const G = PAS_GRILLE;
  const minX = Math.floor((Math.min(...tous.map((p) => p.x)) - MARGE) / G) * G;
  const minY = Math.floor((Math.min(...tous.map((p) => p.y)) - MARGE) / G) * G;
  const maxX = Math.ceil((Math.max(...tous.map((p) => p.x)) + MARGE) / G) * G;
  const maxY = Math.ceil((Math.max(...tous.map((p) => p.y)) + MARGE) / G) * G;
  const L = (maxX - minX) / G + 1;
  const H = (maxY - minY) / G + 1;
  const N = L * H;

  const noeud = (p: Point) => Math.round((p.y - minY) / G) * L + Math.round((p.x - minX) / G);
  const versPoint = (n: number): Point => ({ x: minX + (n % L) * G, y: minY + Math.floor(n / L) * G });
  const voisin = (n: number, d: number): number => {
    const x = (n % L) + (DX[d] ?? 0);
    const y = Math.floor(n / L) + (DY[d] ?? 0);
    return x < 0 || y < 0 || x >= L || y >= H ? -1 : y * L + x;
  };

  const bloque = new Uint8Array(N);
  for (const r of obstacles) {
    for (let y = Math.ceil((r.y0 - minY) / G); y <= Math.floor((r.y1 - minY) / G); y++) {
      for (let x = Math.ceil((r.x0 - minX) / G); x <= Math.floor((r.x1 - minX) / G); x++) bloque[y * L + x] = 1;
    }
  }
  for (const p of broches) bloque[noeud(p)] = 1;

  const usage = new Uint8Array(N);
  const areteH = new Uint8Array(N); // arête entre n et n + 1
  const areteV = new Uint8Array(N); // arête entre n et n + L
  const areteUtilisee = (n: number, m: number) => (m === n + 1 || m === n - 1 ? areteH[Math.min(n, m)] : areteV[Math.min(n, m)]) === 1;

  /** Sortie forcée d'un bout : tout droit hors du corps de la pièce. */
  const amorce = (b: Bout): number[] => {
    const liste = [noeud(b.point)];
    if (!b.corps) return liste;
    const d = NUMERO[b.sortie];
    for (let n = liste[0] ?? 0; ; ) {
      const p = versPoint(n);
      if (p.x < b.corps.x0 || p.x > b.corps.x1 || p.y < b.corps.y0 || p.y > b.corps.y1) break;
      n = voisin(n, d);
      if (n < 0) break;
      liste.push(n);
    }
    return liste;
  };

  const chercher = (depart: number, but: number, dirDepart: number, dirArrivee: number, propres: Set<number>, strict: boolean): number[] | undefined => {
    const dist = new Float64Array(N * 4).fill(Infinity);
    const prec = new Int32Array(N * 4).fill(-1);
    const tas = new Tas();
    const xb = but % L;
    const yb = Math.floor(but / L);
    const estimation = (n: number) => Math.abs((n % L) - xb) + Math.abs(Math.floor(n / L) - yb);
    for (let d = 0; d < 4; d++) {
      const c = d === dirDepart ? 0 : COUT_VIRAGE;
      dist[depart * 4 + d] = c;
      tas.pousser(c + estimation(depart), depart * 4 + d);
    }
    while (tas.taille > 0) {
      const etat = tas.extraire();
      const n = Math.floor(etat / 4);
      const d = etat % 4;
      const g = dist[etat] ?? Infinity;
      if (n === but) {
        const chemin: number[] = [];
        for (let e = etat; e >= 0; e = prec[e] ?? -1) chemin.push(Math.floor(e / 4));
        return chemin.reverse();
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === OPPOSE[d]) continue;
        const m = voisin(n, nd);
        if (m < 0) continue;
        const virage = nd !== d;
        if (strict) {
          if (virage && n !== depart && usage[n] !== 0) continue;
          if (areteUtilisee(n, m)) continue;
        }
        if (m !== but && !propres.has(m)) {
          if (bloque[m]) continue;
          if (strict) {
            const u = usage[m] ?? 0;
            if (u & COIN) continue;
            if (horizontale(nd) ? u & TRAVERSE_H : u & TRAVERSE_V) continue;
          }
        }
        let cout = g + 1 + (virage ? COUT_VIRAGE : 0) + ((usage[m] ?? 0) !== 0 ? COUT_CROISEMENT : 0);
        if (m === but && nd !== dirArrivee) cout += COUT_VIRAGE;
        const e = m * 4 + nd;
        if (cout < (dist[e] ?? Infinity)) {
          dist[e] = cout;
          prec[e] = etat;
          tas.pousser(cout + estimation(m), e);
        }
      }
    }
    return undefined;
  };

  const marquer = (chemin: number[]): void => {
    for (let i = 0; i < chemin.length; i++) {
      const n = chemin[i] ?? 0;
      const avant = chemin[i - 1];
      const apres = chemin[i + 1];
      if (apres !== undefined) {
        if (apres === n + 1 || apres === n - 1) areteH[Math.min(n, apres)] = 1;
        else areteV[Math.min(n, apres)] = 1;
      }
      if (avant === undefined || apres === undefined) {
        usage[n] = (usage[n] ?? 0) | COIN;
        continue;
      }
      const hAvant = Math.abs(n - avant) === 1;
      const hApres = Math.abs(apres - n) === 1;
      usage[n] = (usage[n] ?? 0) | (hAvant !== hApres ? COIN : hAvant ? TRAVERSE_H : TRAVERSE_V);
    }
  };

  const coins = (chemin: number[]): Point[] => {
    const pts = chemin.map(versPoint);
    return pts.filter((p, i) => {
      const a = pts[i - 1];
      const b = pts[i + 1];
      return !a || !b || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
    });
  };

  const ordre = demandes
    .map((d, i) => ({ i, longueur: Math.abs(d.a.point.x - d.b.point.x) + Math.abs(d.a.point.y - d.b.point.y) }))
    .sort((a, b) => a.longueur - b.longueur);
  const traces: Trace[] = new Array<Trace>(demandes.length);
  for (const { i } of ordre) {
    const dem = demandes[i];
    if (!dem) continue;
    const amA = amorce(dem.a);
    const amB = amorce(dem.b);
    const depart = amA[amA.length - 1] ?? noeud(dem.a.point);
    const but = amB[amB.length - 1] ?? noeud(dem.b.point);
    const propres = new Set([...amA, ...amB]);
    const dirDepart = NUMERO[dem.a.sortie];
    const dirArrivee = OPPOSE[NUMERO[dem.b.sortie]] ?? 0;
    let propre = true;
    let milieu = chercher(depart, but, dirDepart, dirArrivee, propres, true);
    if (!milieu) {
      propre = false;
      milieu = chercher(depart, but, dirDepart, dirArrivee, propres, false);
    }
    if (!milieu) {
      // Aucun chemin, même en tolérant les superpositions : ligne droite, signalée comme non propre.
      traces[i] = { points: [dem.a.point, dem.b.point], propre: false };
      continue;
    }
    const chemin = [...amA.slice(0, -1), ...milieu, ...amB.slice(0, -1).reverse()];
    marquer(chemin);
    traces[i] = { points: [dem.a.point, ...coins(chemin).slice(1, -1), dem.b.point], propre };
  }
  return traces;
}
