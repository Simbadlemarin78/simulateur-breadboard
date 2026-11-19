// Éditeur du montage (étape 7), sans navigateur : il tient le diagram.json et sait poser,
// déplacer, enficher et supprimer une pièce, tracer et supprimer un fil, annuler et rétablir,
// importer et exporter. L'interface (main.ts) ne fait que traduire la souris en appels.
//
// Enfichage : quand on lâche une pièce au-dessus d'une breadboard, on cherche le trou le plus
// proche de sa première broche ; si, une fois la pièce recalée sur ce trou, chacune de ses
// broches tombe sur un trou libre, la pièce est enfichée : une connexion sans couleur par broche,
// comme les écrit Wokwi. Sinon, elle est simplement posée.
import type { Catalogue } from '../moteur/catalogue';
import type { Fiche } from '../moteur/fiche';
import { lireMontage, MontageInvalide, type Montage } from '../moteur/montage';
import { bandeBreadboard } from '../moteur/reseau';
import { dessinPour, P } from './pieces/dessins';
import { placerPieces } from './plan';

export interface PartieDiagramme {
  type: string;
  id: string;
  top: number;
  left: number;
  attrs: Record<string, unknown>;
  [champ: string]: unknown;
}

/** Une ligne de « connections » : [de, vers, couleur, chemin dessiné par Wokwi]. */
export type ConnexionDiagramme = [string, string, string, unknown[]];

export interface Diagramme {
  version: number;
  author?: string;
  editor?: string;
  parts: PartieDiagramme[];
  connections: ConnexionDiagramme[];
  dependencies?: Record<string, unknown>;
  [champ: string]: unknown;
}

/** Distance (px) en deçà de laquelle une broche lâchée près d'un trou s'y enfiche. */
export const ACCROCHE = 0.6 * P;

const HISTORIQUE_MAX = 100;

/** Catégories de pièces qu'on enfiche dans une breadboard (pas une alim, un moteur ou une autre breadboard). */
const ENFICHABLES = new Set(['passif', 'module', 'carte']);

export function diagrammeVide(): Diagramme {
  return { version: 1, author: 'simulateur-breadboard', editor: 'wokwi', parts: [], connections: [], dependencies: {} };
}

/** Met un diagram.json lu dans un fichier sous la forme attendue par l'éditeur. */
function normaliser(brut: unknown): Diagramme {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) throw new MontageInvalide(['le fichier doit contenir un objet JSON']);
  const d = structuredClone(brut) as Record<string, unknown>;
  if (!Array.isArray(d['parts']) || !Array.isArray(d['connections'])) throw new MontageInvalide(['il faut les tableaux « parts » et « connections »']);
  d['parts'] = (d['parts'] as Record<string, unknown>[]).map((p) => ({
    ...p,
    top: typeof p['top'] === 'number' ? p['top'] : 0,
    left: typeof p['left'] === 'number' ? p['left'] : 0,
    attrs: typeof p['attrs'] === 'object' && p['attrs'] !== null ? p['attrs'] : {},
  }));
  d['connections'] = (d['connections'] as unknown[][]).map((c) => [c[0], c[1], typeof c[2] === 'string' ? c[2] : '', Array.isArray(c[3]) ? c[3] : []]);
  return d as Diagramme;
}

/** Préfixe des identifiants de pièce, comme dans les montages de Wokwi. */
function prefixe(fiche: Fiche): string {
  switch (fiche.modele?.type) {
    case 'breadboard':
      return 'bb';
    case 'microcontroleur':
      return 'esp';
    case 'driver_pas_a_pas':
      return 'drv';
    case 'moteur_pas_a_pas':
      return 'mot';
    case 'resistance':
      return 'r';
    case 'condensateur':
      return 'c';
    case 'alim_laboratoire':
      return 'alim';
    case 'batterie':
      return 'batt';
    default:
      return fiche.id.replace(/[^a-z]/g, '').slice(0, 4) || 'p';
  }
}

/** Couleur d'un nouveau fil, d'après le rôle des broches : noir pour une masse, rouge pour une alim. */
function couleurPour(roles: string[]): string {
  if (roles.includes('masse')) return 'black';
  if (roles.some((r) => r === 'alim_entree' || r === 'alim_sortie')) return 'red';
  return 'green';
}

/** Les fiches qu'on peut poser sur le plan : tout sauf les puces seules et les fils. */
export function fichesPosables(catalogue: Catalogue): Fiche[] {
  return catalogue.fiches.filter((f) => f.categorie !== 'puce' && f.modele?.type !== 'fil');
}

export class Editeur {
  private actuel: Diagramme;
  private passe: Diagramme[] = [];
  private futur: Diagramme[] = [];
  private cache: { version: Diagramme; montage: Montage } | undefined;

  constructor(
    private readonly catalogue: Catalogue,
    diagramme: Diagramme = diagrammeVide(),
  ) {
    this.actuel = normaliser(diagramme);
    lireMontage(this.actuel, catalogue);
  }

  /** Lit un diagram.json (texte) ; lève MontageInvalide avec la liste des erreurs. */
  static depuisTexte(texte: string, catalogue: Catalogue): Editeur {
    let brut: unknown;
    try {
      brut = JSON.parse(texte);
    } catch (e) {
      throw new MontageInvalide([`ce n'est pas du JSON valide (${e instanceof Error ? e.message : String(e)})`]);
    }
    return new Editeur(catalogue, normaliser(brut));
  }

  get diagramme(): Diagramme {
    return this.actuel;
  }

  montage(): Montage {
    if (this.cache?.version !== this.actuel) this.cache = { version: this.actuel, montage: lireMontage(this.actuel, this.catalogue) };
    return this.cache.montage;
  }

  exporter(): string {
    return `${JSON.stringify(this.actuel, null, 2)}\n`;
  }

  peutAnnuler(): boolean {
    return this.passe.length > 0;
  }

  peutRetablir(): boolean {
    return this.futur.length > 0;
  }

  annuler(): boolean {
    const d = this.passe.pop();
    if (!d) return false;
    this.futur.push(this.actuel);
    this.actuel = d;
    return true;
  }

  retablir(): boolean {
    const d = this.futur.pop();
    if (!d) return false;
    this.passe.push(this.actuel);
    this.actuel = d;
    return true;
  }

  /**
   * Applique une modification sur une copie ; si le montage reste lisible, elle devient l'état
   * courant et l'ancien part dans l'historique. Renvoie un message d'erreur, ou undefined.
   */
  private modifier(changer: (d: Diagramme) => string | undefined): string | undefined {
    const copie = structuredClone(this.actuel);
    const refus = changer(copie);
    if (refus) return refus;
    try {
      lireMontage(copie, this.catalogue);
    } catch (e) {
      return e instanceof MontageInvalide ? e.erreurs.join(' ; ') : String(e);
    }
    this.passe.push(this.actuel);
    if (this.passe.length > HISTORIQUE_MAX) this.passe.shift();
    this.futur = [];
    this.actuel = copie;
    return undefined;
  }

  private fiche(type: string, attrs: Record<string, unknown>): Fiche | undefined {
    if (typeof attrs['fiche'] === 'string') return this.catalogue.fiche(attrs['fiche']);
    return this.catalogue.fiche(type) ?? this.catalogue.fichesWokwi(type)[0];
  }

  /** Pose une nouvelle pièce (coin haut gauche en x, y) ; renvoie son identifiant. */
  ajouterPiece(idFiche: string, x: number, y: number): string {
    const fiche = this.catalogue.fiche(idFiche);
    if (!fiche) throw new Error(`fiche « ${idFiche} » inconnue`);
    const type = fiche.wokwi?.type ?? fiche.id;
    const attrs: Record<string, unknown> = this.catalogue.fichesWokwi(type).length > 1 ? { fiche: fiche.id } : {};
    const pris = new Set(this.actuel.parts.map((p) => p.id));
    const debut = prefixe(fiche);
    let n = 1;
    while (pris.has(`${debut}${n}`)) n++;
    const id = `${debut}${n}`;
    const refus = this.modifier((d) => {
      d.parts.push({ type, id, top: Math.round(y), left: Math.round(x), attrs });
      return this.enficher(d, id, x, y);
    });
    if (refus) throw new Error(refus);
    return id;
  }

  /** Déplace une pièce (coin haut gauche en x, y), en l'enfichant si elle tombe sur des trous. */
  deplacerPiece(id: string, x: number, y: number): string | undefined {
    return this.modifier((d) => {
      const partie = d.parts.find((p) => p.id === id);
      if (!partie) return `pièce « ${id} » introuvable`;
      const fiche = this.fiche(partie.type, partie.attrs);
      if (fiche?.modele?.type === 'breadboard') {
        // Les pièces enfichées suivent leur breadboard.
        const dx = Math.round(x) - partie.left;
        const dy = Math.round(y) - partie.top;
        const enfichees = new Set(d.connections.filter((c) => c[2] === '' && (c[0].startsWith(`${id}:`) || c[1].startsWith(`${id}:`))).map((c) => (c[0].startsWith(`${id}:`) ? c[1] : c[0]).split(':')[0]));
        for (const p of d.parts) if (p.id === id || enfichees.has(p.id)) [p.left, p.top] = [p.left + dx, p.top + dy];
        return undefined;
      }
      // On défait l'enfichage, puis on regarde si la nouvelle place permet d'en refaire un.
      d.connections = d.connections.filter((c) => !(c[2] === '' && this.estEnfichage(d, c, id)));
      return this.enficher(d, id, x, y);
    });
  }

  /** Vrai si la connexion relie une broche de la pièce à un trou de breadboard. */
  private estEnfichage(d: Diagramme, c: ConnexionDiagramme, id: string): boolean {
    const [a, b] = [c[0].split(':')[0], c[1].split(':')[0]];
    const autre = a === id ? b : b === id ? a : undefined;
    const partie = autre !== undefined ? d.parts.find((p) => p.id === autre) : undefined;
    return partie !== undefined && this.fiche(partie.type, partie.attrs)?.modele?.type === 'breadboard';
  }

  /** Place la pièce en x, y ; si toutes ses broches tombent sur des trous libres d'une breadboard, l'y enfiche. */
  private enficher(d: Diagramme, id: string, x: number, y: number): undefined {
    const partie = d.parts.find((p) => p.id === id)!;
    partie.left = Math.round(x);
    partie.top = Math.round(y);
    const fiche = this.fiche(partie.type, partie.attrs);
    if (!fiche || !ENFICHABLES.has(fiche.categorie)) return undefined;
    const dessin = dessinPour(fiche);
    const broches = [...dessin.broches];
    const premiere = broches[0];
    if (!premiere) return undefined;
    let montage: Montage;
    try {
      montage = lireMontage(d, this.catalogue);
    } catch {
      return undefined;
    }
    const occupes = new Set(d.connections.flatMap((c) => [c[0], c[1]]));
    for (const bb of placerPieces(montage).values()) {
      if (bb.piece.fiche.modele?.type !== 'breadboard') continue;
      const trous = [...bb.dessin.broches].map(([nom, p]) => ({ nom, x: bb.x + p.x, y: bb.y + p.y }));
      const cible = { x: x + premiere[1].x, y: y + premiere[1].y };
      const proche = trous.reduce<(typeof trous)[number] | undefined>((m, t) => {
        const dist = Math.hypot(t.x - cible.x, t.y - cible.y);
        return dist <= ACCROCHE && (!m || dist < Math.hypot(m.x - cible.x, m.y - cible.y)) ? t : m;
      }, undefined);
      if (!proche) continue;
      const dx = proche.x - cible.x;
      const dy = proche.y - cible.y;
      const parPosition = new Map(trous.map((t) => [`${Math.round(t.x)},${Math.round(t.y)}`, t.nom]));
      // Les broches qui tombent pile sur un trou s'y enfichent ; les autres (VREF sur le dessus
      // d'un module...) restent en l'air. Refus si un trou est pris, ou si deux broches tombent
      // sur la même bande : elles seraient en court-circuit.
      const places = broches.flatMap(([nom, p]) => {
        const trou = parPosition.get(`${Math.round(x + dx + p.x)},${Math.round(y + dy + p.y)}`);
        return trou ? [{ nom, trou }] : [];
      });
      if (places.some((pl) => occupes.has(`${bb.piece.id}:${pl.trou}`))) continue;
      const bandes = places.map((pl) => bandeBreadboard(pl.trou, bb.piece.parametres['rails_coupes'] === true));
      if (new Set(bandes).size < bandes.length) continue;
      partie.left = Math.round(x + dx);
      partie.top = Math.round(y + dy);
      for (const pl of places) d.connections.push([`${id}:${pl.nom}`, `${bb.piece.id}:${pl.trou}`, '', []]);
      return undefined;
    }
    return undefined;
  }

  /** Retire une pièce et toutes ses connexions. */
  supprimerPiece(id: string): string | undefined {
    return this.modifier((d) => {
      if (!d.parts.some((p) => p.id === id)) return `pièce « ${id} » introuvable`;
      d.parts = d.parts.filter((p) => p.id !== id);
      d.connections = d.connections.filter((c) => !c[0].startsWith(`${id}:`) && !c[1].startsWith(`${id}:`));
      return undefined;
    });
  }

  /** Trace un fil entre deux points "piece:broche". Un trou de breadboard ne reçoit qu'une chose. */
  ajouterFil(de: string, vers: string, couleur?: string): string | undefined {
    if (de === vers) return 'un fil doit relier deux points différents';
    return this.modifier((d) => {
      const montage = lireMontage(d, this.catalogue);
      const roles: string[] = [];
      for (const point of [de, vers]) {
        const [id, broche] = [point.slice(0, point.indexOf(':')), point.slice(point.indexOf(':') + 1)];
        const piece = montage.pieces.find((p) => p.id === id);
        const b = piece?.fiche.broches.find((x) => x.nom === broche || x.alias?.includes(broche));
        if (!piece || !b) return `point « ${point} » introuvable`;
        roles.push(b.role);
        if (piece.fiche.modele?.type === 'breadboard' && d.connections.some((c) => c[0] === point || c[1] === point)) {
          return `le trou ${point} est déjà occupé`;
        }
      }
      if (d.connections.some((c) => (c[0] === de && c[1] === vers) || (c[0] === vers && c[1] === de))) return 'ce fil existe déjà';
      d.connections.push([de, vers, couleur ?? couleurPour(roles), []]);
      return undefined;
    });
  }

  /** Retire la connexion de rang « indice » (tableau connections du diagram.json). */
  supprimerFil(indice: number): string | undefined {
    return this.modifier((d) => {
      if (!d.connections[indice]) return 'fil introuvable';
      d.connections.splice(indice, 1);
      return undefined;
    });
  }

  /** Change un réglage (attribut) d'une pièce ; undefined le retire. */
  reglerPiece(id: string, nom: string, valeur: unknown): string | undefined {
    return this.modifier((d) => {
      const partie = d.parts.find((p) => p.id === id);
      if (!partie) return `pièce « ${id} » introuvable`;
      if (valeur === undefined || valeur === '') delete partie.attrs[nom];
      else partie.attrs[nom] = valeur;
      return undefined;
    });
  }
}
