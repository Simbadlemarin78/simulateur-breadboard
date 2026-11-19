// Format d'un verdict (« constat ») et outils communs aux vérifications et aux règles.
import type { Calcul } from './circuit';
import type { Catalogue } from './catalogue';
import { trouverBroche, versUniteDeBase, type Broche, type Fiche, type Grandeur, type Source } from './fiche';
import type { Montage } from './montage';
import type { Reseau } from './reseau';

/** Les cinq verdicts, du plus grave au moins grave. */
export const VERDICTS = ['grille', 'risque_eleve', 'risque', 'chauffe', 'ne_marchera_pas'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const NOMS_VERDICTS: Record<Verdict, string> = {
  grille: 'grillé',
  risque_eleve: 'risque élevé',
  risque: 'risque',
  chauffe: 'chauffe',
  ne_marchera_pas: 'ne marchera pas',
};

/** Température ambiante supposée pour les estimations thermiques (hypothèse, à régler plus tard). */
export const TEMPERATURE_AMBIANTE = 25;

export interface Constat {
  verdict: Verdict;
  /** Pièce du montage concernée ("drv1", "esp", "bb1"), ou "fil" pour un fil. */
  piece: string;
  /** Point précis, tel qu'on le lit sur le montage : "esp:32", "drv1:VM", "bb1:bp.1". */
  point?: string;
  /** Connexion concernée (fil ou contact), indice dans montage.connexions. */
  connexion?: number;
  /** Une ligne : ce qui ne va pas. */
  titre: string;
  /** Pourquoi c'est un problème, avec la valeur et la limite. */
  explication: string;
  correction?: string;
  /** Fiche et source de la limite ou de la règle (page de la datasheet...). */
  source?: { fiche: string; src: Source };
  /** Calcul (tensions, courants) ou règle (ce que le calcul ne voit pas). */
  origine: 'calcul' | 'regle';
  /** Identifiant de la règle de la fiche, pour une règle. */
  regle?: string;
  /** Vrai si la limite ou la règle vient d'une fiche encore en brouillon. */
  brouillon: boolean;
}

/** Ce que reçoivent les vérifications et les règles. */
export interface Contexte {
  montage: Montage;
  catalogue: Catalogue;
  /** Calcul avec les états de broches réglés à la main. */
  calcul: Calcul;
  /** Calcul au démarrage : broches dans leur état d'après le reset. */
  demarrage: Calcul;
  /** Réseau de l'étape 3 : fils et enfichages fondus, un nœud = un morceau de cuivre. */
  grossier: Reseau;
}

export type NouveauConstat = Omit<Constat, 'brouillon' | 'piece'> & { chemin: string; fiche: Fiche };

/** Complète un constat : pièce du montage d'après le chemin, drapeau brouillon d'après la fiche. */
export function constat(c: NouveauConstat): Constat {
  const { chemin, fiche, ...reste } = c;
  const statut = (fiche['validation'] as { statut?: string } | undefined)?.statut;
  return { ...reste, piece: chemin.split('/')[0] ?? chemin, brouillon: statut !== 'relue' };
}

function nombre(x: number, decimales: number): string {
  return x.toFixed(decimales).replace('.', ',').replace('-', '−');
}

/** Valeur lisible en français : 0,232 A -> « 232 mA », 2,97 V -> « 2,97 V ». */
export function formater(x: number, unite: 'V' | 'A' | 'W' | '°C' | 'Ω'): string {
  const a = Math.abs(x);
  switch (unite) {
    case 'A':
      if (a >= 1) return `${nombre(x, 2)} A`;
      if (a >= 1e-3) return `${nombre(x * 1e3, a >= 0.1 ? 0 : 1)} mA`;
      return `${nombre(x * 1e6, 0)} µA`;
    case 'V':
      return `${nombre(x, a >= 10 ? 1 : 2)} V`;
    case 'W':
      return `${nombre(x, a >= 10 ? 1 : 2)} W`;
    case '°C':
      return `${nombre(x, 0)} °C`;
    case 'Ω':
      return a >= 1000 ? `${nombre(x / 1000, 1)} kΩ` : `${nombre(x, 1)} Ω`;
  }
}

/** Valeur d'une borne (min ou max) d'une grandeur, dans l'unité de base. */
export function borne(g: Grandeur | undefined, champ: 'min' | 'typ' | 'max'): number | undefined {
  const v = g?.[champ];
  return v === undefined || !g ? undefined : versUniteDeBase(v, g.unite);
}

/**
 * Point tel qu'on le lit sur le montage : une broche de puce est remplacée par la broche du
 * module ou de la carte qui y renvoie ("esp/U1:GPIO32" -> "esp:32").
 */
export function pointAffiche(chemin: string, broche: string, fiches: Map<string, Fiche>): string {
  const i = chemin.lastIndexOf('/');
  if (i < 0) return `${chemin}:${broche}`;
  const parent = chemin.slice(0, i);
  const ref = chemin.slice(i + 1);
  const b = fiches.get(parent)?.broches.find((x) => x.vers === `${ref}.${broche}`);
  return b ? pointAffiche(parent, b.nom, fiches) : `${chemin}:${broche}`;
}

/** Fiche et broche d'un point "chemin:broche". */
export function brocheDe(point: string, fiches: Map<string, Fiche>): { chemin: string; fiche: Fiche; broche: Broche } | undefined {
  const i = point.lastIndexOf(':');
  const chemin = point.slice(0, i);
  const fiche = fiches.get(chemin);
  const broche = fiche && trouverBroche(fiche, point.slice(i + 1));
  return fiche && broche ? { chemin, fiche, broche } : undefined;
}

/** Nom canonique d'une broche (alias résolu). */
export function canon(fiche: Fiche, nom: string | undefined): string | undefined {
  return nom === undefined ? undefined : (trouverBroche(fiche, nom)?.nom ?? nom);
}
