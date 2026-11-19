// Calcul du régime continu par la méthode des nœuds.
//
// En chaque nœud, la somme des courants qui en sortent est nulle (loi des nœuds). Avec les
// résistances, cela donne un système linéaire G·V = I. Les sources de tension ajoutent une
// inconnue chacune, leur courant (méthode des nœuds « modifiée », celle de SPICE). Les diodes
// et les charges à puissance constante ne sont pas linéaires : on les remplace par leur
// tangente au point courant et on recommence (méthode de Newton) jusqu'à ce que plus rien ne
// bouge.
//
// Les sources ont trois régimes : tension constante, courant constant (limite atteinte) et
// coupée (une source qui n'absorbe pas de courant face à une tension plus haute). On choisit
// le régime d'après le dernier résultat, et Newton continue tant qu'un régime change.
//
// Ce fichier ne connaît ni les fiches ni le montage : seulement des nœuds numérotés et des
// éléments. La traduction du montage en éléments est dans circuit.ts.

/** Tension thermique kT/q à 25 °C (V). */
export const VT_25C = (1.380649e-23 * 298.15) / 1.602176634e-19;

/** Petite conductance (S) qui relie chaque nœud à sa référence, comme dans SPICE (1 TΩ). */
export const GMIN = 1e-12;

export type Element =
  /** Résistance r (Ω) entre a et b. Courant compté de a vers b. */
  | { type: 'resistance'; a: number; b: number; r: number }
  /**
   * Source de tension v (V) entre plus et moins. Courant compté sortant de plus (fourni).
   * limite : courant au-delà duquel elle passe en courant constant.
   * absorbe : false si elle ne peut pas recevoir de courant (alim de labo, régulateur).
   */
  | { type: 'source'; plus: number; moins: number; v: number; limite?: number; absorbe: boolean }
  /** Diode de loi i = is·(exp(u / nvt) − 1). Courant compté de l'anode vers la cathode. */
  | { type: 'diode'; anode: number; cathode: number; is: number; nvt: number }
  /**
   * Charge qui prend la puissance p (W) plus le courant i0 (A) au-dessus de vmin (V) ;
   * en dessous, une résistance qui la prolonge sans saut ; rien en inverse. Courant compté de
   * plus vers moins. Sert à l'entrée d'un étage à découpage (driver).
   */
  | { type: 'charge'; plus: number; moins: number; p: number; i0: number; vmin: number };

export type RegimeSource = 'tension' | 'courant' | 'coupee';

export interface Solution {
  converge: boolean;
  /** Raison de l'échec, en français, si converge est faux. */
  message?: string;
  iterations: number;
  /** Tension de chaque nœud par rapport à la référence de sa partie ; undefined si aucun élément ne le touche. */
  tensions: (number | undefined)[];
  /** Partie connexe de chaque nœud (-1 si aucun élément ne le touche). */
  parties: number[];
  /** Nœud de référence (0 V) de chaque partie. */
  references: number[];
  /** Courant de chaque élément, dans le sens de sa définition. */
  courants: number[];
  /** Tension aux bornes de chaque élément (a − b, plus − moins, anode − cathode). */
  tensionsElements: number[];
  /** Régime de chaque source (undefined pour les autres éléments). */
  regimes: (RegimeSource | undefined)[];
}

export interface Options {
  /** Nœuds à prendre comme référence, par ordre de préférence (masse d'une alim d'abord). */
  references?: number[];
  /** Point de départ : tensions et régimes d'un calcul voisin (accélère les recalculs). */
  depart?: { tensions: (number | undefined)[]; regimes?: (RegimeSource | undefined)[] };
  iterationsMax?: number;
}

function bornes(e: Element): number[] {
  switch (e.type) {
    case 'resistance':
      return [e.a, e.b];
    case 'source':
    case 'charge':
      return [e.plus, e.moins];
    case 'diode':
      return [e.anode, e.cathode];
  }
}

/** Limitation du pas de tension d'une jonction (pnjlim de SPICE) : évite que exp() explose. */
function limiterJonction(vnew: number, vold: number, nvt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nvt;
      return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(vnew / nvt);
  }
  return vnew;
}

/** Courant et conductance d'une diode à la tension u ; au-delà de 80 nvt, prolongée par sa tangente. */
function diode(u: number, is: number, nvt: number): { i: number; g: number } {
  const x = u / nvt;
  if (x > 80) {
    const e = Math.exp(80);
    return { i: is * (e * (1 + x - 80) - 1), g: (is * e) / nvt };
  }
  const e = Math.exp(x);
  return { i: is * (e - 1), g: (is * e) / nvt };
}

function charge(u: number, p: number, i0: number, vmin: number): { i: number; g: number } {
  if (u <= 0) return { i: 0, g: 0 };
  if (u < vmin) {
    const g = (p / vmin + i0) / vmin;
    return { i: g * u, g };
  }
  return { i: p / u + i0, g: -p / (u * u) };
}

/** Résout A·x = b par la méthode de Gauss avec pivot partiel. Renvoie undefined si A est singulière. */
function resoudreLineaire(a: Float64Array, b: Float64Array, n: number): Float64Array | undefined {
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.abs(a[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]!);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (!(max > 1e-30)) return undefined;
    if (p !== k) {
      for (let j = k; j < n; j++) {
        const t = a[k * n + j]!;
        a[k * n + j] = a[p * n + j]!;
        a[p * n + j] = t;
      }
      const t = b[k]!;
      b[k] = b[p]!;
      b[p] = t;
    }
    const pivot = a[k * n + k]!;
    for (let i = k + 1; i < n; i++) {
      const f = a[i * n + k]! / pivot;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) a[i * n + j]! -= f * a[k * n + j]!;
      b[i]! -= f * b[k]!;
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= a[i * n + j]! * x[j]!;
    x[i] = s / a[i * n + i]!;
  }
  return x;
}

export function resoudre(nbNoeuds: number, elements: Element[], options: Options = {}): Solution {
  // 1. Parties connexes : les nœuds qu'aucun élément ne relie n'ont pas de tension définie
  //    entre eux. Chaque partie a sa référence à 0 V.
  const parent = Array.from({ length: nbNoeuds }, (_, i) => i);
  const racine = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const touche = new Array<boolean>(nbNoeuds).fill(false);
  for (const e of elements) {
    const [a, b] = bornes(e) as [number, number];
    touche[a] = true;
    touche[b] = true;
    const ra = racine(a);
    const rb = racine(b);
    if (ra !== rb) parent[rb] = ra;
  }
  const partieDeRacine = new Map<number, number>();
  const parties = new Array<number>(nbNoeuds).fill(-1);
  for (let i = 0; i < nbNoeuds; i++) {
    if (!touche[i]) continue;
    const r = racine(i);
    if (!partieDeRacine.has(r)) partieDeRacine.set(r, partieDeRacine.size);
    parties[i] = partieDeRacine.get(r)!;
  }
  const references = new Array<number>(partieDeRacine.size).fill(-1);
  for (const n of options.references ?? []) {
    const p = parties[n];
    if (p !== undefined && p >= 0 && references[p] === -1) references[p] = n;
  }
  for (let i = 0; i < nbNoeuds; i++) {
    const p = parties[i]!;
    if (p >= 0 && references[p] === -1) references[p] = i;
  }

  // 2. Inconnues : tension de chaque nœud touché (sauf les références), puis courant de chaque source.
  const inconnue = new Array<number>(nbNoeuds).fill(-1);
  let m = 0;
  for (let i = 0; i < nbNoeuds; i++) if (touche[i] && !references.includes(i)) inconnue[i] = m++;
  const branche = new Array<number>(elements.length).fill(-1);
  elements.forEach((e, k) => {
    if (e.type === 'source') branche[k] = m++;
  });

  // 3. État de départ.
  const x = new Float64Array(m);
  const tensionDe = (v: Float64Array, n: number): number => (inconnue[n]! >= 0 ? v[inconnue[n]!]! : 0);
  const depart = options.depart;
  if (depart) for (let i = 0; i < nbNoeuds; i++) if (inconnue[i]! >= 0) x[inconnue[i]!] = depart.tensions[i] ?? 0;
  const regimes: (RegimeSource | undefined)[] = elements.map((e, k) => {
    if (e.type !== 'source') return undefined;
    // Source dont les deux bornes sont sur le même nœud : court-circuit franc.
    if (e.plus === e.moins) return e.limite !== undefined ? 'courant' : 'tension';
    return depart?.regimes?.[k] ?? 'tension';
  });
  const echec = (message: string, iterations: number): Solution => ({
    converge: false,
    message,
    iterations,
    tensions: new Array(nbNoeuds).fill(undefined),
    parties,
    references,
    courants: new Array(elements.length).fill(0),
    tensionsElements: new Array(elements.length).fill(0),
    regimes,
  });
  for (const e of elements) {
    if (e.type === 'source' && e.plus === e.moins && e.limite === undefined) {
      return echec(`source de ${e.v} V en court-circuit franc, sans limite de courant`, 0);
    }
  }
  const tensionsJonction = elements.map((e) => (e.type === 'diode' ? tensionDe(x, e.anode) - tensionDe(x, e.cathode) : 0));
  const changements = new Array<number>(elements.length).fill(0);

  // 4. Newton.
  const iterationsMax = options.iterationsMax ?? 300;
  for (let it = 1; it <= iterationsMax; it++) {
    const a = new Float64Array(m * m);
    const b = new Float64Array(m);
    const ajouter = (i: number, j: number, v: number): void => {
      if (i >= 0 && j >= 0) a[i * m + j]! += v;
    };
    const conductance = (n1: number, n2: number, g: number): void => {
      const i = inconnue[n1]!;
      const j = inconnue[n2]!;
      ajouter(i, i, g);
      ajouter(j, j, g);
      ajouter(i, j, -g);
      ajouter(j, i, -g);
    };
    /** Courant c qui sort du nœud n1 et entre dans n2 par l'élément. */
    const courant = (n1: number, n2: number, c: number): void => {
      const i = inconnue[n1]!;
      const j = inconnue[n2]!;
      if (i >= 0) b[i]! -= c;
      if (j >= 0) b[j]! += c;
    };

    for (let i = 0; i < nbNoeuds; i++) if (inconnue[i]! >= 0) ajouter(inconnue[i]!, inconnue[i]!, GMIN);

    elements.forEach((e, k) => {
      switch (e.type) {
        case 'resistance':
          conductance(e.a, e.b, 1 / e.r);
          break;
        case 'source': {
          const kb = branche[k]!;
          const p = inconnue[e.plus]!;
          const q = inconnue[e.moins]!;
          // Le courant fourni sort de plus vers le montage et revient par moins.
          ajouter(p, kb, -1);
          ajouter(q, kb, 1);
          const regime = regimes[k];
          if (regime === 'tension') {
            ajouter(kb, p, 1);
            ajouter(kb, q, -1);
            b[kb] = e.v;
          } else {
            a[kb * m + kb] = 1;
            b[kb] = regime === 'courant' ? (e.limite ?? 0) : 0;
          }
          break;
        }
        case 'diode': {
          const u = tensionsJonction[k]!;
          const { i, g } = diode(u, e.is, e.nvt);
          conductance(e.anode, e.cathode, g + GMIN);
          courant(e.anode, e.cathode, i + GMIN * u - (g + GMIN) * u);
          break;
        }
        case 'charge': {
          const u = tensionDe(x, e.plus) - tensionDe(x, e.moins);
          const { i, g } = charge(u, e.p, e.i0, e.vmin);
          conductance(e.plus, e.moins, g);
          courant(e.plus, e.moins, i - g * u);
          break;
        }
      }
    });

    const xn = resoudreLineaire(a, b, m);
    if (!xn) return echec('système impossible à résoudre (deux sources de tension idéales en parallèle ?)', it);

    // Jonctions : on limite le pas pour que exp() reste raisonnable.
    let limite = false;
    elements.forEach((e, k) => {
      if (e.type !== 'diode') return;
      const vnew = tensionDe(xn, e.anode) - tensionDe(xn, e.cathode);
      const vcrit = e.nvt * Math.log(e.nvt / (Math.SQRT2 * e.is));
      const v = limiterJonction(vnew, tensionsJonction[k]!, e.nvt, vcrit);
      if (Math.abs(v - vnew) > 1e-12) limite = true;
      tensionsJonction[k] = v;
    });

    // Régimes des sources, d'après ce résultat.
    let change = false;
    for (const [k, e] of elements.entries()) {
      if (e.type !== 'source' || e.plus === e.moins) continue;
      const fourni = xn[branche[k]!]!;
      const u = tensionDe(xn, e.plus) - tensionDe(xn, e.moins);
      const tolI = 1e-12 + 1e-9 * Math.abs(e.limite ?? 0);
      const tolV = 1e-9 + 1e-9 * Math.abs(e.v);
      const avant = regimes[k];
      let apres = avant;
      if (avant === 'tension') {
        if (e.limite !== undefined && fourni > e.limite + tolI) apres = 'courant';
        else if (!e.absorbe && fourni < -tolI) apres = 'coupee';
      } else if (avant === 'courant') {
        if (u > e.v + tolV) apres = 'tension';
      } else if (u < e.v - tolV) apres = 'tension';
      if (apres !== avant) {
        regimes[k] = apres;
        change = true;
        if (++changements[k]! > 30) return echec(`une source de ${e.v} V hésite sans fin entre deux régimes`, it);
      }
    }

    let ecart = 0;
    let echelle = 0;
    for (let i = 0; i < m; i++) {
      ecart = Math.max(ecart, Math.abs(xn[i]! - x[i]!));
      echelle = Math.max(echelle, Math.abs(xn[i]!));
    }
    x.set(xn);
    if (!change && !limite && ecart <= 1e-9 + 1e-9 * echelle) {
      return bilan(it);
    }
  }
  return echec(`pas de convergence en ${iterationsMax} itérations`, iterationsMax);

  function bilan(iterations: number): Solution {
    const tensions = Array.from({ length: nbNoeuds }, (_, i) => (touche[i] ? tensionDe(x, i) : undefined));
    const courants: number[] = [];
    const tensionsElements: number[] = [];
    elements.forEach((e, k) => {
      const [n1, n2] = bornes(e) as [number, number];
      const u = tensionDe(x, n1) - tensionDe(x, n2);
      tensionsElements.push(u);
      switch (e.type) {
        case 'resistance':
          courants.push(u / e.r);
          break;
        case 'source':
          courants.push(x[branche[k]!]!);
          break;
        case 'diode':
          courants.push(diode(u, e.is, e.nvt).i + GMIN * u);
          break;
        case 'charge':
          courants.push(charge(u, e.p, e.i0, e.vmin).i);
          break;
      }
    });
    return { converge: true, iterations, tensions, parties, references, courants, tensionsElements, regimes };
  }
}

/** Courant de saturation is d'une diode qui laisse passer le courant i sous la tension vf (coefficient n). */
export function courantSaturation(vf: number, i: number, n: number): number {
  return i / Math.expm1(vf / (n * VT_25C));
}
