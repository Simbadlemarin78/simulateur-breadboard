// Du montage au réseau : on regroupe en « nœuds » les broches reliées sans résistance
// (fils, bandes de la breadboard, liaisons directes internes, renvois module -> puce).
// Les liaisons internes qui ont une valeur (résistance, condensateur, diode) deviennent
// des éléments entre deux nœuds, pour le calcul de l'étape 5.
//
// Nommage des points : "piece:broche" pour une pièce du montage, "piece/U1:broche" pour un
// sous-composant (la puce d'un module), "piece/U1/U2:broche" s'il y a plusieurs niveaux.
import type { Catalogue } from './catalogue';
import { trouverBroche, type Fiche, type Grandeur } from './fiche';
import type { Montage, ValeurParametre } from './montage';

export interface Noeud {
  id: number;
  /** Points du nœud, triés. */
  points: string[];
}

export interface ElementInterne {
  /** Chemin de la pièce qui porte la liaison, ex. "drv1" ou "esp/U1". */
  piece: string;
  type: 'resistance' | 'condensateur' | 'diode';
  entre: [string, string];
  noeuds: [number, number];
  valeur?: Grandeur;
}

/** Un fil gardé à part (option filsSepares) : connexion du montage et nœuds de ses deux bouts. */
export interface FilSepare {
  /** Indice de la connexion dans montage.connexions. */
  connexion: number;
  noeuds: [number, number];
}

export interface Reseau {
  noeuds: Noeud[];
  elements: ElementInterne[];
  /** Fils gardés à part ; vide sans l'option filsSepares. */
  fils: FilSepare[];
  /** Nœud d'un point "piece:broche" (alias acceptés pour les pièces du montage). */
  noeudDe(point: string): Noeud | undefined;
}

export interface OptionsReseau {
  /**
   * Garde les fils (connexions avec une couleur) comme des éléments entre deux nœuds au lieu de
   * fondre leurs deux bouts : le calcul leur donne une résistance et un courant. Les enfichages
   * (connexions sans couleur) restent fondus.
   */
  filsSepares?: boolean;
}

/** Union-find : chaque point pointe vers un représentant de son groupe. */
class Groupes {
  private readonly parent = new Map<string, string>();

  ajouter(p: string): void {
    if (!this.parent.has(p)) this.parent.set(p, p);
  }

  racine(p: string): string {
    let r = p;
    for (let suivant = this.parent.get(r); suivant !== undefined && suivant !== r; suivant = this.parent.get(r)) r = suivant;
    // Compression du chemin.
    for (let q = p; q !== r; ) {
      const suivant = this.parent.get(q) ?? r;
      this.parent.set(q, r);
      q = suivant;
    }
    return r;
  }

  unir(a: string, b: string): void {
    this.ajouter(a);
    this.ajouter(b);
    const ra = this.racine(a);
    const rb = this.racine(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  points(): string[] {
    return [...this.parent.keys()];
  }
}

/**
 * Bande de la breadboard à laquelle appartient un trou (noms de Wokwi, fiche breadboard-830) :
 * "27t.c" -> "27t" (5 trous d'une colonne), "tn.6" -> "tn" (rail entier), ou "tn-1" / "tn-2"
 * si les rails sont coupés en deux moitiés de 25 trous (paramètre rails_coupes).
 */
export function bandeBreadboard(trou: string, railsCoupes: boolean): string | undefined {
  const colonne = /^(\d+)([tb])\.[a-j]$/.exec(trou);
  if (colonne) return `${colonne[1]}${colonne[2]}`;
  const rail = /^([tb][pn])\.(\d+)$/.exec(trou);
  if (rail) return railsCoupes ? `${rail[1]}-${Number(rail[2]) <= 25 ? 1 : 2}` : rail[1];
  return undefined;
}

export function construireReseau(montage: Montage, catalogue: Catalogue, options: OptionsReseau = {}): Reseau {
  const groupes = new Groupes();
  const liaisons: { piece: string; type: ElementInterne['type']; entre: [string, string]; valeur?: Grandeur }[] = [];
  const erreurs: string[] = [];

  const ajouterPiece = (chemin: string, fiche: Fiche, parametres: Record<string, ValeurParametre>): void => {
    for (const b of fiche.broches) groupes.ajouter(`${chemin}:${b.nom}`);

    for (const l of fiche.liaisons_internes ?? []) {
      const [a, b] = l.entre.map((nom) => `${chemin}:${trouverBroche(fiche, nom)?.nom ?? nom}`) as [string, string];
      if (l.type === 'direct') groupes.unir(a, b);
      else liaisons.push({ piece: chemin, type: l.type, entre: [a, b], ...(l.valeur ? { valeur: l.valeur } : {}) });
    }

    if (fiche.modele?.type === 'breadboard') {
      const premierTrou = new Map<string, string>();
      for (const b of fiche.broches) {
        const bande = bandeBreadboard(b.nom, parametres['rails_coupes'] === true);
        if (bande === undefined) continue;
        const point = `${chemin}:${b.nom}`;
        const premier = premierTrou.get(bande);
        if (premier === undefined) premierTrou.set(bande, point);
        else groupes.unir(premier, point);
      }
    }

    // Sous-composants : seuls ceux vers lesquels pointe au moins une broche ("vers") sont créés.
    for (const sc of fiche.sous_composants ?? []) {
      const renvois = fiche.broches.filter((b) => b.vers?.startsWith(`${sc.ref}.`));
      if (renvois.length === 0) continue;
      const sousFiche = catalogue.fiche(sc.fiche);
      if (!sousFiche) {
        erreurs.push(`${chemin} : sous-composant ${sc.ref}, fiche « ${sc.fiche} » introuvable`);
        continue;
      }
      const sousChemin = `${chemin}/${sc.ref}`;
      ajouterPiece(sousChemin, sousFiche, {});
      for (const b of renvois) {
        const nomCible = (b.vers ?? '').slice(sc.ref.length + 1);
        const cible = trouverBroche(sousFiche, nomCible);
        if (!cible) erreurs.push(`${chemin}:${b.nom} : ${sc.fiche} n'a pas de broche « ${nomCible} »`);
        else groupes.unir(`${chemin}:${b.nom}`, `${sousChemin}:${cible.nom}`);
      }
    }
  };

  for (const piece of montage.pieces) ajouterPiece(piece.id, piece.fiche, piece.parametres);
  const filsAPart: number[] = [];
  montage.connexions.forEach((c, i) => {
    const de = `${c.de.piece}:${c.de.broche}`;
    const vers = `${c.vers.piece}:${c.vers.broche}`;
    if (options.filsSepares && c.couleur !== '') {
      groupes.ajouter(de);
      groupes.ajouter(vers);
      filsAPart.push(i);
    } else groupes.unir(de, vers);
  });
  if (erreurs.length > 0) throw new Error(`Réseau impossible à construire :\n- ${erreurs.join('\n- ')}`);

  // Regroupement par racine, ordre stable : nœuds triés par leur premier point.
  const parRacine = new Map<string, string[]>();
  for (const p of groupes.points()) {
    const r = groupes.racine(p);
    const liste = parRacine.get(r) ?? [];
    liste.push(p);
    parRacine.set(r, liste);
  }
  const listes = [...parRacine.values()].map((l) => l.sort()).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
  const noeuds: Noeud[] = listes.map((points, id) => ({ id, points }));
  const indexPoint = new Map<string, Noeud>();
  for (const n of noeuds) for (const p of n.points) indexPoint.set(p, n);

  const piecesParId = new Map(montage.pieces.map((p) => [p.id, p]));
  const noeudDe = (point: string): Noeud | undefined => {
    const direct = indexPoint.get(point);
    if (direct) return direct;
    // Alias accepté pour une pièce du montage : "esp:IO13" -> "esp:13".
    const deuxPoints = point.indexOf(':');
    const piece = piecesParId.get(point.slice(0, deuxPoints));
    const broche = piece && trouverBroche(piece.fiche, point.slice(deuxPoints + 1));
    return broche ? indexPoint.get(`${point.slice(0, deuxPoints)}:${broche.nom}`) : undefined;
  };

  const elements: ElementInterne[] = liaisons.map((l) => {
    const na = indexPoint.get(l.entre[0]);
    const nb = indexPoint.get(l.entre[1]);
    if (!na || !nb) throw new Error(`liaison interne de ${l.piece} : broche inconnue (${l.entre.join(' - ')})`);
    return { ...l, noeuds: [na.id, nb.id] };
  });

  const fils: FilSepare[] = filsAPart.map((i) => {
    const c = montage.connexions[i]!;
    const na = indexPoint.get(`${c.de.piece}:${c.de.broche}`)!;
    const nb = indexPoint.get(`${c.vers.piece}:${c.vers.broche}`)!;
    return { connexion: i, noeuds: [na.id, nb.id] };
  });

  return { noeuds, elements, fils, noeudDe };
}

/**
 * Broches des pièces du montage (hors sous-composants et hors connectique : breadboard, fils)
 * qui appartiennent à un nœud. Sert à compter les nœuds « utiles » à la main.
 */
export function brochesDeComposants(noeud: Noeud, montage: Montage): string[] {
  const connectique = new Set(montage.pieces.filter((p) => p.fiche.categorie === 'connectique').map((p) => p.id));
  return noeud.points.filter((p) => {
    const piece = p.slice(0, p.indexOf(':'));
    return !piece.includes('/') && !connectique.has(piece);
  });
}
