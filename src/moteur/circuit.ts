// Du montage au calcul : chaque pièce devient des éléments électriques (résistances, sources,
// diodes, charges) tirés de sa fiche, puis le solveur calcule tensions et courants.
//
// Modèles retenus (régime continu, pièces à l'arrêt) :
// - fil : résistance de la fiche fil-dupont ; enfichage dans la breadboard : contact parfait ;
// - résistance, bobines du moteur, liaisons internes résistives : résistances ;
// - condensateur : circuit ouvert ;
// - alim de labo : source de tension avec limite de courant, qui n'absorbe pas de courant ;
// - batterie : source de tension en série avec sa résistance interne ;
// - carte ESP32 alimentée par l'USB : source de 3,3 V (régulateur) et consommation de la puce ;
// - broches : diodes de protection, tirages, résistance d'entrée, sortie (état réglé à la main) ;
// - driver : diodes du pont, potentiomètre VREF, et quand il est actif, courant imposé dans
//   chaque bobine (comme moteur à l'arrêt sur un pas complet) et puissance prise sur VS.
import type { Catalogue } from './catalogue';
import { grandeurModele, trouverBroche, valeurSI, versUniteDeBase, type Broche, type Fiche, type Grandeur, type ModeleDiode } from './fiche';
import type { EtatBroche, Montage, Piece, ValeurParametre } from './montage';
import { construireReseau, type Reseau } from './reseau';
import { courantSaturation, resoudre, VT_25C, type Element, type RegimeSource, type Solution } from './solveur';

export type RoleElement =
  | 'fil'
  | 'liaison'
  | 'resistance'
  | 'bobine'
  | 'source'
  | 'resistance_interne'
  | 'regulateur'
  | 'alimentation_usb'
  | 'consommation'
  | 'diode_protection'
  | 'tirage'
  | 'sortie'
  | 'resistance_entree'
  | 'diode_pont'
  | 'potentiometre'
  | 'pont'
  | 'pont_retour'
  | 'alimentation_driver'
  | 'contact';

/** Ce que représente un élément du calcul : pour le multimètre, les verdicts et les explications. */
export interface Etiquette {
  /** Chemin de la pièce : "drv1", "drv1/U1", "esp/U1". */
  piece: string;
  role: RoleElement;
  /** Broches concernées, noms de la fiche de la pièce. */
  broches: string[];
  /** Pour un fil : indice de la connexion dans montage.connexions. */
  connexion?: number;
}

export interface EtatDriver {
  /** Pièce du montage (le module). */
  piece: string;
  actif: boolean;
  /** Vrai si EN est entre les deux seuils : le driver peut aussi bien marcher que non. Compté actif. */
  indetermine: boolean;
  raison: string;
  /** Courant imposé dans chaque bobine (A), efficace réglé par VREF. */
  courantBobine: number;
  /** Puissance prise sur VS pour les bobines et les pertes du pont (W). */
  puissance: number;
  /** Puissance dissipée dans la puce : MOSFET du pont et consommation propre (W). */
  pertesPuce: number;
  /** VS et VCC_IO au-dessus de leurs seuils de sous-tension. */
  alimente: boolean;
  /** Tension de EN (ENN de la puce) par rapport à GND, et seuils bas et haut (V). */
  tensionEN: number | undefined;
  seuilsEN: [number, number];
  /** Courant réglé par l'UART (paramètre courant_uart) plutôt que par VREF. */
  parUart: boolean;
}

export interface Calcul {
  converge: boolean;
  message?: string;
  /** Réseau du calcul : comme celui de l'étape 3, mais chaque fil y garde ses deux bouts. */
  reseau: Reseau;
  elements: Element[];
  etiquettes: Etiquette[];
  solution: Solution;
  /** Tension d'un point "piece:broche" par rapport à la référence de sa partie du montage. */
  tension(point: string): number | undefined;
  /** Tension entre deux points ; undefined s'ils ne sont reliés par rien (rien ne fixe leur écart). */
  difference(a: string, b: string): number | undefined;
  /**
   * Courant dans une connexion (indice dans montage.connexions), compté de son bout « de » vers
   * « vers » : un fil, ou un enfichage dans la breadboard (courant du contact).
   */
  courantFil(connexion: number): number | undefined;
  /** Fiche de chaque pièce du calcul, par chemin ("drv1", "drv1/U1"). */
  fiches: Map<string, Fiche>;
  sources: { piece: string; regime: RegimeSource; tension: number; courant: number }[];
  drivers: EtatDriver[];
  avertissements: string[];
}

/** Une pièce du montage, ou un sous-composant (la puce d'un module) relié par des renvois. */
interface PieceElectrique {
  chemin: string;
  fiche: Fiche;
  parametres: Record<string, ValeurParametre>;
  piece: Piece;
}

interface EntreeBroche {
  resistance?: Grandeur;
  tirage?: { vers: 'alim' | 'masse'; resistance: Grandeur };
  diodes_protection?: { vers_alim?: boolean; vers_masse?: boolean; diode?: ModeleDiode };
}

interface SortieBroche {
  resistance_sortie?: Grandeur;
}

/** Même règle que le réseau : un sous-composant n'existe que si une broche du module y renvoie. */
function piecesElectriques(montage: Montage, catalogue: Catalogue): PieceElectrique[] {
  const liste: PieceElectrique[] = [];
  const parcourir = (chemin: string, fiche: Fiche, parametres: Record<string, ValeurParametre>, piece: Piece): void => {
    liste.push({ chemin, fiche, parametres, piece });
    for (const sc of fiche.sous_composants ?? []) {
      if (!fiche.broches.some((b) => b.vers?.startsWith(`${sc.ref}.`))) continue;
      const sous = catalogue.fiche(sc.fiche);
      if (sous) parcourir(`${chemin}/${sc.ref}`, sous, {}, piece);
    }
  };
  for (const p of montage.pieces) parcourir(p.id, p.fiche, p.parametres, p);
  return liste;
}

function lireDiode(m: ModeleDiode | undefined): { is: number; nvt: number } | undefined {
  if (!m) return undefined;
  const vf = valeurSI(m.tension_directe);
  const i = valeurSI(m.courant);
  const n = valeurSI(m.idealite);
  if (vf === undefined || i === undefined || n === undefined) return undefined;
  return { is: courantSaturation(vf, i, n), nvt: n * VT_25C };
}

/** Paramètre numérique d'une pièce, dans l'unité de base. */
function parametreSI(pe: PieceElectrique, nom: string): number | undefined {
  const v = pe.parametres[nom];
  const def = pe.fiche.parametres?.[nom];
  return typeof v === 'number' && def ? versUniteDeBase(v, def.unite) : undefined;
}

/** État d'une broche de microcontrôleur au démarrage, d'après sa fiche. */
export function etatDemarrage(b: Broche): EtatBroche {
  const etat = (b['etat_demarrage'] as { etat?: string } | undefined)?.etat;
  switch (etat) {
    case 'tirage_haut':
      return 'entree_tirage_haut';
    case 'tirage_bas':
      return 'entree_tirage_bas';
    case 'sortie_haute':
    case 'sortie_basse':
      return etat;
    default:
      return 'entree';
  }
}

interface Driver {
  piece: string;
  puce: PieceElectrique;
  n: { vs: number; gnd: number; vio: number; enn: number; vref: number; sorties: [number, number, number, number] };
  vref: number;
  rMesure: number;
  rInterne: number;
  vPleineEchelle: number;
  vrefPleineEchelle: number;
  rdsHaut: number;
  rdsBas: number;
  courantUart?: number;
  reposActif: number;
  reposInactif: number;
  sousTensionVS: number;
  sousTensionIO: number;
  seuilBas: number;
  seuilHaut: number;
  diodePont?: { is: number; nvt: number };
}

interface EtatCalculDriver {
  actif: boolean;
  indetermine: boolean;
  raison: string;
  courant: number;
  compliance: number;
  puissance: number;
  pertesPuce: number;
  alimente: boolean;
  tensionEN: number | undefined;
  seuilsEN: [number, number];
}

export interface OptionsCalcul {
  /**
   * Calcul « au démarrage » : on ignore les états réglés à la main (attribut etats) et chaque
   * broche de microcontrôleur prend son état d'après le reset, tiré de sa fiche.
   */
  demarrage?: boolean;
}

export function calculer(montage: Montage, catalogue: Catalogue, options: OptionsCalcul = {}): Calcul {
  const reseau = construireReseau(montage, catalogue, { filsSepares: true, contactsSepares: true });
  const avertissements = new Set<string>();
  const pieces = piecesElectriques(montage, catalogue);

  const noeud = (chemin: string, fiche: Fiche, broche: string | undefined): number | undefined => {
    if (broche === undefined) return undefined;
    const nom = trouverBroche(fiche, broche)?.nom ?? broche;
    return reseau.noeudDe(`${chemin}:${nom}`)?.id;
  };

  // États des broches de microcontrôleur réglés à la main, ramenés aux broches de la puce.
  const etats = new Map<string, EtatBroche>();
  for (const p of options.demarrage ? [] : montage.pieces) {
    for (const [nom, etat] of Object.entries(p.etats)) {
      const b = trouverBroche(p.fiche, nom);
      if (!b) continue;
      etats.set(`${p.id}:${b.nom}`, etat);
      if (b.vers) {
        const [ref, cible] = b.vers.split('.') as [string, string];
        const sous = p.fiche.sous_composants?.find((s) => s.ref === ref);
        const sousFiche = sous && catalogue.fiche(sous.fiche);
        const nomCible = (sousFiche && trouverBroche(sousFiche, cible)?.nom) ?? cible;
        etats.set(`${p.id}/${ref}:${nomCible}`, etat);
      }
    }
  }

  // Éléments fixes (qui ne dépendent pas de l'état des drivers).
  const fixes: Element[] = [];
  const etiquettesFixes: Etiquette[] = [];
  let nbNoeuds = reseau.noeuds.length;
  const ajouter = (e: Element, et: Etiquette): void => {
    fixes.push(e);
    etiquettesFixes.push(et);
  };
  const resistance = (a: number | undefined, b: number | undefined, r: number | undefined, et: Etiquette): void => {
    if (a === undefined || b === undefined || a === b || r === undefined) return;
    if (!(r > 0)) {
      avertissements.add(`${et.piece} : résistance nulle ou négative (${r} Ω) ignorée`);
      return;
    }
    ajouter({ type: 'resistance', a, b, r }, et);
  };

  // Fils.
  const filDupont = catalogue.fiche('fil-dupont');
  const rFil = filDupont && grandeurModele(filDupont, 'resistance');
  for (const f of reseau.fils) {
    const c = montage.connexions[f.connexion]!;
    const et: Etiquette = { piece: c.de.piece, role: 'fil', broches: [c.de.broche], connexion: f.connexion };
    if (f.noeuds[0] === f.noeuds[1]) continue;
    resistance(f.noeuds[0], f.noeuds[1], valeurSI(rFil), et);
  }
  if (!rFil) avertissements.add('fiche fil-dupont absente : fils non simulés');

  // Contacts de la breadboard : ampèremètres parfaits (source de 0 V), du trou vers la broche.
  // Deux contacts qui se referment l'un sur l'autre sans rien entre eux formeraient une boucle de
  // sources : on garde le premier, le partage du courant entre eux n'est pas calculé.
  const parentContact = new Map<number, number>();
  const racineContact = (n: number): number => {
    let r = n;
    while (parentContact.has(r) && parentContact.get(r) !== r) r = parentContact.get(r)!;
    return r;
  };
  for (const ct of reseau.contacts) {
    const c = montage.connexions[ct.connexion]!;
    const breadboardDe = montage.pieces.find((p) => p.id === c.de.piece)?.fiche.modele?.type === 'breadboard';
    const [trou, broche] = breadboardDe ? [ct.noeuds[0], ct.noeuds[1]] : [ct.noeuds[1], ct.noeuds[0]];
    const ext = breadboardDe ? c.de : c.vers;
    const ra = racineContact(trou);
    const rb = racineContact(broche);
    if (ra === rb) {
      avertissements.add(`contact ${ext.piece}:${ext.broche} en parallèle sur un autre contact : partage du courant non calculé`);
      continue;
    }
    parentContact.set(rb, ra);
    fixes.push({ type: 'source', plus: trou, moins: broche, v: 0, absorbe: true });
    etiquettesFixes.push({ piece: ext.piece, role: 'contact', broches: [ext.broche], connexion: ct.connexion });
  }

  // Liaisons internes des modules et cartes.
  for (const l of reseau.elements) {
    const et: Etiquette = { piece: l.piece, role: 'liaison', broches: l.entre.map((p) => p.slice(p.indexOf(':') + 1)) };
    if (l.type === 'resistance') resistance(l.noeuds[0], l.noeuds[1], valeurSI(l.valeur), et);
    else if (l.type === 'diode') avertissements.add(`${l.piece} : liaison interne de type diode non simulée`);
  }

  const drivers: Driver[] = [];
  const references: number[] = [];

  for (const pe of pieces) {
    const { chemin, fiche } = pe;
    const n = (broche: string | undefined): number | undefined => noeud(chemin, fiche, broche);
    const valeurs = fiche.modele?.valeurs ?? {};

    // Référence du calcul : la masse d'une source d'abord.
    for (const b of fiche.broches) {
      if (b.role !== 'masse') continue;
      const id = n(b.nom);
      if (id !== undefined) (fiche.categorie === 'source' ? references.unshift(id) : references.push(id));
    }

    // Modèles de broches : entrées, tirages, sorties, diodes de protection.
    const micro = fiche.modele?.type === 'microcontroleur';
    const diodeDefaut = lireDiode(valeurs['diodes_protection'] as ModeleDiode | undefined);
    const tirageDefaut = grandeurModele(fiche, 'resistance_tirage');
    for (const b of fiche.broches) {
      const id = n(b.nom);
      if (id === undefined) continue;
      const entree = b['entree'] as EntreeBroche | undefined;
      const sortie = b['sortie'] as SortieBroche | undefined;
      const alim = n(b.domaine?.alim);
      const masse = n(b.domaine?.masse);
      const versDomaine = (cote: 'alim' | 'masse'): number | undefined => (cote === 'alim' ? alim : masse);

      if (entree?.resistance) resistance(id, masse, valeurSI(entree.resistance), { piece: chemin, role: 'resistance_entree', broches: [b.nom] });

      if (micro && (entree || sortie)) {
        let etat = etats.get(`${chemin}:${b.nom}`) ?? etatDemarrage(b);
        const capacites = b['capacites'] as { sortie?: boolean } | undefined;
        if ((etat === 'sortie_haute' || etat === 'sortie_basse') && capacites?.sortie === false) {
          avertissements.add(`${chemin}:${b.nom} ne peut pas être une sortie : vue comme une entrée`);
          etat = 'entree';
        }
        if (etat === 'entree_tirage_haut' || etat === 'entree_tirage_bas') {
          const r = valeurSI(entree?.tirage?.resistance ?? tirageDefaut);
          if (r === undefined) avertissements.add(`${chemin}:${b.nom} : résistance de tirage inconnue, tirage non simulé`);
          resistance(id, etat === 'entree_tirage_haut' ? alim : masse, r, { piece: chemin, role: 'tirage', broches: [b.nom] });
        } else if (etat === 'sortie_haute' || etat === 'sortie_basse') {
          const r = valeurSI(sortie?.resistance_sortie);
          if (r === undefined) avertissements.add(`${chemin}:${b.nom} : résistance de sortie inconnue, sortie non simulée`);
          resistance(id, etat === 'sortie_haute' ? alim : masse, r, { piece: chemin, role: 'sortie', broches: [b.nom] });
        }
      } else if (entree?.tirage) {
        resistance(id, versDomaine(entree.tirage.vers), valeurSI(entree.tirage.resistance), { piece: chemin, role: 'tirage', broches: [b.nom] });
      }

      const dp = entree?.diodes_protection;
      if (dp) {
        const d = lireDiode(dp.diode) ?? diodeDefaut;
        if (!d) avertissements.add(`${fiche.id} : diodes de protection sans modèle, non simulées`);
        else {
          const et: Etiquette = { piece: chemin, role: 'diode_protection', broches: [b.nom] };
          if (dp.vers_alim && alim !== undefined && alim !== id) {
            fixes.push({ type: 'diode', anode: id, cathode: alim, ...d });
            etiquettesFixes.push({ ...et, broches: [b.nom, b.domaine?.alim ?? ''] });
          }
          if (dp.vers_masse && masse !== undefined && masse !== id) {
            fixes.push({ type: 'diode', anode: masse, cathode: id, ...d });
            etiquettesFixes.push({ ...et, broches: [b.nom, b.domaine?.masse ?? ''] });
          }
        }
      }
    }

    // Modèle de la pièce.
    const [b0, b1] = fiche.broches;
    switch (fiche.modele?.type) {
      case 'resistance':
        // Les résistances de mesure d'un module (sous-composants) n'ont pas de renvoi : pas créées.
        if (b0 && b1) resistance(n(b0.nom), n(b1.nom), parametreSI(pe, 'value'), { piece: chemin, role: 'resistance', broches: [b0.nom, b1.nom] });
        break;
      case 'moteur_pas_a_pas': {
        const bobines = valeurs['bobines'] as { lignes: string[][] } | undefined;
        const r = valeurSI(grandeurModele(fiche, 'resistance_phase'));
        for (const [, debut, fin] of bobines?.lignes ?? []) {
          resistance(n(debut), n(fin), r, { piece: chemin, role: 'bobine', broches: [debut ?? '', fin ?? ''] });
        }
        break;
      }
      case 'alim_laboratoire': {
        const plus = n('+');
        const moins = n('-');
        const v = parametreSI(pe, 'tension');
        if (plus === undefined || moins === undefined || v === undefined) break;
        const absorbe = (valeurs['absorbe_courant'] as { valeur?: unknown } | undefined)?.valeur === true;
        const limite = parametreSI(pe, 'limite_courant');
        fixes.push({ type: 'source', plus, moins, v, absorbe, ...(limite !== undefined ? { limite } : {}) });
        etiquettesFixes.push({ piece: chemin, role: 'source', broches: ['+', '-'] });
        break;
      }
      case 'batterie': {
        const plus = n('+');
        const moins = n('-');
        const vElement = parametreSI(pe, 'tension_element');
        const nb = Math.round((valeurSI(grandeurModele(fiche, 'tension_batterie')) ?? NaN) / (valeurSI(grandeurModele(fiche, 'tension_element')) ?? NaN));
        const r = valeurSI(grandeurModele(fiche, 'resistance_interne'));
        if (plus === undefined || moins === undefined || vElement === undefined || !Number.isFinite(nb) || r === undefined) {
          avertissements.add(`${chemin} : batterie incomplète dans sa fiche, non simulée`);
          break;
        }
        const interne = nbNoeuds++;
        fixes.push({ type: 'source', plus: interne, moins, v: nb * vElement, absorbe: true });
        etiquettesFixes.push({ piece: chemin, role: 'source', broches: ['+', '-'] });
        resistance(interne, plus, r, { piece: chemin, role: 'resistance_interne', broches: ['+'] });
        break;
      }
      case 'microcontroleur': {
        // Carte qui porte une puce : régulateur 3,3 V (USB) et consommation de la carte.
        // Si la fiche nomme sa broche 5 V (broche_usb, Raspberry Pi 5), l'USB y met aussi sa
        // tension (tension_usb) et la consommation est prise sur ce 5 V ; sinon, sur le 3,3 V.
        if (!fiche.sous_composants?.some((s) => catalogue.fiche(s.fiche)?.modele?.type === 'microcontroleur')) break;
        const sortie3v3 = fiche.broches.find((b) => b.role === 'alim_sortie');
        const a = n(sortie3v3?.nom);
        const m = n(sortie3v3?.domaine?.masse);
        const v = valeurSI(grandeurModele(fiche, 'tension_3v3'));
        if (a === undefined || m === undefined || v === undefined) break;
        const nomUsb = (valeurs['broche_usb'] as { valeur?: unknown } | undefined)?.valeur;
        const brocheUsb = typeof nomUsb === 'string' ? trouverBroche(fiche, nomUsb) : undefined;
        const a5 = n(brocheUsb?.nom);
        const m5 = n(brocheUsb?.domaine?.masse);
        const v5 = valeurSI(grandeurModele(fiche, 'tension_usb'));
        const usb = brocheUsb && a5 !== undefined && m5 !== undefined && v5 !== undefined ? { a: a5, m: m5, v: v5, broches: [brocheUsb.nom, brocheUsb.domaine!.masse] } : undefined;
        if (pe.parametres['alimentation_usb'] === true) {
          fixes.push({ type: 'source', plus: a, moins: m, v, absorbe: false });
          etiquettesFixes.push({ piece: chemin, role: 'regulateur', broches: [sortie3v3!.nom, sortie3v3!.domaine!.masse] });
          if (usb) {
            fixes.push({ type: 'source', plus: usb.a, moins: usb.m, v: usb.v, absorbe: false });
            etiquettesFixes.push({ piece: chemin, role: 'alimentation_usb', broches: usb.broches });
          }
        }
        const conso = parametreSI(pe, 'consommation');
        if (conso !== undefined && conso > 0) {
          if (usb) resistance(usb.a, usb.m, usb.v / conso, { piece: chemin, role: 'consommation', broches: usb.broches });
          else resistance(a, m, v / conso, { piece: chemin, role: 'consommation', broches: [sortie3v3!.nom, sortie3v3!.domaine!.masse] });
        }
        break;
      }
      case 'driver_pas_a_pas': {
        // Module : sa puce porte le pont, le module ajoute résistances de mesure et VREF.
        const puce = pieces.find((x) => x.chemin.startsWith(`${chemin}/`) && x.chemin.split('/').length === chemin.split('/').length + 1 && x.fiche.modele?.type === 'driver_pas_a_pas');
        if (!puce) break;
        const pf = puce.fiche;
        const np = (b: string): number | undefined => noeud(puce.chemin, pf, b);
        const ids = ['VS', 'GND', 'VCC_IO', 'ENN', 'VREF', 'OA1', 'OA2', 'OB1', 'OB2'].map(np);
        const g = (nom: string, ordre?: ('typ' | 'min' | 'max')[]): number | undefined => valeurSI(grandeurModele(pf, nom), ordre);
        const enn = trouverBroche(pf, 'ENN')?.['niveaux'] as { vil_max?: Grandeur; vih_min?: Grandeur } | undefined;
        const champs = {
          vref: parametreSI(pe, 'vref'),
          rMesure: valeurSI(grandeurModele(fiche, 'resistance_mesure')),
          rInterne: g('resistance_interne_br'),
          vPleineEchelle: g('tension_pleine_echelle'),
          vrefPleineEchelle: g('tension_vref_pleine_echelle'),
          rdsHaut: g('rdson_haut'),
          rdsBas: g('rdson_bas'),
          reposActif: g('courant_vs_fonctionnement'),
          reposInactif: g('courant_vs_desactive'),
          sousTensionVS: g('seuil_sous_tension_vs'),
          sousTensionIO: g('seuil_sous_tension_vcc_io'),
          seuilBas: enn?.vil_max?.max,
          seuilHaut: enn?.vih_min?.min,
        };
        const manque = Object.entries(champs).filter(([, v]) => v === undefined).map(([k]) => k);
        if (manque.length > 0 || ids.some((x) => x === undefined)) {
          avertissements.add(`${chemin} : driver non simulé, il manque ${manque.join(', ') || 'des broches'}`);
          break;
        }
        const [vs, gnd, vio, ennId, vrefId, oa1, oa2, ob1, ob2] = ids as number[];
        const diodePont = lireDiode(valeurs['diodes_pont_modele'] as ModeleDiode | undefined) ?? lireDiode(pf.modele?.valeurs['diodes_pont_modele'] as ModeleDiode | undefined);
        const courantUart = parametreSI(pe, 'courant_uart');
        drivers.push({
          piece: chemin,
          puce,
          n: { vs: vs!, gnd: gnd!, vio: vio!, enn: ennId!, vref: vrefId!, sorties: [oa1!, oa2!, ob1!, ob2!] },
          ...(champs as { [K in keyof typeof champs]: number }),
          ...(diodePont ? { diodePont } : {}),
          ...(courantUart !== undefined ? { courantUart } : {}),
        });
        if (!diodePont) avertissements.add(`${chemin} : diodes du pont sans modèle, non simulées`);
        break;
      }
    }
  }

  // Éléments des drivers, qui dépendent de leur état (actif ou non, puissance prise sur VS).
  const elementsDrivers = (etatsDrivers: EtatCalculDriver[]): { elements: Element[]; etiquettes: Etiquette[] } => {
    const elements: Element[] = [];
    const etiquettes: Etiquette[] = [];
    drivers.forEach((d, i) => {
      const e = etatsDrivers[i]!;
      const puce = d.puce.chemin;
      const [oa1, oa2, ob1, ob2] = d.n.sorties;
      const noms = ['OA1', 'OA2', 'OB1', 'OB2'];
      if (d.diodePont) {
        d.n.sorties.forEach((s, k) => {
          elements.push({ type: 'diode', anode: d.n.gnd, cathode: s, ...d.diodePont! });
          etiquettes.push({ piece: puce, role: 'diode_pont', broches: ['GND', noms[k]!] });
          elements.push({ type: 'diode', anode: s, cathode: d.n.vs, ...d.diodePont! });
          etiquettes.push({ piece: puce, role: 'diode_pont', broches: [noms[k]!, 'VS'] });
        });
      }
      elements.push({ type: 'source', plus: d.n.vref, moins: d.n.gnd, v: d.vref, absorbe: true });
      etiquettes.push({ piece: d.piece, role: 'potentiometre', broches: ['VREF'] });
      elements.push({
        type: 'charge',
        plus: d.n.vs,
        moins: d.n.gnd,
        p: e.actif ? e.puissance : 0,
        i0: e.actif ? d.reposActif : d.reposInactif,
        vmin: d.sousTensionVS,
      });
      etiquettes.push({ piece: puce, role: 'alimentation_driver', broches: ['VS', 'GND'] });
      if (e.actif && e.courant > 0) {
        for (const [o1, o2, n1, n2] of [
          [oa1, oa2, 'OA1', 'OA2'],
          [ob1, ob2, 'OB1', 'OB2'],
        ] as const) {
          elements.push({ type: 'source', plus: o1, moins: d.n.gnd, v: e.compliance, limite: e.courant, absorbe: false });
          etiquettes.push({ piece: puce, role: 'pont', broches: [n1, n2] });
          elements.push({ type: 'resistance', a: o2, b: d.n.gnd, r: d.rdsBas + d.rMesure });
          etiquettes.push({ piece: puce, role: 'pont_retour', broches: [n2, 'GND'] });
        }
      }
    });
    return { elements, etiquettes };
  };

  /** État de chaque driver d'après une solution : alimentation, niveau de EN, courant, puissance. */
  const lireDrivers = (sol: Solution, elements: Element[], etiquettes: Etiquette[]): EtatCalculDriver[] =>
    drivers.map((d) => {
      const v = (a: number): number | undefined => {
        const va = sol.tensions[a];
        const vg = sol.tensions[d.n.gnd];
        return va === undefined || vg === undefined || sol.parties[a] !== sol.parties[d.n.gnd] ? undefined : va - vg;
      };
      const vs = v(d.n.vs) ?? 0;
      const vio = v(d.n.vio) ?? 0;
      const enn = v(d.n.enn);
      const vref = Math.min(Math.max(v(d.n.vref) ?? 0, 0), d.vrefPleineEchelle);
      // Pleine échelle (p. 53) ; VREF la réduit, sauf si le programme règle le courant par l'UART.
      const pleineEchelle = (d.vPleineEchelle / (d.rMesure + d.rInterne)) * Math.SQRT1_2;
      const courant = d.courantUart !== undefined ? Math.min(d.courantUart, pleineEchelle) : pleineEchelle * (vref / d.vrefPleineEchelle);
      const seuilsEN: [number, number] = [d.seuilBas * vio, d.seuilHaut * vio];
      let actif = true;
      let indetermine = false;
      let raison = 'actif : EN au niveau bas';
      if (vs < d.sousTensionVS) [actif, raison] = [false, `VS à ${vs.toFixed(2)} V, sous le seuil de ${d.sousTensionVS} V`];
      else if (vio < d.sousTensionIO) [actif, raison] = [false, `VCC_IO à ${vio.toFixed(2)} V, sous le seuil de ${d.sousTensionIO} V`];
      else if (enn === undefined) [actif, raison] = [false, 'EN sans tension définie'];
      else if (enn > d.seuilHaut * vio) [actif, raison] = [false, `EN à ${enn.toFixed(2)} V, au niveau haut : driver coupé`];
      else if (enn > d.seuilBas * vio) {
        indetermine = true;
        raison = `EN à ${enn.toFixed(2)} V, entre les seuils ${(d.seuilBas * vio).toFixed(2)} et ${(d.seuilHaut * vio).toFixed(2)} V : état incertain, compté actif`;
      }
      let puissance = 0;
      let pertesPont = 0;
      elements.forEach((e, k) => {
        const et = etiquettes[k]!;
        if (e.type !== 'source' || et.role !== 'pont' || et.piece !== d.puce.chemin) return;
        const i = sol.courants[k]!;
        puissance += i * sol.tensionsElements[k]! + d.rdsHaut * i * i;
        pertesPont += (d.rdsHaut + d.rdsBas) * i * i;
      });
      const alimente = vs >= d.sousTensionVS && vio >= d.sousTensionIO;
      const pertesPuce = pertesPont + (vs > 0 ? vs * (actif ? d.reposActif : d.reposInactif) : 0);
      return { actif, indetermine, raison, courant: actif ? courant : 0, compliance: Math.max(vs, 0), puissance, pertesPuce, alimente, tensionEN: enn, seuilsEN };
    });

  // Boucle : on calcule, on relit l'état des drivers, on recommence jusqu'à ce qu'il ne change plus.
  let etatsDrivers: EtatCalculDriver[] = drivers.map(() => ({
    actif: false,
    indetermine: false,
    raison: '',
    courant: 0,
    compliance: 0,
    puissance: 0,
    pertesPuce: 0,
    alimente: false,
    tensionEN: undefined,
    seuilsEN: [0, 0],
  }));
  let elements: Element[] = fixes;
  let etiquettes: Etiquette[] = etiquettesFixes;
  let solution: Solution | undefined;
  let message: string | undefined;
  let stable = false;
  for (let passe = 1; passe <= 30 && !stable; passe++) {
    const variables = elementsDrivers(etatsDrivers);
    elements = [...fixes, ...variables.elements];
    etiquettes = [...etiquettesFixes, ...variables.etiquettes];
    solution = resoudre(nbNoeuds, elements, { references, ...(solution?.converge ? { depart: { tensions: solution.tensions } } : {}) });
    if (!solution.converge) break;
    const nouveaux = lireDrivers(solution, elements, etiquettes);
    // La puissance lue n'est juste qu'avec les sources de bobine en place : on la reprend tant qu'elle bouge.
    stable = nouveaux.every((n, i) => {
      const a = etatsDrivers[i]!;
      const proche = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x));
      return n.actif === a.actif && proche(n.courant, a.courant) && proche(n.compliance, a.compliance) && proche(n.puissance, a.puissance);
    });
    etatsDrivers = nouveaux;
    if (!stable && passe === 30) message = 'les drivers changent d\'état à chaque calcul (coupure et redémarrage ?)';
  }
  const sol = solution!;
  if (!sol.converge) message = sol.message;

  const tension = (point: string): number | undefined => {
    const nd = reseau.noeudDe(point);
    return nd ? sol.tensions[nd.id] : undefined;
  };
  const difference = (a: string, b: string): number | undefined => {
    const na = reseau.noeudDe(a);
    const nb = reseau.noeudDe(b);
    if (!na || !nb || sol.parties[na.id] !== sol.parties[nb.id]) return undefined;
    const va = sol.tensions[na.id];
    const vb = sol.tensions[nb.id];
    return va === undefined || vb === undefined ? undefined : va - vb;
  };
  const courantFil = (connexion: number): number | undefined => {
    const k = etiquettes.findIndex((e) => (e.role === 'fil' || e.role === 'contact') && e.connexion === connexion);
    if (k >= 0) {
      const i = sol.courants[k]!;
      if (etiquettes[k]!.role === 'fil') return i;
      // Contact : la source de 0 V compte le courant de la broche vers le trou.
      const c = montage.connexions[connexion]!;
      const deEstLaBroche = etiquettes[k]!.piece === c.vers.piece && etiquettes[k]!.broches[0] === c.vers.broche;
      return deEstLaBroche ? i : -i;
    }
    // Fil dont les deux bouts sont sur le même nœud : aucun courant ne le traverse.
    return reseau.fils.some((f) => f.connexion === connexion) ? 0 : undefined;
  };
  const sources = elements.flatMap((e, k) => {
    const et = etiquettes[k]!;
    if (e.type !== 'source' || (et.role !== 'source' && et.role !== 'regulateur' && et.role !== 'alimentation_usb')) return [];
    return [{ piece: et.piece, regime: sol.regimes[k]!, tension: sol.tensionsElements[k]!, courant: sol.courants[k]! }];
  });

  return {
    converge: sol.converge && message === undefined,
    ...(message !== undefined ? { message } : {}),
    reseau,
    elements,
    etiquettes,
    solution: sol,
    tension,
    difference,
    courantFil,
    fiches: new Map(pieces.map((p) => [p.chemin, p.fiche])),
    sources,
    drivers: drivers.map((d, i) => {
      const e = etatsDrivers[i]!;
      return {
        piece: d.piece,
        actif: e.actif,
        indetermine: e.indetermine,
        raison: e.raison,
        courantBobine: e.courant,
        puissance: e.puissance,
        pertesPuce: e.pertesPuce,
        alimente: e.alimente,
        tensionEN: e.tensionEN,
        seuilsEN: e.seuilsEN,
        parUart: d.courantUart !== undefined,
      };
    }),
    avertissements: [...avertissements],
  };
}
