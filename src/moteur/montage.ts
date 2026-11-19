// Lecture d'un montage au format diagram.json de Wokwi (https://docs.wokwi.com/diagram-format).
// Chaque pièce est rattachée à sa fiche, ses réglages (attrs) sont vérifiés contre les
// paramètres de la fiche, et chaque extrémité de fil doit désigner une broche qui existe.
import type { Catalogue } from './catalogue';
import { trouverBroche, type Fiche } from './fiche';

export type ValeurParametre = number | boolean | string;

/** État d'une broche de microcontrôleur, réglé à la main (pas d'émulation du code). */
export const ETATS_BROCHE = ['entree', 'entree_tirage_haut', 'entree_tirage_bas', 'sortie_haute', 'sortie_basse'] as const;
export type EtatBroche = (typeof ETATS_BROCHE)[number];

export interface Piece {
  id: string;
  /** Type écrit dans le diagram.json (type Wokwi ou identifiant de fiche). */
  type: string;
  fiche: Fiche;
  parametres: Record<string, ValeurParametre>;
  /** État des broches choisi à la main (attribut "etats"), par nom de broche canonique. */
  etats: Record<string, EtatBroche>;
  position: { top: number; left: number };
}

export interface Extremite {
  piece: string;
  /** Nom canonique de la broche dans la fiche (un alias écrit dans le diagram.json est résolu). */
  broche: string;
}

export interface Connexion {
  de: Extremite;
  vers: Extremite;
  couleur: string;
}

export interface Montage {
  pieces: Piece[];
  connexions: Connexion[];
  avertissements: string[];
}

export class MontageInvalide extends Error {
  constructor(readonly erreurs: string[]) {
    super(`Montage invalide :\n- ${erreurs.join('\n- ')}`);
    this.name = 'MontageInvalide';
  }
}

/** Attributs propres au simulateur, en plus des paramètres de la fiche. */
const ATTRIBUTS_SIMULATEUR = new Set(['fiche', 'etats']);

function estObjet(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function trouverFiche(type: string, attrs: Record<string, unknown>, catalogue: Catalogue): Fiche | string {
  if (attrs['fiche'] !== undefined) {
    const id = String(attrs['fiche']);
    return catalogue.fiche(id) ?? `fiche « ${id} » inconnue (attribut fiche)`;
  }
  const directe = catalogue.fiche(type);
  if (directe) return directe;
  const wokwi = catalogue.fichesWokwi(type);
  if (wokwi.length === 1 && wokwi[0]) return wokwi[0];
  if (wokwi.length > 1) {
    return `type « ${type} » ambigu (fiches ${wokwi.map((f) => f.id).join(', ')}) : préciser l'attribut fiche`;
  }
  return `type « ${type} » inconnu : aucune fiche ne lui correspond`;
}

function convertir(brut: unknown, defaut: ValeurParametre | undefined): ValeurParametre | undefined {
  const attendu = defaut === undefined ? 'number' : typeof defaut;
  if (attendu === 'boolean') {
    if (typeof brut === 'boolean') return brut;
    if (brut === 'true' || brut === 'false') return brut === 'true';
    return undefined;
  }
  if (attendu === 'number') {
    const n = typeof brut === 'number' ? brut : typeof brut === 'string' && brut.trim() !== '' ? Number(brut) : NaN;
    return Number.isFinite(n) ? n : undefined;
  }
  return typeof brut === 'string' || typeof brut === 'number' ? String(brut) : undefined;
}

function lireParametres(id: string, fiche: Fiche, attrs: Record<string, unknown>, erreurs: string[], avertissements: string[]) {
  const parametres: Record<string, ValeurParametre> = {};
  const definitions = fiche.parametres ?? {};
  for (const [nom, def] of Object.entries(definitions)) {
    const brut = attrs[nom];
    if (brut === undefined) {
      if (def.defaut !== undefined) parametres[nom] = def.defaut;
      continue;
    }
    const valeur = convertir(brut, def.defaut);
    if (valeur === undefined) {
      erreurs.push(`${id} : paramètre ${nom} = « ${String(brut)} » n'a pas le bon type`);
      continue;
    }
    if (typeof valeur === 'number') {
      if (def.min !== undefined && valeur < def.min) erreurs.push(`${id} : ${nom} = ${valeur} ${def.unite} est sous le minimum (${def.min})`);
      if (def.max !== undefined && valeur > def.max) erreurs.push(`${id} : ${nom} = ${valeur} ${def.unite} dépasse le maximum (${def.max})`);
    }
    if (def.choix && typeof valeur !== 'boolean' && !def.choix.includes(valeur)) {
      erreurs.push(`${id} : ${nom} = ${String(valeur)} n'est pas parmi ${def.choix.join(', ')}`);
    }
    parametres[nom] = valeur;
  }
  for (const nom of Object.keys(attrs)) {
    if (!(nom in definitions) && !ATTRIBUTS_SIMULATEUR.has(nom)) {
      avertissements.push(`${id} : attribut « ${nom} » ignoré (pas un paramètre de la fiche ${fiche.id})`);
    }
  }
  return parametres;
}

function lireEtats(id: string, fiche: Fiche, brut: unknown, erreurs: string[]) {
  const etats: Record<string, EtatBroche> = {};
  if (brut === undefined) return etats;
  if (!estObjet(brut)) {
    erreurs.push(`${id} : l'attribut etats doit être un objet { broche: état }`);
    return etats;
  }
  for (const [nom, etat] of Object.entries(brut)) {
    const broche = trouverBroche(fiche, nom);
    if (!broche) erreurs.push(`${id} : etats cite la broche « ${nom} », absente de la fiche ${fiche.id}`);
    else if (!(ETATS_BROCHE as readonly unknown[]).includes(etat)) {
      erreurs.push(`${id} : état « ${String(etat)} » inconnu pour ${nom} (attendu : ${ETATS_BROCHE.join(', ')})`);
    } else etats[broche.nom] = etat as EtatBroche;
  }
  return etats;
}

/** Lit un diagram.json déjà analysé (JSON.parse). Lève MontageInvalide avec toutes les erreurs trouvées. */
export function lireMontage(donnees: unknown, catalogue: Catalogue): Montage {
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  if (!estObjet(donnees) || !Array.isArray(donnees['parts']) || !Array.isArray(donnees['connections'])) {
    throw new MontageInvalide(['le fichier doit être un objet avec les tableaux « parts » et « connections »']);
  }

  const pieces = new Map<string, Piece>();
  for (const [i, partie] of donnees['parts'].entries()) {
    if (!estObjet(partie) || typeof partie['id'] !== 'string' || typeof partie['type'] !== 'string') {
      erreurs.push(`parts[${i}] : il faut un « id » et un « type » (texte)`);
      continue;
    }
    const id = partie['id'];
    const type = partie['type'];
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      erreurs.push(`pièce « ${id} » : l'id ne doit contenir que lettres, chiffres, _ et -`);
      continue;
    }
    if (pieces.has(id)) {
      erreurs.push(`pièce « ${id} » : id en double`);
      continue;
    }
    const attrs = estObjet(partie['attrs']) ? partie['attrs'] : {};
    const fiche = trouverFiche(type, attrs, catalogue);
    if (typeof fiche === 'string') {
      erreurs.push(`pièce « ${id} » : ${fiche}`);
      continue;
    }
    pieces.set(id, {
      id,
      type,
      fiche,
      parametres: lireParametres(id, fiche, attrs, erreurs, avertissements),
      etats: lireEtats(id, fiche, attrs['etats'], erreurs),
      position: {
        top: typeof partie['top'] === 'number' ? partie['top'] : 0,
        left: typeof partie['left'] === 'number' ? partie['left'] : 0,
      },
    });
  }

  const extremite = (texte: unknown, ou: string): Extremite | undefined => {
    if (typeof texte !== 'string' || !texte.includes(':')) {
      erreurs.push(`${ou} : « ${String(texte)} » n'est pas de la forme piece:broche`);
      return undefined;
    }
    const deuxPoints = texte.indexOf(':');
    const id = texte.slice(0, deuxPoints);
    const nom = texte.slice(deuxPoints + 1);
    const piece = pieces.get(id);
    if (!piece) {
      erreurs.push(`${ou} : la pièce « ${id} » n'existe pas`);
      return undefined;
    }
    const broche = trouverBroche(piece.fiche, nom);
    if (!broche) {
      erreurs.push(`${ou} : la pièce ${id} (${piece.fiche.id}) n'a pas de broche « ${nom} »`);
      return undefined;
    }
    return { piece: id, broche: broche.nom };
  };

  const connexions: Connexion[] = [];
  for (const [i, ligne] of donnees['connections'].entries()) {
    if (!Array.isArray(ligne) || ligne.length < 2) {
      erreurs.push(`connections[${i}] : il faut au moins deux extrémités`);
      continue;
    }
    const [a, b, couleur] = ligne as unknown[];
    // "$serialMonitor:RX" et autres instruments de Wokwi : sans effet électrique ici.
    if ((typeof a === 'string' && a.startsWith('$')) || (typeof b === 'string' && b.startsWith('$'))) continue;
    const de = extremite(a, `connections[${i}]`);
    const vers = extremite(b, `connections[${i}]`);
    if (de && vers) connexions.push({ de, vers, couleur: typeof couleur === 'string' ? couleur : '' });
  }

  if (erreurs.length > 0) throw new MontageInvalide(erreurs);
  return { pieces: [...pieces.values()], connexions, avertissements };
}
