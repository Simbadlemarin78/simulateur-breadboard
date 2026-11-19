// Types TypeScript des fiches composants (fiches/*.json).
// Ils suivent schema/fiche-composant.schema.json, qui reste la référence : le test
// tests/schema.test.ts garantit que chaque fiche chargée respecte ce schéma.

export interface Source {
  type: 'datasheet' | 'mesure' | 'hypothese' | 'heritee';
  [champ: string]: unknown;
}

/** Une valeur physique avec son unité et sa source (au moins un de min, typ, max). */
export interface Grandeur {
  min?: number;
  typ?: number;
  max?: number;
  unite: string;
  conditions?: string;
  src: Source;
  note?: string;
}

export interface Broche {
  nom: string;
  alias?: string[];
  role: string;
  fonctions?: string[];
  /** Pour un module : broche du sous-composant reliée à celle-ci, ex. "U1.VS". */
  vers?: string;
  domaine?: { alim?: string; masse: string };
  [champ: string]: unknown;
}

export interface Liaison {
  entre: [string, string];
  type: 'direct' | 'resistance' | 'diode' | 'condensateur';
  valeur?: Grandeur;
  src: Source;
  note?: string;
}

export interface Parametre {
  description: string;
  unite: string;
  defaut?: number | boolean | string;
  min?: number;
  max?: number;
  choix?: (number | string)[];
  src?: Source;
}

export interface SousComposant {
  ref: string;
  fiche: string;
  valeurs?: Record<string, Grandeur>;
  note?: string;
}

export interface Fiche {
  format: string;
  id: string;
  nom: string;
  categorie: string;
  wokwi?: { type: string; broches?: Record<string, string> };
  broches: Broche[];
  sous_composants?: SousComposant[];
  liaisons_internes?: Liaison[];
  parametres?: Record<string, Parametre>;
  modele?: { type: string; valeurs: Record<string, unknown> };
  [champ: string]: unknown;
}

/** Loi d'une diode (schéma : $defs/diode). */
export interface ModeleDiode {
  tension_directe: Grandeur;
  courant: Grandeur;
  idealite: Grandeur;
}

/** Facteur qui ramène une unité de fiche à l'unité de base (V, A, Ω, F, W, s, Hz). */
const FACTEURS: Record<string, number> = {
  mV: 1e-3,
  mA: 1e-3,
  µA: 1e-6,
  nA: 1e-9,
  mΩ: 1e-3,
  kΩ: 1e3,
  MΩ: 1e6,
  mF: 1e-3,
  µF: 1e-6,
  nF: 1e-9,
  pF: 1e-12,
  mH: 1e-3,
  µH: 1e-6,
  mW: 1e-3,
  ms: 1e-3,
  µs: 1e-6,
  ns: 1e-9,
  kHz: 1e3,
  MHz: 1e6,
};

/** Convertit un nombre exprimé dans l'unité d'une fiche vers l'unité de base. */
export function versUniteDeBase(valeur: number, unite: string): number {
  return valeur * (FACTEURS[unite] ?? 1);
}

/**
 * Valeur d'une grandeur dans l'unité de base : le premier champ présent parmi ceux demandés
 * (typique par défaut, puis max, puis min).
 */
export function valeurSI(g: Grandeur | undefined, ordre: ('typ' | 'min' | 'max')[] = ['typ', 'max', 'min']): number | undefined {
  if (!g) return undefined;
  for (const champ of ordre) {
    const v = g[champ];
    if (v !== undefined) return versUniteDeBase(v, g.unite);
  }
  return undefined;
}

/** Trouve une broche par son nom ou l'un de ses alias. */
export function trouverBroche(fiche: Fiche, nom: string): Broche | undefined {
  return fiche.broches.find((b) => b.nom === nom) ?? fiche.broches.find((b) => b.alias?.includes(nom));
}
