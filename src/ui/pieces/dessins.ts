// Dessins 2D des pièces, en SVG maison. Chaque dessin donne sa taille, la position de
// chaque broche (par nom de broche de la fiche) et le corps de la pièce. Les broches
// elles-mêmes sont dessinées par le plan (plan.ts), par-dessus les corps et les fils.
//
// Unité : P = 10 px pour 0,1 pouce (2,54 mm), le pas des trous d'une breadboard.
import type { Fiche } from '../../moteur/fiche';
import type { Piece } from '../../moteur/montage';

export const P = 10;

export interface Point {
  x: number;
  y: number;
}

export interface Dessin {
  largeur: number;
  hauteur: number;
  /** Position de chaque broche dans le repère du dessin (coin haut gauche = 0, 0). */
  broches: Map<string, Point>;
  /** Corps de la pièce (sans les broches), en SVG, dans le repère du dessin. */
  corps(piece: Piece): string;
}

export function echapper(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function texte(x: number, y: number, contenu: string, attributs = ''): string {
  return `<text x="${x}" y="${y}" ${attributs}>${echapper(contenu)}</text>`;
}

/** Position d'une broche dans un connecteur : { connecteur: "J2", numero: 3 }. */
function position(fiche: Fiche, nom: string): { connecteur?: string; numero?: number } {
  const b = fiche.broches.find((x) => x.nom === nom);
  return (b?.['position'] as { connecteur?: string; numero?: number } | undefined) ?? {};
}

// ---------------------------------------------------------------- breadboard 830 points
const BB_MARGE = 2 * P;
const BB_Y: Record<string, number> = {
  tn: 1.5 * P, tp: 2.5 * P,
  a: 4.5 * P, b: 5.5 * P, c: 6.5 * P, d: 7.5 * P, e: 8.5 * P,
  // 3 pas entre e et f : la rainure centrale, comme sur une vraie breadboard.
  f: 11.5 * P, g: 12.5 * P, h: 13.5 * P, i: 14.5 * P, j: 15.5 * P,
  bp: 17.5 * P, bn: 18.5 * P,
};
const xColonne = (c: number) => BB_MARGE + (c - 1) * P;
/** Trou n (1 à 50) d'un rail : groupes de 5 trous séparés d'un pas vide. */
const xRail = (n: number) => xColonne(3 + Math.floor((n - 1) / 5) * 6 + ((n - 1) % 5));

function dessinBreadboard(fiche: Fiche): Dessin {
  const colonnes = Math.max(...fiche.broches.map((b) => Number(/^(\d+)[tb]\./.exec(b.nom)?.[1] ?? 0)));
  const largeur = xColonne(colonnes) + BB_MARGE;
  const hauteur = 20 * P;
  const broches = new Map<string, Point>();
  for (const b of fiche.broches) {
    const trou = /^(\d+)[tb]\.([a-j])$/.exec(b.nom);
    const rail = /^([tb][pn])\.(\d+)$/.exec(b.nom);
    if (trou?.[1] && trou[2]) broches.set(b.nom, { x: xColonne(Number(trou[1])), y: BB_Y[trou[2]] ?? 0 });
    else if (rail?.[1] && rail[2]) broches.set(b.nom, { x: xRail(Number(rail[2])), y: BB_Y[rail[1]] ?? 0 });
  }
  return {
    largeur,
    hauteur,
    broches,
    corps: () => {
      const lignes = [
        `<rect x="0" y="0" width="${largeur}" height="${hauteur}" rx="6" fill="#f3efe4" stroke="#c9c2ad"/>`,
        `<rect x="0" y="${9.5 * P}" width="${largeur}" height="${P}" fill="#e2dccb"/>`,
      ];
      for (const [rail, couleur, dy] of [['tn', '#3b6fd8', -0.6], ['tp', '#d83b3b', 0.6], ['bp', '#d83b3b', -0.6], ['bn', '#3b6fd8', 0.6]] as const) {
        const y = (BB_Y[rail] ?? 0) + dy * P;
        lignes.push(`<line x1="${BB_MARGE}" y1="${y}" x2="${largeur - BB_MARGE}" y2="${y}" stroke="${couleur}" stroke-width="1"/>`);
      }
      for (let c = 1; c <= colonnes; c += c === 1 ? 4 : 5) {
        lignes.push(texte(xColonne(c), 3.7 * P, String(c), 'class="etiquette-bb"'), texte(xColonne(c), 16.9 * P, String(c), 'class="etiquette-bb"'));
      }
      for (const r of 'abcdefghij') lignes.push(texte(0.8 * P, (BB_Y[r] ?? 0) + 3, r, 'class="etiquette-bb"'));
      return lignes.join('');
    },
  };
}

// ---------------------------------------------------------------- carte ESP32 DevKitC (38 broches)
function dessinEsp32(fiche: Fiche): Dessin {
  // J2 à gauche, J3 à droite, 19 broches chacune, rangées à 1 pouce (10 pas) l'une de l'autre.
  const largeur = 12 * P;
  const hauteur = 23 * P;
  const broches = new Map<string, Point>();
  for (const b of fiche.broches) {
    const { connecteur, numero } = position(fiche, b.nom);
    if (numero === undefined) continue;
    broches.set(b.nom, { x: connecteur === 'J3' ? 11 * P : P, y: (numero + 1) * P });
  }
  return {
    largeur,
    hauteur,
    broches,
    corps: () => {
      const etiquettes = [...broches].map(([nom, p]) =>
        texte(p.x === P ? p.x + 0.8 * P : p.x - 0.8 * P, p.y + 3, nom, `class="etiquette" text-anchor="${p.x === P ? 'start' : 'end'}"`),
      );
      return [
        `<rect x="0" y="0" width="${largeur}" height="${hauteur}" rx="4" fill="#1d1d1f" stroke="#444"/>`,
        `<rect x="${3 * P}" y="${0.3 * P}" width="${6 * P}" height="${1.4 * P}" rx="2" fill="#bfc3c7"/>`,
        texte(6 * P, 1.3 * P, 'ESP32-WROOM-32', 'class="etiquette-sombre" text-anchor="middle"'),
        `<rect x="${4.5 * P}" y="${21.3 * P}" width="${3 * P}" height="${1.7 * P}" rx="2" fill="#9aa0a6"/>`,
        texte(6 * P, 20.8 * P, 'USB', 'class="etiquette" text-anchor="middle"'),
        ...etiquettes,
      ].join('');
    },
  };
}

// ---------------------------------------------------------------- module TMC2209 (format StepStick)
function dessinModuleTmc(fiche: Fiche): Dessin {
  // À plat sur la breadboard : J3 (EN à DIR) en haut, J4 (VM à GND) 5 pas plus bas.
  const largeur = 9 * P;
  const hauteur = 7 * P;
  const broches = new Map<string, Point>();
  const isoles: Record<string, Point> = { J1: { x: 1.6 * P, y: 3.5 * P }, J2: { x: 7.4 * P, y: 2.8 * P }, J5: { x: 7.4 * P, y: 4.2 * P } };
  for (const b of fiche.broches) {
    const { connecteur, numero } = position(fiche, b.nom);
    if (connecteur === 'J3' && numero) broches.set(b.nom, { x: numero * P, y: P });
    else if (connecteur === 'J4' && numero) broches.set(b.nom, { x: numero * P, y: 6 * P });
    else if (connecteur && isoles[connecteur]) broches.set(b.nom, isoles[connecteur]);
  }
  // Noms imprimés à côté des broches, tirés de la fiche (schéma BTT) : « GND.1 » et « GND.2 »
  // sont imprimés « GND » ; PDN_UART devient « PDN », faute de place au pas de 0,1 pouce.
  const court = (nom: string) => {
    const base = nom.replace(/\.\d+$/, '');
    return base === 'PDN_UART' ? 'PDN' : base;
  };
  const etiquettes = fiche.broches.flatMap((b) => {
    const p = broches.get(b.nom);
    if (!p) return [];
    const classe = `etiquette-broche${b.role === 'non_connectee' ? ' nc' : ''}`;
    const { connecteur } = position(fiche, b.nom);
    if (connecteur === 'J3') return [texte(p.x, p.y + 0.75 * P, court(b.nom), `class="${classe}" text-anchor="middle"`)];
    if (connecteur === 'J4') return [texte(p.x, p.y - 0.45 * P, court(b.nom), `class="${classe}" text-anchor="middle"`)];
    if (connecteur === 'J1') return [texte(p.x, p.y - 0.95 * P, court(b.nom), `class="${classe}" text-anchor="middle"`)];
    return [texte(p.x + 0.55 * P, p.y + 0.12 * P, court(b.nom), `class="${classe}" text-anchor="start"`)];
  });
  return {
    largeur,
    hauteur,
    broches,
    corps: () => {
      const ailettes = [3, 3.8, 4.6, 5.4, 6.2].map((x) => `<rect x="${x * P}" y="${2.1 * P}" width="${0.5 * P}" height="${2.8 * P}" fill="#2f6fd1"/>`);
      return [
        `<rect x="0" y="0" width="${largeur}" height="${hauteur}" rx="3" fill="#2a2a6e" stroke="#15153a"/>`,
        `<rect x="${2.6 * P}" y="${1.9 * P}" width="${4.4 * P}" height="${3.2 * P}" rx="2" fill="#4a8bf0"/>`,
        ...ailettes,
        `<circle cx="${1.6 * P}" cy="${3.5 * P}" r="${0.7 * P}" fill="#d8d8d8" stroke="#888"/>`,
        texte(4.8 * P, 6.95 * P, 'TMC2209', 'class="etiquette" text-anchor="middle"'),
        ...etiquettes,
      ].join('');
    },
  };
}

// ---------------------------------------------------------------- moteur pas à pas NEMA 17
function dessinMoteur(fiche: Fiche): Dessin {
  const largeur = 10 * P;
  const hauteur = 11.5 * P;
  // Connecteur en haut, pour que les fils partent vers la breadboard. Ordre de Wokwi : A-, A+, B+, B-.
  const ordre = ['A-', 'A+', 'B+', 'B-'];
  const broches = new Map<string, Point>();
  for (const b of fiche.broches) {
    const i = ordre.indexOf(b.nom);
    broches.set(b.nom, { x: (3.5 + (i < 0 ? ordre.length : i)) * P, y: 0.5 * P });
  }
  // Nom de chaque broche sur le connecteur, et un bout de fil à la couleur notée dans la fiche
  // (« Fil rouge chez MotionKing et HANPOSE » : les couleurs changent d'un vendeur à l'autre).
  const fils = fiche.broches.flatMap((b) => {
    const p = broches.get(b.nom);
    if (!p) return [];
    const couleur = COULEURS_FILS[/Fil (\p{L}+)/u.exec(String(b['note'] ?? ''))?.[1]?.toLowerCase() ?? ''];
    return [
      ...(couleur ? [`<line class="fil-moteur" x1="${p.x}" y1="${1.5 * P}" x2="${p.x}" y2="${2.6 * P}" stroke="${couleur}" stroke-width="2"/>`] : []),
      texte(p.x, 1.3 * P, b.nom, 'class="etiquette-broche sombre" text-anchor="middle"'),
    ];
  });
  return {
    largeur,
    hauteur,
    broches,
    corps: (piece) => [
      `<rect x="${3 * P}" y="0" width="${4 * P}" height="${1.5 * P}" fill="#fff" stroke="#666"/>`,
      `<rect x="0" y="${1.5 * P}" width="${largeur}" height="${10 * P}" rx="8" fill="#3a3a3c" stroke="#222"/>`,
      `<circle cx="${5 * P}" cy="${6.5 * P}" r="${2.2 * P}" fill="#8e8e93" stroke="#5a5a5e"/>`,
      `<circle cx="${5 * P}" cy="${6.5 * P}" r="${0.5 * P}" fill="#d1d1d6"/>`,
      texte(5 * P, 10.6 * P, piece.id, 'class="etiquette" text-anchor="middle"'),
      ...fils,
    ].join(''),
  };
}

/** Couleurs des fils citées dans les notes des fiches. */
const COULEURS_FILS: Record<string, string> = {
  rouge: '#d62c1f',
  vert: '#2e9e3e',
  jaune: '#e8c21c',
  bleu: '#2b62d6',
  noir: '#111',
  blanc: '#eee',
};

// ---------------------------------------------------------------- résistance
function formaterOhms(valeur: unknown): string {
  const r = typeof valeur === 'number' ? valeur : NaN;
  if (!Number.isFinite(r)) return '?';
  if (r >= 1e6) return `${r / 1e6} MΩ`;
  if (r >= 1e3) return `${r / 1e3} kΩ`;
  return `${r} Ω`;
}

function dessinResistance(): Dessin {
  return {
    largeur: 7 * P,
    hauteur: 2 * P,
    broches: new Map([['1', { x: 0.5 * P, y: P }], ['2', { x: 6.5 * P, y: P }]]),
    corps: (piece) => [
      `<line x1="${0.5 * P}" y1="${P}" x2="${6.5 * P}" y2="${P}" stroke="#999" stroke-width="2"/>`,
      `<rect x="${1.7 * P}" y="${0.45 * P}" width="${3.6 * P}" height="${1.1 * P}" rx="4" fill="#d8c08c" stroke="#a48a52"/>`,
      texte(3.5 * P, 2.6 * P, formaterOhms(piece.parametres['value']), 'class="etiquette" text-anchor="middle"'),
    ].join(''),
  };
}

// ---------------------------------------------------------------- alim de labo
function dessinAlim(fiche: Fiche): Dessin {
  const largeur = 14 * P;
  const hauteur = 9 * P;
  const places: Record<string, Point> = { '+': { x: 4 * P, y: 7.5 * P }, '-': { x: 7 * P, y: 7.5 * P }, terre: { x: 10 * P, y: 7.5 * P } };
  const broches = new Map<string, Point>();
  fiche.broches.forEach((b, i) => broches.set(b.nom, places[b.nom] ?? { x: (2 + 2 * i) * P, y: 7.5 * P }));
  return {
    largeur,
    hauteur,
    broches,
    corps: (piece) => {
      const v = piece.parametres['tension'];
      const a = piece.parametres['limite_courant'];
      return [
        `<rect x="0" y="0" width="${largeur}" height="${hauteur}" rx="6" fill="#d9d9d6" stroke="#8a8a85"/>`,
        `<rect x="${P}" y="${P}" width="${12 * P}" height="${3 * P}" rx="3" fill="#10201a"/>`,
        texte(4 * P, 3.1 * P, typeof v === 'number' ? `${v.toFixed(1)} V` : '— V', 'class="afficheur" text-anchor="middle"'),
        texte(10 * P, 3.1 * P, typeof a === 'number' ? `${a.toFixed(2)} A` : '— A', 'class="afficheur" text-anchor="middle"'),
        `<circle cx="${4 * P}" cy="${7.5 * P}" r="${0.8 * P}" fill="#d83b3b"/>`,
        `<circle cx="${7 * P}" cy="${7.5 * P}" r="${0.8 * P}" fill="#222"/>`,
        `<circle cx="${10 * P}" cy="${7.5 * P}" r="${0.8 * P}" fill="#3a9a4a"/>`,
        texte(7 * P, 5.6 * P, 'Alim de labo', 'class="etiquette-sombre" text-anchor="middle"'),
      ].join('');
    },
  };
}

// ---------------------------------------------------------------- batterie LiPo
function dessinBatterie(): Dessin {
  return {
    largeur: 13 * P,
    hauteur: 5 * P,
    broches: new Map([['+', { x: 12.5 * P, y: 1.5 * P }], ['-', { x: 12.5 * P, y: 3.5 * P }]]),
    corps: () => [
      `<rect x="0" y="0" width="${11 * P}" height="${5 * P}" rx="4" fill="#e8c341" stroke="#a88a1f"/>`,
      `<line x1="${11 * P}" y1="${1.5 * P}" x2="${12.5 * P}" y2="${1.5 * P}" stroke="#d83b3b" stroke-width="2"/>`,
      `<line x1="${11 * P}" y1="${3.5 * P}" x2="${12.5 * P}" y2="${3.5 * P}" stroke="#222" stroke-width="2"/>`,
      texte(5.5 * P, 3 * P, 'LiPo 4S', 'class="etiquette-sombre" text-anchor="middle"'),
    ].join(''),
  };
}

// ---------------------------------------------------------------- condensateur électrolytique
function dessinCondensateur(): Dessin {
  return {
    largeur: 3 * P,
    hauteur: 5.5 * P,
    broches: new Map([['+', { x: P, y: 5 * P }], ['-', { x: 2 * P, y: 5 * P }]]),
    corps: () => [
      `<rect x="${0.2 * P}" y="0" width="${2.6 * P}" height="${4.2 * P}" rx="4" fill="#2c3e7a" stroke="#1a2550"/>`,
      `<rect x="${2 * P}" y="0" width="${0.6 * P}" height="${4.2 * P}" fill="#c8cde0"/>`,
      `<line x1="${P}" y1="${4.2 * P}" x2="${P}" y2="${5 * P}" stroke="#999"/>`,
      `<line x1="${2 * P}" y1="${4.2 * P}" x2="${2 * P}" y2="${5 * P}" stroke="#999"/>`,
    ].join(''),
  };
}

// ---------------------------------------------------------------- dessin générique
function dessinGenerique(fiche: Fiche): Dessin {
  // Boîte et broches en rangées de 20 au plus, au pas de 0,1 pouce, dans l'ordre de la fiche :
  // une pièce d'une seule rangée s'enfiche dans la breadboard. Le nom de chaque broche est écrit
  // à la verticale au-dessus d'elle (place pour 7 caractères environ).
  const n = Math.max(fiche.broches.length, 1);
  const parLigne = Math.min(n, 20);
  const lignes = Math.ceil(n / parLigne);
  const largeur = Math.max(parLigne + 1, 8) * P;
  const yRangee = (r: number) => (5 + 4 * r) * P;
  const hauteur = yRangee(lignes - 1) + P;
  const broches = new Map<string, Point>();
  fiche.broches.forEach((b, i) => broches.set(b.nom, { x: (1 + (i % parLigne)) * P, y: yRangee(Math.floor(i / parLigne)) }));
  const noms = fiche.broches.flatMap((b) => {
    const p = broches.get(b.nom);
    if (!p) return [];
    const x = p.x + 0.12 * P;
    const y = p.y - 0.45 * P;
    return [texte(x, y, b.nom, `class="etiquette-broche${b.role === 'non_connectee' ? ' nc' : ''}" transform="rotate(-90 ${x} ${y})"`)];
  });
  return {
    largeur,
    hauteur,
    broches,
    corps: () => [
      `<rect x="0" y="0" width="${largeur}" height="${hauteur}" rx="4" fill="#555" stroke="#333"/>`,
      texte(0.6 * P, 1.6 * P, fiche.nom, 'class="etiquette"'),
      ...noms,
    ].join(''),
  };
}

const cache = new Map<string, Dessin>();

/** Dessin d'une fiche : un dessin dédié si on en a un, sinon un boîtier générique. */
export function dessinPour(fiche: Fiche): Dessin {
  const connu = cache.get(fiche.id);
  if (connu) return connu;
  const type = fiche.modele?.type;
  const dessin =
    type === 'breadboard' ? dessinBreadboard(fiche)
    : fiche.id === 'esp32-devkitc' ? dessinEsp32(fiche)
    : fiche.id === 'tmc2209-module' ? dessinModuleTmc(fiche)
    : type === 'moteur_pas_a_pas' ? dessinMoteur(fiche)
    : type === 'resistance' ? dessinResistance()
    : type === 'alim_laboratoire' ? dessinAlim(fiche)
    : type === 'batterie' ? dessinBatterie()
    : type === 'condensateur' ? dessinCondensateur()
    : dessinGenerique(fiche);
  cache.set(fiche.id, dessin);
  return dessin;
}
