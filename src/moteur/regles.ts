// Règles déclarées dans les fiches : ce que le calcul en continu ne voit pas seul (condensateur
// absent, moteur débranché sous tension, état des broches au démarrage...). Le code de chaque
// règle vit ici ; son verdict, son explication, sa correction et sa source vivent dans la fiche.
// Une règle s'appuie sur le calcul quand elle a besoin d'une tension, mais ne donne jamais
// « grillé » (règle 3 de CLAUDE.md).
import { borne, canon, constat, formater, pointAffiche, brocheDe, type Constat, type Contexte, type NouveauConstat, type Verdict } from './constats';
import { grandeurModele, trouverBroche, versUniteDeBase, type Fiche, type Grandeur, type Source } from './fiche';
import type { Calcul } from './circuit';

interface Regle {
  id: string;
  verdict: Verdict;
  explication: string;
  correction?: string;
  src: Source;
  parametres?: Record<string, unknown>;
}

type Implementation = (ctx: Contexte, chemin: string, fiche: Fiche, regle: Regle) => NouveauConstat[];

function depuisRegle(chemin: string, fiche: Fiche, regle: Regle, titre: string, precision: string, point?: string): NouveauConstat {
  return {
    chemin,
    fiche,
    verdict: regle.verdict === 'grille' ? 'risque_eleve' : regle.verdict,
    titre,
    explication: `${precision} ${regle.explication}`,
    ...(regle.correction ? { correction: regle.correction } : {}),
    source: { fiche: fiche.id, src: regle.src },
    origine: 'regle',
    regle: regle.id,
    ...(point ? { point } : {}),
  };
}

/** La puce driver d'un module ("drv1" -> "drv1/U1"). */
export function puceDe(calcul: Calcul, module: string): { chemin: string; fiche: Fiche } | undefined {
  for (const [chemin, fiche] of calcul.fiches) {
    if (chemin.startsWith(`${module}/`) && !chemin.slice(module.length + 1).includes('/') && fiche.modele?.type === 'driver_pas_a_pas') {
      return { chemin, fiche };
    }
  }
  return undefined;
}

/** VS de la puce au-dessus de son seuil de sous-tension. */
function vsAlimente(calcul: Calcul, puce: { chemin: string; fiche: Fiche }): boolean {
  const v = calcul.difference(`${puce.chemin}:VS`, `${puce.chemin}:GND`);
  const seuil = borne(grandeurModele(puce.fiche, 'seuil_sous_tension_vs'), 'typ') ?? 0;
  return v !== undefined && v >= seuil;
}

/** Niveau logique lu par une entrée : 0, 1, ou undefined entre les deux seuils. */
export function niveau(calcul: Calcul, chemin: string, fiche: Fiche, nom: string): 0 | 1 | undefined {
  const b = trouverBroche(fiche, nom);
  const niveaux = b?.['niveaux'] as { vil_max?: Grandeur; vih_min?: Grandeur } | undefined;
  const masse = canon(fiche, b?.domaine?.masse);
  const alim = canon(fiche, b?.domaine?.alim);
  if (!b || !niveaux || !masse || !alim) return undefined;
  const v = calcul.difference(`${chemin}:${b.nom}`, `${chemin}:${masse}`);
  const valim = calcul.difference(`${chemin}:${alim}`, `${chemin}:${masse}`);
  const bas = niveaux.vil_max?.max;
  const haut = niveaux.vih_min?.min;
  if (v === undefined || valim === undefined || bas === undefined || haut === undefined) return undefined;
  // Seuils en fraction de l'alim (unité « 1 ») ou en volts.
  const vb = niveaux.vil_max!.unite === '1' ? bas * valim : versUniteDeBase(bas, niveaux.vil_max!.unite);
  const vh = niveaux.vih_min!.unite === '1' ? haut * valim : versUniteDeBase(haut, niveaux.vih_min!.unite);
  return v < vb ? 0 : v > vh ? 1 : undefined;
}

/** Îlots de cuivre sans fil : un nœud du calcul et tout ce qui y est enfiché (contacts compris). */
function ilots(calcul: Calcul): (n: number) => number {
  const parent = new Map<number, number>();
  const racine = (n: number): number => {
    let r = n;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of calcul.reseau.contacts) {
    const a = racine(c.noeuds[0]);
    const b = racine(c.noeuds[1]);
    if (a !== b) parent.set(b, a);
  }
  return racine;
}

const groupesTraites = new WeakMap<Contexte, Set<string>>();

/** UART utilisée : PDN_UART relié à une broche UART d'un microcontrôleur, directement ou par une résistance. */
export function uartUtilisee(ctx: Contexte, module: string, fiche: Fiche): boolean {
  const nom = canon(fiche, 'PDN_UART');
  const depart = nom && ctx.grossier.noeudDe(`${module}:${nom}`);
  if (!depart) return false;
  const vus = new Set<number>();
  const aVoir = [depart];
  for (let etape = 0; etape < 2 && aVoir.length > 0; etape++) {
    for (const noeud of aVoir.splice(0)) {
      if (vus.has(noeud.id)) continue;
      vus.add(noeud.id);
      for (const p of noeud.points) {
        const info = brocheDe(p, ctx.calcul.fiches);
        if (!info) continue;
        // U2TXD sur l'ESP32, TXD sur la Raspberry Pi.
        if (info.broche.fonctions?.some((f) => /^(U\d)?(RXD|TXD)$/.test(f))) return true;
        // Une résistance série (1 kΩ sur TX) : on regarde de l'autre côté.
        if (info.fiche.modele?.type === 'resistance' && !info.chemin.includes('/')) {
          const autre = info.fiche.broches.find((b) => b.nom !== info.broche.nom);
          const n = autre && ctx.grossier.noeudDe(`${info.chemin}:${autre.nom}`);
          if (n) aVoir.push(n);
        }
      }
    }
  }
  return false;
}

const REGLES: Record<string, Implementation> = {
  // Cas 4 : au moins 100 µF entre VM et GND, au plus près du module : enfiché sur les mêmes
  // bandes que VM et GND, ou relié à elles par un fil qui ne sert qu'à lui.
  'condensateur-reservoir': (ctx, chemin, fiche, regle) => {
    const puce = puceDe(ctx.calcul, chemin);
    if (!puce || !vsAlimente(ctx.calcul, puce)) return [];
    const capaciteMin = borne(regle.parametres?.['capacite_min'] as Grandeur | undefined, 'min') ?? 0;
    const reseau = ctx.calcul.reseau;
    const ilot = ilots(ctx.calcul);
    const vm = reseau.noeudDe(`${chemin}:${canon(fiche, 'VM')}`)?.id;
    const masses = fiche.broches.filter((b) => b.role === 'masse').flatMap((b) => reseau.noeudDe(`${chemin}:${b.nom}`)?.id ?? []);
    if (vm === undefined) return [];
    const breadboards = new Set(ctx.montage.pieces.filter((p) => p.fiche.modele?.type === 'breadboard').map((p) => p.id));
    const dedie = (racine: number, piece: string): boolean =>
      reseau.noeuds
        .filter((n) => ilot(n.id) === racine)
        .every((n) => n.points.every((p) => [piece, ...breadboards].includes(p.slice(0, p.indexOf(':')))));
    const proche = (n: number, cible: number, piece: string): boolean => {
      const a = ilot(n);
      const b = ilot(cible);
      if (a === b) return true;
      return dedie(a, piece) && reseau.fils.some((f) => {
        const [x, y] = [ilot(f.noeuds[0]), ilot(f.noeuds[1])];
        return (x === a && y === b) || (x === b && y === a);
      });
    };
    const trouve = ctx.montage.pieces.some((p) => {
      if (p.fiche.modele?.type !== 'condensateur') return false;
      const c = p.parametres['capacite'];
      const def = p.fiche.parametres?.['capacite'];
      if (typeof c !== 'number' || !def || versUniteDeBase(c, def.unite) < capaciteMin) return false;
      const plus = reseau.noeudDe(`${p.id}:+`)?.id;
      const moins = reseau.noeudDe(`${p.id}:-`)?.id;
      return plus !== undefined && moins !== undefined && proche(plus, vm, p.id) && masses.some((m) => proche(moins, m, p.id));
    });
    if (trouve) return [];
    const uF = Math.round(capaciteMin * 1e6);
    return [
      depuisRegle(chemin, fiche, regle, `${chemin} : pas de condensateur de ${uF} µF près de VM`, `Aucun condensateur d'au moins ${uF} µF n'est enfiché sur les bandes de VM et GND de ${chemin}, ni relié à elles par un fil qui ne sert qu'à lui.`, `${chemin}:VM`),
    ];
  },

  // Cas 3 : VM alimenté et une bobine du moteur n'est reliée à rien.
  'pas-de-branchement-a-chaud': (ctx, chemin, fiche, regle) => {
    const puce = puceDe(ctx.calcul, chemin);
    if (!puce || !vsAlimente(ctx.calcul, puce)) return [];
    const { calcul } = ctx;
    const parent = new Map<number, number>();
    const racine = (n: number): number => {
      let r = n;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    // Chemins conducteurs hors du module : fils, contacts, bobines, résistances...
    calcul.elements.forEach((e, k) => {
      const et = calcul.etiquettes[k]!;
      if (e.type === 'diode' || e.type === 'charge' || et.piece === chemin || et.piece.startsWith(`${chemin}/`)) return;
      const [a, b] = e.type === 'resistance' ? [e.a, e.b] : [e.plus, e.moins];
      const ra = racine(a);
      const rb = racine(b);
      if (ra !== rb) parent.set(rb, ra);
    });
    const ouvertes = [
      ['OA1', 'OA2'],
      ['OB1', 'OB2'],
    ].filter(([s1, s2]) => {
      const a = calcul.reseau.noeudDe(`${puce.chemin}:${s1}`)?.id;
      const b = calcul.reseau.noeudDe(`${puce.chemin}:${s2}`)?.id;
      return a !== undefined && b !== undefined && racine(a) !== racine(b);
    });
    if (ouvertes.length === 0) return [];
    const noms = ouvertes.map(([s1, s2]) => `${pointAffiche(puce.chemin, s1!, calcul.fiches)}-${pointAffiche(puce.chemin, s2!, calcul.fiches).split(':')[1]}`);
    return [
      depuisRegle(chemin, fiche, regle, `${chemin} : moteur débranché alors que VM est alimenté`, `VM est alimenté et ${noms.join(' et ')} ne sont reliées à aucune bobine : c'est l'état où l'on branche ou débranche le moteur.`),
    ];
  },

  // Cas 7 : sans UART, MS1 et MS2 fixent les micro-pas ; ils doivent être les mêmes dans un groupe.
  'micro-pas-identiques': (ctx, chemin, _fiche, regle) => {
    const groupe = ctx.montage.pieces.find((p) => p.id === chemin)?.groupe ?? '';
    const faits = groupesTraites.get(ctx) ?? new Set<string>();
    groupesTraites.set(ctx, faits);
    if (faits.has(groupe)) return [];
    faits.add(groupe);
    const membres = ctx.montage.pieces.flatMap((p) => {
      if ((p.groupe ?? '') !== groupe || !(p.fiche['regles'] as Regle[] | undefined)?.some((r) => r.id === regle.id)) return [];
      const puce = puceDe(ctx.calcul, p.id);
      const d = ctx.calcul.drivers.find((x) => x.piece === p.id);
      if (!puce || !d?.alimente || uartUtilisee(ctx, p.id, p.fiche)) return [];
      const ms1 = niveau(ctx.calcul, puce.chemin, puce.fiche, 'MS1_AD0');
      const ms2 = niveau(ctx.calcul, puce.chemin, puce.fiche, 'MS2_AD1');
      if (ms1 === undefined || ms2 === undefined) return [];
      const table = puce.fiche.modele?.valeurs['micro_pas'] as { lignes: number[][] } | undefined;
      const micro = table?.lignes.find((l) => l[0] === ms2 && l[1] === ms1)?.[2];
      return [{ piece: p, ms1, ms2, micro }];
    });
    if (new Set(membres.map((m) => `${m.ms1}${m.ms2}`)).size <= 1) return [];
    const liste = membres.map((m) => `${m.piece.id} : MS1 = ${m.ms1}, MS2 = ${m.ms2}${m.micro !== undefined ? `, ${m.micro} micro-pas` : ''}`).join(' ; ');
    return membres.map((m) =>
      depuisRegle(m.piece.id, m.piece.fiche, regle, `${m.piece.id} : micro-pas différents des autres drivers du groupe, sans UART`, `Aucune UART ne relie ces drivers et leurs micro-pas diffèrent (${liste}).`, `${m.piece.id}:MS1`),
    );
  },

  // Cas 5 : au démarrage, EN doit être franchement haut (driver coupé).
  'en-au-demarrage': (ctx, chemin, fiche, regle) => {
    const d = ctx.demarrage.drivers.find((x) => x.piece === chemin);
    if (!d || !d.alimente || !d.actif || d.tensionEN === undefined) return [];
    const [bas, haut] = d.seuilsEN;
    const precision = d.indetermine
      ? `Au démarrage, EN de ${chemin} est à ${formater(d.tensionEN, 'V')}, entre les seuils ${formater(bas, 'V')} et ${formater(haut, 'V')} : on ne sait pas si le driver est actif.`
      : `Au démarrage, EN de ${chemin} est à ${formater(d.tensionEN, 'V')}, sous le seuil bas (${formater(bas, 'V')}) : le driver s'active dès la mise sous tension.`;
    return [depuisRegle(chemin, fiche, regle, `${chemin} : EN pas franchement haut au démarrage`, precision, `${chemin}:EN`)];
  },

  // Cas 6 : une broche « entrée seule » reliée à une entrée d'une autre puce.
  'entree-seule': (ctx, chemin, fiche, regle) => {
    const sorties: NouveauConstat[] = [];
    const haut = chemin.split('/')[0];
    for (const b of fiche.broches) {
      if ((b['capacites'] as { sortie?: boolean } | undefined)?.sortie !== false) continue;
      const noeud = ctx.grossier.noeudDe(`${chemin}:${b.nom}`);
      const cibles = (noeud?.points ?? []).filter((p) => {
        if (p.includes('/') || p.slice(0, p.indexOf(':')) === haut) return false;
        const info = brocheDe(p, ctx.calcul.fiches);
        return info !== undefined && ['entree_logique', 'configuration'].includes(info.broche.role);
      });
      if (cibles.length === 0) continue;
      const point = pointAffiche(chemin, b.nom, ctx.calcul.fiches);
      sorties.push(depuisRegle(chemin, fiche, regle, `${point} ne peut pas commander ${cibles.join(', ')}`, `${point} (${b.nom}) est reliée à ${cibles.join(', ')}.`, point));
    }
    return sorties;
  },

  // GPIO0 tirée à 0 ou GPIO12 tirée à 1 au démarrage : la puce ne lance pas le programme.
  'broches-de-demarrage': (ctx, chemin, fiche, regle) => {
    const calcul = ctx.demarrage;
    const vdd = calcul.difference(`${chemin}:VDD3P3`, `${chemin}:GND`);
    if (vdd === undefined || vdd < 1) return [];
    const sorties: NouveauConstat[] = [];
    for (const [nom, interdit] of [
      ['GPIO0', 0],
      ['GPIO12', 1],
    ] as const) {
      if (!trouverBroche(fiche, nom) || niveau(calcul, chemin, fiche, nom) !== interdit) continue;
      const point = pointAffiche(chemin, nom, calcul.fiches);
      const v = calcul.difference(`${chemin}:${nom}`, `${chemin}:GND`) ?? 0;
      sorties.push(depuisRegle(chemin, fiche, regle, `${point} forcée à ${interdit} au démarrage`, `Au démarrage, ${nom} est à ${formater(v, 'V')} (niveau ${interdit}).`, point));
    }
    return sorties;
  },

  // Broches de la flash (GPIO6 à GPIO11) utilisées dans le montage.
  'broches-flash': (ctx, chemin, fiche, regle) => {
    const utilisees = fiche.broches.filter((b) => {
      const gpio = /\.GPIO(\d+)$/.exec(b.vers ?? '');
      const n = gpio ? Number(gpio[1]) : -1;
      return n >= 6 && n <= 11 && ctx.montage.connexions.some((c) => [c.de, c.vers].some((x) => x.piece === chemin && x.broche === b.nom));
    });
    return utilisees.map((b) => depuisRegle(chemin, fiche, regle, `${chemin}:${b.nom} est une broche de la flash`, `${chemin}:${b.nom} (${b.vers}) est branchée.`, `${chemin}:${b.nom}`));
  },

  'condensateur-polarite': (ctx, chemin, fiche, regle) => {
    const v = ctx.calcul.difference(`${chemin}:+`, `${chemin}:-`);
    if (v === undefined || v > -1e-3) return [];
    return [depuisRegle(chemin, fiche, regle, `${chemin} monté à l'envers`, `La borne « + » est ${formater(-v, 'V')} sous la borne « − ».`, `${chemin}:+`)];
  },

  'condensateur-surtension': (ctx, chemin, fiche, regle) => {
    const v = ctx.calcul.difference(`${chemin}:+`, `${chemin}:-`);
    const piece = ctx.montage.pieces.find((p) => p.id === chemin);
    const vn = piece?.parametres['tension_nominale'];
    if (v === undefined || typeof vn !== 'number' || Math.abs(v) <= vn) return [];
    return [depuisRegle(chemin, fiche, regle, `${chemin} : ${formater(Math.abs(v), 'V')} pour ${vn} V nominaux`, `Le condensateur voit ${formater(Math.abs(v), 'V')}, au-delà de sa tension nominale de ${vn} V.`, `${chemin}:+`)];
  },

  // Cas 2a : une batterie qui débite au-delà de son courant continu maximal.
  'surintensite-batterie': (ctx, chemin, fiche, regle) => {
    const s = ctx.calcul.sources.find((x) => x.piece === chemin);
    const max = borne(grandeurModele(fiche, 'courant_decharge_continu_max'), 'max');
    if (!s || max === undefined || s.courant <= max) return [];
    return [depuisRegle(chemin, fiche, regle, `${chemin} : ${formater(s.courant, 'A')} débités, risque d'incendie`, `La batterie débite ${formater(s.courant, 'A')}, au-delà des ${formater(max, 'A')} qu'elle supporte en continu.`, `${chemin}:+`)];
  },
};

export function appliquerRegles(ctx: Contexte): { constats: Constat[]; nonCodees: string[] } {
  const constats: Constat[] = [];
  const nonCodees: string[] = [];
  for (const [chemin, fiche] of ctx.calcul.fiches) {
    for (const regle of (fiche['regles'] as Regle[] | undefined) ?? []) {
      const impl = REGLES[regle.id];
      if (!impl) nonCodees.push(`${fiche.id} : règle « ${regle.id} » pas encore codée`);
      else constats.push(...impl(ctx, chemin, fiche, regle).map(constat));
    }
  }
  return { constats, nonCodees: [...new Set(nonCodees)] };
}
