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

/** Trouve une broche par son nom ou l'un de ses alias. */
export function trouverBroche(fiche: Fiche, nom: string): Broche | undefined {
  return fiche.broches.find((b) => b.nom === nom) ?? fiche.broches.find((b) => b.alias?.includes(nom));
}
