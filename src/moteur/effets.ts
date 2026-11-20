// Effets visibles sous tension : un moteur qui tourne, une LED qui s'allume.
//
// Moteur pas à pas : il tourne si son driver est actif et si la broche STEP du driver reçoit des
// impulsions (état « impulsions » d'une broche de microcontrôleur, réglé à la main). Vitesse =
// fréquence des impulsions / (micro-pas × pas par tour). Micro-pas : MS1 et MS2, ou le réglage
// du programme quand l'UART est utilisée. Sens : niveau de DIR.
//
// Couple et vitesse maximale, d'après la datasheet du TMC2209 :
// - constante de force contre-électromotrice C = couple de maintien / (2 × courant nominal) (p. 44),
//   même valeur numérique que la constante de couple ;
// - tension efficace que le driver peut mettre sur une bobine : VS × 255 / 374 (p. 43) ;
// - la f.c.é.m. C·ω « se retranche de la tension d'alim » (p. 43), et l'inductance ajoute
//   L·ωe·I, avec ωe = ω × pas par tour / 4 (4 pas complets par période électrique, p. 16).
// Tant que √((R·I + C·ω)² + (L·ωe·I)²) reste sous la tension disponible, le driver tient son
// courant ; au-delà, le courant et le couple baissent. C'est une première approximation.
import type { Calcul } from './circuit';
import { borne, brocheDe, canon, formater, type Contexte, type NouveauConstat } from './constats';
import { grandeurModele, trouverBroche, valeurSI, type Fiche } from './fiche';
import { FREQUENCE_DEFAUT, type Piece } from './montage';
import { niveau, puceDe, uartUtilisee } from './regles';

export interface EffetMoteur {
  type: 'moteur';
  /** Pièce du moteur. */
  piece: string;
  /** Module driver relié aux bobines. */
  driver?: string;
  tourne: boolean;
  /** Pourquoi il tourne, ou pourquoi il ne tourne pas, en une phrase. */
  raison: string;
  /** Point qui envoie les impulsions STEP ("esp:32") et leur fréquence (Hz). */
  source?: string;
  frequence?: number;
  microPas?: number;
  /** Micro-pas choisis par MS1/MS2 ou par le programme (UART). */
  reglageMicroPas?: 'MS1/MS2' | 'UART';
  pasParTour?: number;
  /** Tours par seconde, signés selon DIR (+ : DIR à 0). Indéfini si les micro-pas sont inconnus. */
  toursParSeconde?: number;
  /** +1, -1, ou indéfini si DIR est entre ses deux seuils. */
  sens?: 1 | -1;
  /** Courant efficace réglé dans chaque bobine, et celui que le driver tient à cette vitesse (A). */
  courant?: number;
  courantEffectif?: number;
  /** Couple à l'arrêt au courant réglé, et à la vitesse demandée (N·m). */
  coupleArret?: number;
  couple?: number;
  /** Vitesse au-delà de laquelle le driver ne tient plus le courant réglé (tr/s). */
  vitesseMax?: number;
  /** Roue montée sur l'axe : diamètre (m) et vitesse au sol (m/s, signée). */
  roue?: { diametre: number; vitesse: number };
}

export interface EffetLed {
  type: 'led';
  piece: string;
  /** Courant direct (A), négatif si la LED est polarisée en inverse. */
  courant: number;
  /** Éclat affiché, de 0 (éteinte) à 1 (courant de la courbe la plus haute de la datasheet). */
  eclat: number;
  /** Intensité lumineuse estimée (mcd). */
  intensite?: number;
  raison: string;
}

export type Effet = EffetMoteur | EffetLed;

const BOBINES = ['A+', 'A-', 'B+', 'B-'];

/** Valeur numérique d'un paramètre de pièce (sans conversion d'unité). */
function parametre(piece: Piece | undefined, nom: string): number | undefined {
  const v = piece?.parametres[nom];
  return typeof v === 'number' ? v : undefined;
}

/** Racine positive de a·x² + b·x + c = 0, ou undefined. */
function racine(a: number, b: number, c: number): number | undefined {
  const d = b * b - 4 * a * c;
  if (a <= 0 || d < 0) return undefined;
  return (-b + Math.sqrt(d)) / (2 * a);
}

interface Bobine {
  r: number;
  l: number;
  c: number;
  pas: number;
  u: number;
}

/** Vitesse (rad/s) au-delà de laquelle la tension disponible ne suffit plus pour le courant i. */
function vitesseLimite(b: Bobine, i: number): number {
  const k = b.l * (b.pas / 4) * i;
  const x = racine(b.c * b.c + k * k, 2 * b.c * b.r * i, (b.r * i) ** 2 - b.u * b.u);
  return Math.max(x ?? 0, 0);
}

/** Courant que le driver tient à la vitesse w (rad/s), sans dépasser la consigne i. */
function courantTenu(b: Bobine, i: number, w: number): number {
  const x = b.l * (b.pas / 4) * w;
  const tenu = racine(b.r * b.r + x * x, 2 * b.r * b.c * w, (b.c * w) ** 2 - b.u * b.u);
  return Math.min(i, Math.max(tenu ?? 0, 0));
}

/** Broche de microcontrôleur qui envoie des impulsions sur ce nœud, s'il y en a une. */
function impulsionsSur(ctx: Contexte, point: string): { source: string; frequence: number } | { refus: string } | undefined {
  const noeud = ctx.grossier.noeudDe(point);
  for (const p of noeud?.points ?? []) {
    const info = brocheDe(p, ctx.calcul.fiches);
    if (!info || info.chemin.includes('/')) continue;
    const piece = ctx.montage.pieces.find((x) => x.id === info.chemin);
    if (piece?.etats[info.broche.nom] !== 'impulsions') continue;
    // Une broche « entrée seule » (IO34 à IO39 de l'ESP32) ne peut pas envoyer d'impulsions.
    let capacites = info.broche['capacites'] as { sortie?: boolean } | undefined;
    if (info.broche.vers) {
      const [ref, cible] = info.broche.vers.split('.') as [string, string];
      const sous = info.fiche.sous_composants?.find((s) => s.ref === ref);
      const puce = sous && ctx.catalogue.fiche(sous.fiche);
      capacites = (puce && (trouverBroche(puce, cible)?.['capacites'] as { sortie?: boolean } | undefined)) ?? capacites;
    }
    if (capacites?.sortie === false) return { refus: `${p} est réglée sur « impulsions », mais c'est une entrée seule : elle ne peut rien envoyer.` };
    return { source: p, frequence: piece.frequences[info.broche.nom] ?? FREQUENCE_DEFAUT };
  }
  return undefined;
}

function effetMoteur(ctx: Contexte, moteur: Piece): EffetMoteur {
  const { calcul, montage } = ctx;
  const base = { type: 'moteur' as const, piece: moteur.id, tourne: false };
  // Driver relié aux bobines : un module dont une broche est sur le même nœud qu'une bobine.
  let driver: string | undefined;
  for (const nom of BOBINES) {
    for (const p of ctx.grossier.noeudDe(`${moteur.id}:${nom}`)?.points ?? []) {
      const info = brocheDe(p, calcul.fiches);
      if (info && !info.chemin.includes('/') && info.fiche.modele?.type === 'driver_pas_a_pas') driver = info.chemin;
    }
  }
  if (!driver) return { ...base, raison: 'Ses bobines ne sont reliées à aucun driver.' };
  const module = montage.pieces.find((p) => p.id === driver)!;
  const puce = puceDe(calcul, driver);
  const etat = calcul.drivers.find((d) => d.piece === driver);
  if (!puce || !etat) return { ...base, driver, raison: `${driver} n'est pas simulé.` };
  if (!etat.alimente || !etat.actif) return { ...base, driver, raison: `${driver} est coupé : ${etat.raison}` };

  const step = impulsionsSur(ctx, `${driver}:${canon(module.fiche, 'STEP')}`);
  if (!step) return { ...base, driver, raison: `STEP de ${driver} ne reçoit pas d'impulsions : régler la broche qui le commande sur « impulsions ».` };
  if ('refus' in step) return { ...base, driver, raison: step.refus };

  // Micro-pas : le programme (UART) ou les broches MS1 et MS2.
  let microPas: number | undefined;
  let reglageMicroPas: 'MS1/MS2' | 'UART';
  let doute = '';
  if (uartUtilisee(ctx, driver, module.fiche)) {
    reglageMicroPas = 'UART';
    microPas = parametre(module, 'micro_pas_uart');
  } else {
    reglageMicroPas = 'MS1/MS2';
    const ms1 = niveau(calcul, puce.chemin, puce.fiche, 'MS1_AD0');
    const ms2 = niveau(calcul, puce.chemin, puce.fiche, 'MS2_AD1');
    const table = puce.fiche.modele?.valeurs['micro_pas'] as { lignes: number[][] } | undefined;
    microPas = ms1 === undefined || ms2 === undefined ? undefined : table?.lignes.find((l) => l[0] === ms2 && l[1] === ms1)?.[2];
    if (microPas === undefined) doute = ' MS1 ou MS2 est entre ses deux seuils : micro-pas inconnus, vitesse inconnue.';
  }
  const dir = niveau(calcul, puce.chemin, puce.fiche, 'DIR');
  const sens = dir === undefined ? undefined : dir === 0 ? 1 : -1;
  if (sens === undefined) doute += ' DIR est entre ses deux seuils : sens inconnu.';

  const pasParTour = valeurSI(grandeurModele(moteur.fiche, 'pas_par_tour')) ?? 200;
  const toursParSeconde = microPas ? (step.frequence / (microPas * pasParTour)) * (sens ?? 1) : undefined;

  // Couple et vitesse maximale (voir l'en-tête).
  const g = (f: Fiche, nom: string, ordre?: ('typ' | 'min' | 'max')[]) => valeurSI(grandeurModele(f, nom), ordre);
  const coupleMaintien = g(moteur.fiche, 'couple_maintien');
  const courantNominal = g(moteur.fiche, 'courant_nominal_phase', ['max', 'typ']);
  const vs = calcul.difference(`${puce.chemin}:VS`, `${puce.chemin}:GND`);
  const rPhase = g(moteur.fiche, 'resistance_phase');
  const lPhase = g(moteur.fiche, 'inductance_phase');
  const courant = etat.courantBobine;
  const resultat: EffetMoteur = {
    ...base,
    driver,
    tourne: true,
    raison: `${step.source} envoie ${Math.round(step.frequence)} impulsions par seconde sur STEP de ${driver}.${doute}`,
    source: step.source,
    frequence: step.frequence,
    ...(microPas !== undefined ? { microPas } : {}),
    reglageMicroPas,
    pasParTour,
    ...(toursParSeconde !== undefined ? { toursParSeconde } : {}),
    ...(sens !== undefined ? { sens } : {}),
    courant,
  };
  if (coupleMaintien !== undefined && courantNominal !== undefined && vs !== undefined && rPhase !== undefined && lPhase !== undefined) {
    const kt = coupleMaintien / courantNominal;
    const bobine: Bobine = {
      r: rPhase + (g(puce.fiche, 'rdson_haut') ?? 0) + (g(puce.fiche, 'rdson_bas') ?? 0),
      l: lPhase,
      c: coupleMaintien / (2 * courantNominal),
      pas: pasParTour,
      u: (vs * 255) / 374,
    };
    resultat.coupleArret = kt * courant;
    resultat.vitesseMax = vitesseLimite(bobine, courant) / (2 * Math.PI);
    if (toursParSeconde !== undefined) {
      const effectif = courantTenu(bobine, courant, Math.abs(toursParSeconde) * 2 * Math.PI);
      resultat.courantEffectif = effectif;
      resultat.couple = kt * effectif;
    }
  }
  const diametre = parametre(moteur, 'diametre_roue');
  if (diametre !== undefined && diametre > 0 && toursParSeconde !== undefined) {
    resultat.roue = { diametre: diametre / 1000, vitesse: Math.PI * (diametre / 1000) * toursParSeconde };
  }
  return resultat;
}

/** Éclat et intensité d'une LED, d'après le courant qui la traverse. */
function effetLed(calcul: Calcul, led: Piece): EffetLed {
  let courant = 0;
  calcul.etiquettes.forEach((et, k) => {
    if (et.piece === led.id && et.role === 'led') courant = calcul.solution.courants[k] ?? 0;
  });
  // Intensité proportionnelle au courant (courbe de la datasheet) : celle de la fiche au courant
  // de mesure, et l'éclat affiché plafonne au courant le plus haut de la courbe.
  const iv = borne(grandeurModele(led.fiche, 'intensite_lumineuse'), 'typ');
  const courantMesure = valeurSI(grandeurModele(led.fiche, 'courant_intensite'));
  const plafond = valeurSI(grandeurModele(led.fiche, 'courant_eclat_max')) ?? courantMesure ?? 0.02;
  const eclat = Math.max(0, Math.min(1, courant / plafond));
  const intensite = iv !== undefined && courantMesure !== undefined && courant > 0 ? iv * (courant / courantMesure) : undefined;
  const raison =
    courant > 1e-4
      ? `${formater(courant, 'A')} dans la LED${intensite !== undefined ? `, environ ${Math.round(intensite)} mcd` : ''}.`
      : courant < -1e-6
        ? 'Polarisée à l\'envers : elle reste éteinte.'
        : 'Pas assez de tension pour l\'allumer.';
  return { type: 'led', piece: led.id, courant, eclat, ...(intensite !== undefined ? { intensite } : {}), raison };
}

/** Effets de chaque moteur et de chaque LED du montage. */
export function calculerEffets(ctx: Contexte): Effet[] {
  return ctx.montage.pieces.flatMap((p): Effet[] => {
    const type = p.fiche.modele?.type;
    if (type === 'moteur_pas_a_pas') return [effetMoteur(ctx, p)];
    if (type === 'led') return [effetLed(ctx.calcul, p)];
    return [];
  });
}

/** Verdicts tirés des effets : un moteur dont la f.c.é.m. dépasse la tension disponible ne tourne pas. */
export function verifierEffets(ctx: Contexte, effets: Effet[]): NouveauConstat[] {
  return effets.flatMap((e): NouveauConstat[] => {
    if (e.type !== 'moteur' || !e.tourne || e.toursParSeconde === undefined || e.courantEffectif === undefined || e.vitesseMax === undefined) return [];
    if (e.courantEffectif > 0.05 * (e.courant ?? 0)) return [];
    const piece = ctx.montage.pieces.find((p) => p.id === e.piece)!;
    const trMin = Math.abs(e.toursParSeconde) * 60;
    return [
      {
        chemin: e.piece,
        fiche: piece.fiche,
        verdict: 'ne_marchera_pas',
        point: `${e.piece}:A+`,
        titre: `${e.piece} trop vite : ${Math.round(trMin)} tr/min demandés, au plus ${Math.round(e.vitesseMax * 60)} tr/min`,
        explication: `À cette vitesse, la tension que le moteur produit en tournant (force contre-électromotrice) et celle de ses bobines dépassent ce que ${e.driver} peut fournir : le courant tombe presque à zéro, le moteur décroche et ne suit plus les impulsions. Estimation au premier ordre (datasheet du TMC2209, p. 43-44), moteur à vide.`,
        correction: `Baisser la fréquence des impulsions de ${e.source}, augmenter les micro-pas, ou alimenter les moteurs plus haut (LiPo 4S).`,
        origine: 'calcul',
      },
    ];
  });
}

/** Phrase courte pour l'étiquette d'un moteur sur le plan. */
export function resumeMoteur(e: EffetMoteur): string {
  if (!e.tourne) return 'à l\'arrêt';
  if (e.toursParSeconde === undefined) return `${Math.round(e.frequence ?? 0)} Hz, vitesse inconnue`;
  const trMin = Math.round(Math.abs(e.toursParSeconde) * 60);
  const sens = e.sens === undefined ? '' : e.sens > 0 ? ' ↻' : ' ↺';
  const roue = e.roue ? ` · ${Math.abs(e.roue.vitesse).toFixed(2).replace('.', ',')} m/s` : '';
  return `${trMin} tr/min${sens}${roue}`;
}
