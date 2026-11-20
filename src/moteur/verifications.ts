// Étape 6 : du calcul aux verdicts. On compare chaque broche, chaque fil et chaque contact aux
// limites de sa fiche, on estime les températures, on vérifie que les masses sont communes, puis
// on applique les règles des fiches (regles.ts). Le tout donne une liste de constats, du plus
// grave au moins grave, et le pire verdict de chaque pièce.
//
// Rappels de CLAUDE.md :
// - « grillé » ne sort que d'un calcul : limite absolue dépassée ET courant assez fort pour détruire ;
//   sans donnée de courant, c'est « risque élevé » ;
// - dépasser un maximum absolu donne « grillé » ou « risque » ; sortir des conditions
//   recommandées donne « ne marchera pas ».
import type { Catalogue } from './catalogue';
import { calculer, type Calcul } from './circuit';
import {
  borne,
  canon,
  constat,
  formater,
  pointAffiche,
  brocheDe,
  TEMPERATURE_AMBIANTE,
  VERDICTS,
  type Constat,
  type Contexte,
  type NouveauConstat,
  type Verdict,
} from './constats';
import { grandeurModele, trouverBroche, versUniteDeBase, type Fiche, type Grandeur, type Source } from './fiche';
import type { Montage } from './montage';
import { calculerEffets, verifierEffets, type Effet } from './effets';
import { appliquerRegles } from './regles';
import { construireReseau } from './reseau';

export interface Rapport {
  converge: boolean;
  message?: string;
  /** Du plus grave au moins grave. */
  constats: Constat[];
  /** Pire verdict de chaque pièce du montage qui en a un. */
  parPiece: Map<string, Verdict>;
  /** Ce que le calcul n'a pas pu simuler : à afficher « non simulé ». */
  nonSimule: string[];
  calcul: Calcul;
  demarrage: Calcul;
  /** Effets visibles : moteurs qui tournent, LED allumées. */
  effets: Effet[];
}

interface Limites {
  tension?: Grandeur;
  courant?: Grandeur;
}

const TOLERANCE_V = 1e-6;

function sourceDe(fiche: Fiche, src: Source | undefined): { fiche: string; src: Source } | undefined {
  return src ? { fiche: fiche.id, src } : undefined;
}

/** Diodes de protection : courant d'injection, puis tension au-delà du maximum absolu. */
function verifierInjections(ctx: Contexte): NouveauConstat[] {
  const { calcul } = ctx;
  const sorties: NouveauConstat[] = [];
  const parBroche = new Map<string, { chemin: string; broche: string; courant: number }>();
  calcul.etiquettes.forEach((et, k) => {
    if (et.role !== 'diode_protection') return;
    const cle = `${et.piece}:${et.broches[0]}`;
    const i = calcul.solution.courants[k]!;
    const avant = parBroche.get(cle);
    if (!avant || i > avant.courant) parBroche.set(cle, { chemin: et.piece, broche: et.broches[0]!, courant: i });
  });
  for (const { chemin, broche, courant } of parBroche.values()) {
    const fiche = calcul.fiches.get(chemin)!;
    const b = trouverBroche(fiche, broche)!;
    const dp = (b['entree'] as { diodes_protection?: { courant_injection_max?: Grandeur } } | undefined)?.diodes_protection;
    const imax = borne(dp?.courant_injection_max, 'max');
    const point = `${chemin}:${b.nom}`;
    const affiche = pointAffiche(chemin, b.nom, calcul.fiches);
    if (imax !== undefined && courant > imax) {
      sorties.push({
        chemin,
        fiche,
        verdict: 'grille',
        point: affiche,
        titre: `${affiche} : ${formater(courant, 'A')} dans la diode de protection`,
        explication: `La broche est poussée au-delà de son alimentation ou sous sa masse : sa diode de protection conduit ${formater(courant, 'A')}, au-delà de ${formater(imax, 'A')}, le courant retenu pour la destruction.`,
        correction: 'Ne jamais relier une tension plus haute que l\'alimentation de la puce directement à la broche : passer par un pont diviseur ou une résistance série qui limite le courant à une fraction de milliampère.',
        ...(dp?.courant_injection_max ? { source: { fiche: fiche.id, src: dp.courant_injection_max.src } } : {}),
        origine: 'calcul',
      });
      continue;
    }
    const ma = (b['max_absolus'] as Limites | undefined)?.tension;
    const min = borne(ma, 'min');
    if (min === undefined) continue;
    const alim = canon(fiche, b.domaine?.alim);
    const masse = canon(fiche, b.domaine?.masse);
    const valim = alim ? calcul.difference(point, `${chemin}:${alim}`) : undefined;
    const vmasse = masse ? calcul.difference(point, `${chemin}:${masse}`) : undefined;
    // Maximum relatif : alim + |min| (VDD + 0,3 V pour l'ESP32, VCC_IO + 0,5 V pour le TMC2209).
    const depasse = valim !== undefined && valim > -min + TOLERANCE_V;
    const sous = vmasse !== undefined && vmasse < min - TOLERANCE_V;
    if (!depasse && !sous) continue;
    const detail = depasse
      ? `${formater(valim!, 'V')} au-dessus de ${alim}, au-delà du maximum de ${formater(-min, 'V')}`
      : `${formater(vmasse!, 'V')} par rapport à ${masse}, sous le minimum de ${formater(min, 'V')}`;
    sorties.push({
      chemin,
      fiche,
      verdict: 'risque',
      point: affiche,
      titre: `${affiche} au-delà de son maximum absolu`,
      explication: `La broche est à ${detail}. Sa diode de protection conduit ${formater(Math.max(courant, 0), 'A')} : moins que le seuil de destruction retenu, mais le fabricant ne garantit plus rien.`,
      correction: 'Ramener la tension de la broche entre la masse et l\'alimentation de la puce (pont diviseur, adaptateur de niveau).',
      ...(sourceDe(fiche, ma?.src) ? { source: sourceDe(fiche, ma?.src)! } : {}),
      origine: 'calcul',
    });
  }
  return sorties;
}

/** Maxima absolus en tension (broches sans diode de protection) et conditions recommandées. */
function verifierTensions(ctx: Contexte): NouveauConstat[] {
  const { calcul } = ctx;
  const sorties: NouveauConstat[] = [];
  for (const [chemin, fiche] of calcul.fiches) {
    for (const b of fiche.broches) {
      const masse = canon(fiche, b.domaine?.masse);
      if (!masse) continue;
      const point = `${chemin}:${b.nom}`;
      const v = calcul.difference(point, `${chemin}:${masse}`);
      if (v === undefined) continue;
      const affiche = pointAffiche(chemin, b.nom, calcul.fiches);
      const diodes = (b['entree'] as { diodes_protection?: unknown } | undefined)?.diodes_protection;
      const ma = (b['max_absolus'] as Limites | undefined)?.tension;
      let horsMaximum = false;
      if (ma && !diodes) {
        const max = borne(ma, 'max');
        const min = borne(ma, 'min');
        if (max !== undefined && v > max + TOLERANCE_V) {
          horsMaximum = true;
          sorties.push({
            chemin,
            fiche,
            verdict: 'risque_eleve',
            point: affiche,
            titre: `${affiche} à ${formater(v, 'V')}, au-delà de ${formater(max, 'V')}`,
            explication: `${b.nom} est à ${formater(v, 'V')} par rapport à ${masse}, au-delà de son maximum absolu (${formater(max, 'V')}). Sans donnée sur le courant qui détruit la puce, le calcul ne peut pas conclure « grillé ».`,
            correction: `Ramener ${b.nom} sous ${formater(max, 'V')}.`,
            source: { fiche: fiche.id, src: ma.src },
            origine: 'calcul',
          });
        } else if (min !== undefined && v < min - TOLERANCE_V) {
          horsMaximum = true;
          sorties.push(fiche.modele?.type === 'driver_pas_a_pas' && b.nom === 'VS' ? inversionVS(ctx, chemin, fiche, v, min, affiche) : {
            chemin,
            fiche,
            verdict: 'risque_eleve',
            point: affiche,
            titre: `${affiche} à ${formater(v, 'V')}, sous ${formater(min, 'V')}`,
            explication: `${b.nom} est à ${formater(v, 'V')} par rapport à ${masse}, sous son minimum absolu (${formater(min, 'V')}) : tension inversée. Sans donnée sur le courant qui détruit la puce, le calcul ne peut pas conclure « grillé ».`,
            correction: 'Vérifier le sens du branchement.',
            source: { fiche: fiche.id, src: ma.src },
            origine: 'calcul',
          });
        }
      }
      const rec = (b['recommande'] as Limites | undefined)?.tension;
      if (!rec || horsMaximum) continue;
      const rmin = borne(rec, 'min');
      const rmax = borne(rec, 'max');
      const trop = rmax !== undefined && v > rmax + TOLERANCE_V;
      const pasAssez = rmin !== undefined && v < rmin - TOLERANCE_V;
      if (!trop && !pasAssez) continue;
      const plage = `${rmin !== undefined ? formater(rmin, 'V') : '…'} à ${rmax !== undefined ? formater(rmax, 'V') : '…'}`;
      sorties.push({
        chemin,
        fiche,
        verdict: 'ne_marchera_pas',
        point: affiche,
        titre: `${affiche} à ${formater(v, 'V')}, hors de la plage de fonctionnement`,
        explication: `${b.nom} est à ${formater(v, 'V')} par rapport à ${masse}, hors de la plage où le fabricant garantit le fonctionnement (${plage}).${pasAssez && Math.abs(v) < 0.1 ? ' Elle n\'est pas alimentée.' : ''}`,
        correction: `Alimenter ${b.nom} entre ${plage}.`,
        source: { fiche: fiche.id, src: rec.src },
        origine: 'calcul',
      });
    }
  }
  return sorties;
}

/** VS sous GND : les diodes internes du pont conduisent ; « grillé » si elles dépassent leur courant maximal. */
function inversionVS(ctx: Contexte, chemin: string, fiche: Fiche, v: number, min: number, affiche: string): NouveauConstat {
  const { calcul } = ctx;
  let imax = 0;
  calcul.etiquettes.forEach((et, k) => {
    if (et.role === 'diode_pont' && et.piece === chemin) imax = Math.max(imax, calcul.solution.courants[k]!);
  });
  const limite = grandeurModele(fiche, 'courant_max_diodes_pont');
  const max = borne(limite, 'max');
  const grille = max !== undefined && imax > max;
  return {
    chemin,
    fiche,
    verdict: grille ? 'grille' : 'risque_eleve',
    point: affiche,
    titre: `${affiche} inversée : ${formater(imax, 'A')} dans les diodes du pont`,
    explication: `VS est ${formater(-v, 'V')} sous GND (minimum absolu ${formater(min, 'V')}) : les diodes internes du pont conduisent de GND vers VS à travers les sorties, et la plus chargée porte ${formater(imax, 'A')}${max !== undefined ? (grille ? `, au-delà des ${formater(max, 'A')} qu'elle supporte.` : `, sous les ${formater(max, 'A')} retenus pour la destruction : seule la limite de l'alim les sauve.`) : '.'}`,
    correction: 'Remettre VM sur le + de l\'alimentation et GND sur le −. Une diode ou un MOSFET de protection contre les inversions en tête de montage évite ce cas.',
    ...(limite ? { source: { fiche: fiche.id, src: limite.src } } : {}),
    origine: 'calcul',
  };
}

/**
 * Courant de sortie d'une broche de microcontrôleur au-delà du courant sûr de sa fiche
 * (sortie.courant_max avec un maximum : 16 mA par GPIO de la Raspberry Pi 5). Le fabricant
 * ne dit pas ce qui casse ni à partir de quand : « risque élevé ».
 */
function verifierSorties(ctx: Contexte): NouveauConstat[] {
  const { calcul } = ctx;
  const sorties: NouveauConstat[] = [];
  calcul.etiquettes.forEach((et, k) => {
    if (et.role !== 'sortie') return;
    const fiche = calcul.fiches.get(et.piece);
    const b = fiche && trouverBroche(fiche, et.broches[0] ?? '');
    const limite = (b?.['sortie'] as { courant_max?: Grandeur } | undefined)?.courant_max;
    const max = borne(limite, 'max');
    const i = Math.abs(calcul.solution.courants[k] ?? 0);
    if (!fiche || !b || !limite || max === undefined || i <= max * (1 + 1e-6)) return;
    const affiche = pointAffiche(et.piece, b.nom, calcul.fiches);
    sorties.push({
      chemin: et.piece,
      fiche,
      verdict: 'risque_eleve',
      point: affiche,
      titre: `${affiche} débite ${formater(i, 'A')}, au-delà de ${formater(max, 'A')}`,
      explication: `La broche fournit ou absorbe ${formater(i, 'A')}, plus que les ${formater(max, 'A')} que sa fiche donne pour une broche. Au-delà, le fabricant ne garantit plus rien : la broche peut s'abîmer, et sa tension n'est plus un niveau logique propre.`,
      correction: 'Ajouter une résistance en série (LED : 220 Ω à 1 kΩ) ou passer par un transistor pour les charges qui demandent du courant.',
      source: { fiche: fiche.id, src: limite.src },
      origine: 'calcul',
    });
  });
  return sorties;
}

/**
 * LED : courant direct au-delà de son maximum continu (risque élevé : la datasheet annonce une
 * dégradation ou une panne prématurée, sans dire quand) ou de son courant de crête (grillé : même
 * une impulsion brève n'est pas permise), tension inverse au-delà de son maximum (risque élevé),
 * et LED branchée à l'envers (ne marchera pas : elle reste éteinte).
 */
function verifierLeds(ctx: Contexte): NouveauConstat[] {
  const { calcul } = ctx;
  const sorties: NouveauConstat[] = [];
  calcul.etiquettes.forEach((et, k) => {
    if (et.role !== 'led') return;
    const fiche = calcul.fiches.get(et.piece)!;
    const i = calcul.solution.courants[k] ?? 0;
    const continu = grandeurModele(fiche, 'courant_direct_max');
    const crete = grandeurModele(fiche, 'courant_crete_max');
    const inverse = grandeurModele(fiche, 'tension_inverse_max');
    const iContinu = borne(continu, 'max');
    const iCrete = borne(crete, 'max');
    const vInverse = calcul.difference(`${et.piece}:C`, `${et.piece}:A`) ?? 0;
    const base = { chemin: et.piece, fiche, origine: 'calcul' as const };
    if (iCrete !== undefined && i > iCrete) {
      sorties.push({
        ...base,
        verdict: 'grille',
        point: `${et.piece}:A`,
        titre: `${et.piece} : ${formater(i, 'A')}, au-delà de son courant de crête (${formater(iCrete, 'A')})`,
        explication: `${formater(i, 'A')} traversent la LED en continu, plus que le courant qu'elle ne supporte même en impulsions brèves (${formater(iCrete, 'A')}) : elle grille.`,
        correction: "Mettre une résistance en série : R = (tension d'alim − 2 V) / 0,01 A pour 10 mA (330 Ω sous 5 V, 150 Ω sous 3,3 V).",
        ...(crete ? { source: { fiche: fiche.id, src: crete.src } } : {}),
      });
    } else if (iContinu !== undefined && i > iContinu * (1 + 1e-6)) {
      sorties.push({
        ...base,
        verdict: 'risque_eleve',
        point: `${et.piece}:A`,
        titre: `${et.piece} : ${formater(i, 'A')}, au-delà de ${formater(iContinu, 'A')} en continu`,
        explication: `La LED reçoit ${formater(i, 'A')}, plus que son maximum en continu (${formater(iContinu, 'A')}). La datasheet annonce une forte baisse de lumière ou une panne prématurée, sans dire au bout de combien de temps.`,
        correction: 'Augmenter la résistance en série pour rester vers 10 mA.',
        ...(continu ? { source: { fiche: fiche.id, src: continu.src } } : {}),
      });
    }
    const vMax = borne(inverse, 'max');
    if (vMax !== undefined && vInverse > vMax * (1 + 1e-6)) {
      sorties.push({
        ...base,
        verdict: 'risque_eleve',
        point: `${et.piece}:C`,
        titre: `${et.piece} à l'envers sous ${formater(vInverse, 'V')}, au-delà de ${formater(vMax, 'V')}`,
        explication: `La cathode est ${formater(vInverse, 'V')} au-dessus de l'anode, plus que la tension inverse maximale (${formater(vMax, 'V')}). Sans donnée sur le courant de claquage, le calcul ne peut pas conclure « grillé ».`,
        correction: "Retourner la LED : la patte de l'anode (A) côté +.",
        ...(inverse ? { source: { fiche: fiche.id, src: inverse.src } } : {}),
      });
    } else if (vInverse > 1) {
      sorties.push({
        ...base,
        verdict: 'ne_marchera_pas',
        point: `${et.piece}:C`,
        titre: `${et.piece} branchée à l'envers : elle reste éteinte`,
        explication: `La cathode (C) est ${formater(vInverse, 'V')} au-dessus de l'anode (A) : une LED ne laisse passer le courant que de A vers C.`,
        correction: "Retourner la LED : l'anode (A) côté +, la cathode (C) côté masse.",
      });
    }
  });
  return sorties;
}

/** Alim de labo en limite de courant : la tension n'est plus celle qu'on a réglée. */
function verifierSources(ctx: Contexte): NouveauConstat[] {
  const { calcul, montage } = ctx;
  return calcul.sources.flatMap((s) => {
    const fiche = calcul.fiches.get(s.piece);
    if (!fiche || fiche.modele?.type !== 'alim_laboratoire' || s.regime !== 'courant') return [];
    const reglee = montage.pieces.find((p) => p.id === s.piece)?.parametres['tension'];
    const passage = fiche.modele.valeurs['passage_tension_courant_constant'] as { src: Source } | undefined;
    return [
      {
        chemin: s.piece,
        fiche,
        verdict: 'ne_marchera_pas' as const,
        point: `${s.piece}:+`,
        titre: `${s.piece} en limite de courant (${formater(s.courant, 'A')})`,
        explication: `L'alim atteint sa limite de courant : elle passe en courant constant et sa tension tombe à ${formater(s.tension, 'V')}${typeof reglee === 'number' ? ` au lieu de ${reglee} V` : ''}. Court-circuit, ou consommation plus forte que la limite.`,
        correction: 'Chercher un court-circuit (fil inversé, masses mal reliées) ; sinon, relever la limite de courant.',
        ...(passage ? { source: { fiche: fiche.id, src: passage.src } } : {}),
        origine: 'calcul' as const,
      },
    ];
  });
}

/** Fils, contacts de breadboard et résistances : courant ou puissance au-delà du nominal. */
function verifierConnectique(ctx: Contexte): NouveauConstat[] {
  const { calcul, montage, catalogue } = ctx;
  const sorties: NouveauConstat[] = [];
  const fil = catalogue.fiche('fil-dupont');
  const nominalFil = fil && grandeurModele(fil, 'courant_nominal');
  const breadboards = new Map(montage.pieces.filter((p) => p.fiche.modele?.type === 'breadboard').map((p) => [p.id, p.fiche]));
  montage.connexions.forEach((c, i) => {
    const courant = calcul.courantFil(i);
    if (courant === undefined) return;
    const a = Math.abs(courant);
    const nom = `${c.de.piece}:${c.de.broche} → ${c.vers.piece}:${c.vers.broche}`;
    const max = borne(nominalFil, 'max');
    if (c.couleur !== '' && fil && max !== undefined && a > max) {
      sorties.push({
        chemin: 'fil',
        fiche: fil,
        verdict: 'chauffe',
        connexion: i,
        point: `${c.de.piece}:${c.de.broche}`,
        titre: `Fil ${nom} : ${formater(a, 'A')}`,
        explication: `Ce fil porte ${formater(a, 'A')}, au-delà des ${formater(max, 'A')} qu'un fil Dupont fin supporte sans chauffer.`,
        correction: 'Doubler le fil ou prendre un fil plus gros pour la puissance.',
        source: { fiche: fil.id, src: nominalFil!.src },
        origine: 'calcul',
      });
    }
    for (const bout of [c.de, c.vers]) {
      const bb = breadboards.get(bout.piece);
      const nominal = bb && grandeurModele(bb, 'courant_nominal_contact');
      const maxContact = borne(nominal, 'max');
      if (!bb || maxContact === undefined || a <= maxContact) continue;
      sorties.push({
        chemin: bout.piece,
        fiche: bb,
        verdict: 'chauffe',
        connexion: i,
        point: `${bout.piece}:${bout.broche}`,
        titre: `Contact ${bout.piece}:${bout.broche} : ${formater(a, 'A')}`,
        explication: `Le contact du trou ${bout.broche} porte ${formater(a, 'A')}, au-delà des ${formater(maxContact, 'A')} qu'un contact de breadboard supporte sans chauffer.`,
        correction: 'Amener la puissance par plusieurs trous en parallèle, ou par un bornier ou une soudure plutôt que par la breadboard.',
        source: { fiche: bb.id, src: nominal!.src },
        origine: 'calcul',
      });
    }
  });
  calcul.etiquettes.forEach((et, k) => {
    if (et.role !== 'resistance') return;
    const e = calcul.elements[k]!;
    const piece = montage.pieces.find((p) => p.id === et.piece);
    const pnom = piece?.parametres['puissance_nominale'];
    const def = piece?.fiche.parametres?.['puissance_nominale'];
    if (e.type !== 'resistance' || !piece || typeof pnom !== 'number' || !def) return;
    const i = calcul.solution.courants[k]!;
    const p = e.r * i * i;
    const max = versUniteDeBase(pnom, def.unite);
    if (p <= max) return;
    sorties.push({
      chemin: piece.id,
      fiche: piece.fiche,
      verdict: 'chauffe',
      point: `${piece.id}:${et.broches[0]}`,
      titre: `${piece.id} dissipe ${formater(p, 'W')}`,
      explication: `La résistance dissipe ${formater(p, 'W')}, au-delà de sa puissance nominale (${formater(max, 'W')}).`,
      correction: 'Prendre une résistance de puissance plus forte, ou une valeur plus grande.',
      ...(def.src ? { source: { fiche: piece.fiche.id, src: def.src } } : {}),
      origine: 'calcul',
    });
  });
  return sorties;
}

/** Moteurs et drivers : courant au-delà du nominal, température estimée. */
function verifierThermique(ctx: Contexte): NouveauConstat[] {
  const { calcul } = ctx;
  const sorties: NouveauConstat[] = [];
  const thermique = (fiche: Fiche) =>
    fiche['thermique'] as { resistance_thermique?: Grandeur; temperature_max?: Grandeur; seuils?: { nom: string; temperature: Grandeur; effet: string }[] } | undefined;

  // Moteurs : courant de chaque bobine, puis échauffement de l'ensemble.
  const moteurs = new Map<string, { imax: number; p: number }>();
  calcul.etiquettes.forEach((et, k) => {
    const e = calcul.elements[k]!;
    if (et.role !== 'bobine' || e.type !== 'resistance') return;
    const i = Math.abs(calcul.solution.courants[k]!);
    const m = moteurs.get(et.piece) ?? { imax: 0, p: 0 };
    moteurs.set(et.piece, { imax: Math.max(m.imax, i), p: m.p + e.r * i * i });
  });
  for (const [piece, { imax, p }] of moteurs) {
    const fiche = calcul.fiches.get(piece)!;
    const nominal = grandeurModele(fiche, 'courant_nominal_phase');
    const max = borne(nominal, 'max');
    if (max !== undefined && imax > max + 1e-9) {
      sorties.push({
        chemin: piece,
        fiche,
        verdict: 'chauffe',
        point: `${piece}:A+`,
        titre: `${piece} : ${formater(imax, 'A')} par bobine, pour ${formater(max, 'A')} nominaux`,
        explication: `Une bobine du moteur porte ${formater(imax, 'A')}, au-delà de son courant nominal (${formater(max, 'A')}).`,
        correction: 'Baisser le courant du driver (VREF ou réglage UART) sous le courant nominal du moteur.',
        source: { fiche: fiche.id, src: nominal!.src },
        origine: 'calcul',
      });
    }
    const th = thermique(fiche);
    const rth = borne(th?.resistance_thermique, 'max') ?? borne(th?.resistance_thermique, 'typ');
    const tmax = borne(th?.temperature_max, 'max');
    if (rth === undefined || tmax === undefined) continue;
    const t = TEMPERATURE_AMBIANTE + rth * p;
    if (t <= tmax) continue;
    sorties.push({
      chemin: piece,
      fiche,
      verdict: 'risque',
      point: `${piece}:A+`,
      titre: `${piece} vers ${formater(t, '°C')}`,
      explication: `Les bobines dissipent ${formater(p, 'W')} : le moteur monterait vers ${formater(t, '°C')} (ambiante ${TEMPERATURE_AMBIANTE} °C), au-delà de ${formater(tmax, '°C')}. L'isolant des bobines vieillit vite au-delà.`,
      correction: 'Baisser le courant, ou réduire le courant à l\'arrêt.',
      source: { fiche: fiche.id, src: th!.temperature_max!.src },
      origine: 'calcul',
    });
  }

  // Drivers : courant réglé contre le courant continu de la puce, température de jonction.
  for (const d of calcul.drivers) {
    if (!d.actif) continue;
    const puce = [...calcul.fiches].find(([c, f]) => c.startsWith(`${d.piece}/`) && f.modele?.type === 'driver_pas_a_pas');
    if (!puce) continue;
    const [cheminPuce, fiche] = puce;
    const continu = grandeurModele(fiche, 'courant_rms_continu');
    const max = borne(continu, 'max');
    if (max !== undefined && d.courantBobine > max + 1e-9) {
      sorties.push({
        chemin: cheminPuce,
        fiche,
        verdict: 'chauffe',
        point: `${d.piece}:VM`,
        titre: `${d.piece} : ${formater(d.courantBobine, 'A')} efficaces, pour ${formater(max, 'A')} en continu`,
        explication: `Le driver impose ${formater(d.courantBobine, 'A')} efficaces par bobine${d.parUart ? ' (réglage UART)' : ''}, au-delà du courant qu'il tient en continu (${formater(max, 'A')}).`,
        correction: 'Baisser le courant, ou refroidir le module (radiateur, ventilateur).',
        source: { fiche: fiche.id, src: continu!.src },
        origine: 'calcul',
      });
    }
    const th = thermique(fiche);
    const rth = borne(th?.resistance_thermique, 'typ') ?? borne(th?.resistance_thermique, 'max');
    if (rth === undefined) continue;
    const tj = TEMPERATURE_AMBIANTE + rth * d.pertesPuce;
    const coupure = th?.seuils?.find((s) => s.nom === 'coupure');
    const finPlage = th?.seuils?.find((s) => s.nom === 'fin de la plage de fonctionnement');
    const tCoupure = borne(coupure?.temperature, 'typ');
    const tFin = borne(finPlage?.temperature, 'max');
    const base = `La puce dissipe ${formater(d.pertesPuce, 'W')} : sa jonction monterait vers ${formater(tj, '°C')} (ambiante ${TEMPERATURE_AMBIANTE} °C, ${rth} K/W).`;
    if (tCoupure !== undefined && tj > tCoupure) {
      sorties.push({
        chemin: cheminPuce,
        fiche,
        verdict: 'ne_marchera_pas',
        point: `${d.piece}:VM`,
        titre: `${d.piece} se coupera en surchauffe (${formater(tj, '°C')})`,
        explication: `${base} Au-delà de ${formater(tCoupure, '°C')}, le driver coupe ses sorties.`,
        correction: 'Baisser le courant ou refroidir le module.',
        source: { fiche: fiche.id, src: coupure!.temperature.src },
        origine: 'calcul',
      });
    } else if (tFin !== undefined && tj > tFin) {
      sorties.push({
        chemin: cheminPuce,
        fiche,
        verdict: 'risque',
        point: `${d.piece}:VM`,
        titre: `${d.piece} vers ${formater(tj, '°C')}`,
        explication: `${base} Au-delà de ${formater(tFin, '°C')}, le fabricant ne garantit plus ses caractéristiques.`,
        correction: 'Baisser le courant ou refroidir le module.',
        source: { fiche: fiche.id, src: finPlage!.temperature.src },
        origine: 'calcul',
      });
    }
  }
  return sorties;
}

const RECEPTEURS = ['entree_logique', 'configuration', 'communication', 'entree_analogique'];
const EMETTEURS = ['sortie_logique', 'entree_sortie_logique', 'communication'];

/** Cas 8 : un signal entre deux pièces dont les masses ne sont reliées par aucun fil. */
function verifierMasses(ctx: Contexte): NouveauConstat[] {
  const { calcul, grossier } = ctx;
  const sorties: NouveauConstat[] = [];
  const vues = new Set<string>();
  // Broches qui reçoivent un signal : d'abord les entrées pures (entrée d'un driver commandée par
  // l'ESP32), puis les GPIO entrée-sortie (liaison entre deux cartes, ESP32 et Raspberry Pi). Une
  // paire de pièces ne donne qu'un constat, porté par la première pièce trouvée.
  const pieces = [...calcul.fiches].filter(([chemin]) => !chemin.includes('/'));
  const recepteurs = (roles: string[], dansLesDeuxSens: boolean) =>
    pieces.flatMap(([chemin, fiche]) => fiche.broches.filter((b) => roles.includes(b.role)).map((b) => ({ chemin, fiche, b, dansLesDeuxSens })));
  for (const { chemin, fiche, b, dansLesDeuxSens } of [...recepteurs(RECEPTEURS, false), ...recepteurs(['entree_sortie_logique'], true)]) {
    const masse = canon(fiche, b.domaine?.masse);
    if (!masse) continue;
    const noeud = grossier.noeudDe(`${chemin}:${b.nom}`);
    const maMasse = grossier.noeudDe(`${chemin}:${masse}`);
    if (!noeud || !maMasse) continue;
    for (const p of noeud.points) {
      const info = brocheDe(p, calcul.fiches);
      if (!info || info.chemin.includes('/') || info.chemin === chemin || !EMETTEURS.includes(info.broche.role)) continue;
      const sienne = grossier.noeudDe(`${info.chemin}:${canon(info.fiche, info.broche.domaine?.masse)}`);
      if (!sienne || sienne.id === maMasse.id) continue;
      const cle = [chemin, info.chemin].sort().join('|');
      if (vues.has(cle)) continue;
      vues.add(cle);
      sorties.push({
        chemin,
        fiche,
        verdict: 'ne_marchera_pas',
        point: `${chemin}:${b.nom}`,
        titre: `${chemin} et ${info.chemin} n'ont pas de masse commune`,
        explication: dansLesDeuxSens
          ? `${chemin}:${b.nom} et ${info.chemin}:${info.broche.nom} échangent un signal, mais aucun fil ne relie la masse de ${chemin} (${masse}) à celle de ${info.chemin}. Un niveau logique se mesure par rapport à la masse : sans masse commune, chaque carte lit n'importe quoi.`
          : `${info.chemin}:${info.broche.nom} commande ${chemin}:${b.nom}, mais aucun fil ne relie la masse de ${chemin} (${masse}) à celle de ${info.chemin}. Un niveau logique se mesure par rapport à la masse : sans masse commune, ${chemin} lit n'importe quoi.`,
        correction: `Relier par un fil la masse de ${info.chemin} à celle de ${chemin} : la logique et chaque alimentation (moteurs, autre carte) partagent la même masse.`,
        origine: 'calcul',
      });
    }
  }
  return sorties;
}

export function verifier(montage: Montage, catalogue: Catalogue): Rapport {
  const calcul = calculer(montage, catalogue);
  const aDesEtats = montage.pieces.some((p) => Object.keys(p.etats).length > 0);
  const demarrage = aDesEtats ? calculer(montage, catalogue, { demarrage: true }) : calcul;
  const nonSimule = [...new Set([...calcul.avertissements, ...demarrage.avertissements])];
  if (!calcul.converge || !demarrage.converge) {
    return {
      converge: false,
      message: calcul.message ?? demarrage.message ?? 'calcul impossible',
      constats: [],
      parPiece: new Map(),
      nonSimule: [`calcul impossible : ${calcul.message ?? demarrage.message}`, ...nonSimule],
      calcul,
      demarrage,
      effets: [],
    };
  }
  const ctx: Contexte = { montage, catalogue, calcul, demarrage, grossier: construireReseau(montage, catalogue) };
  const regles = appliquerRegles(ctx);
  const effets = calculerEffets(ctx);
  const tous = [
    ...[
      ...verifierInjections(ctx),
      ...verifierTensions(ctx),
      ...verifierSorties(ctx),
      ...verifierLeds(ctx),
      ...verifierSources(ctx),
      ...verifierConnectique(ctx),
      ...verifierThermique(ctx),
      ...verifierMasses(ctx),
      ...verifierEffets(ctx, effets),
    ].map(constat),
    ...regles.constats,
  ];
  const vus = new Set<string>();
  const constats = tous
    .filter((c) => {
      const cle = `${c.verdict}|${c.point ?? c.piece}|${c.titre}`;
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    })
    .sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) || a.piece.localeCompare(b.piece));
  const parPiece = new Map<string, Verdict>();
  for (const c of constats) if (!parPiece.has(c.piece)) parPiece.set(c.piece, c.verdict);
  return { converge: true, constats, parPiece, nonSimule: [...nonSimule, ...regles.nonCodees], calcul, demarrage, effets };
}
