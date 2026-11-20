// Étape 8 : ce que la page affiche sous tension, sans navigateur (testable) : mesures du
// multimètre, verdicts à poser sur les pièces, les fils et les trous, panneau des explications
// et panneau des réglages d'une pièce. Toutes les valeurs viennent du moteur, sans recalcul.
import { etatDemarrage, type Calcul } from '../moteur/circuit';
import { formater, NOMS_VERDICTS, texteSource, VERDICTS, type Verdict } from '../moteur/constats';
import { trouverBroche, type Fiche } from '../moteur/fiche';
import type { Effet } from '../moteur/effets';
import { ETATS_BROCHE, FREQUENCE_DEFAUT, type EtatBroche, type Montage, type Piece } from '../moteur/montage';
import type { Rapport } from '../moteur/verifications';
import { echapper } from './pieces/dessins';

export interface Mesure {
  /** Valeur du moteur (V ou A), undefined si elle n'existe pas. */
  valeur?: number;
  /** Ce qu'affiche l'écran du multimètre. */
  texte: string;
  /** Ce qui a été mesuré, en clair. */
  detail: string;
}

/** Tension entre la sonde rouge et la sonde noire, comme la donne le moteur. */
export function mesurerTension(calcul: Calcul, rouge: string, noir: string): Mesure {
  const v = calcul.difference(rouge, noir);
  if (v === undefined) return { texte: '— V', detail: `Rien ne relie ${rouge} et ${noir} : leur écart de tension n'est pas défini.` };
  return { valeur: v, texte: formater(v, 'V'), detail: `entre ${rouge} (sonde rouge) et ${noir} (sonde noire)` };
}

/** Courant dans une connexion (rang « indice » dans le diagram.json), sens indiqué. */
export function mesurerCourant(calcul: Calcul, montage: Montage, indice: number): Mesure {
  const k = montage.connexions.findIndex((c) => c.indice === indice);
  const c = montage.connexions[k];
  const i = k >= 0 ? calcul.courantFil(k) : undefined;
  if (!c || i === undefined) return { texte: '— A', detail: 'pas de courant calculé pour cette connexion' };
  const [de, vers] = i >= 0 ? [c.de, c.vers] : [c.vers, c.de];
  return { valeur: i, texte: formater(Math.abs(i), 'A'), detail: `dans le fil, de ${de.piece}:${de.broche} vers ${vers.piece}:${vers.broche}` };
}

/** Verdicts à poser sur le plan : pièces, fils (rang dans le diagram.json) et points (trous, broches). */
export interface Marques {
  pieces: Map<string, Verdict>;
  fils: Map<number, Verdict>;
  points: Map<string, Verdict>;
}

const plusGrave = (a: Verdict | undefined, b: Verdict): Verdict => (a === undefined || VERDICTS.indexOf(b) < VERDICTS.indexOf(a) ? b : a);

export function marquesVerdicts(rapport: Rapport, montage: Montage): Marques {
  const marques: Marques = { pieces: new Map(), fils: new Map(), points: new Map() };
  const breadboards = new Set(montage.pieces.filter((p) => p.fiche.modele?.type === 'breadboard').map((p) => p.id));
  for (const c of rapport.constats) {
    if (c.piece === 'fil' && c.connexion !== undefined) {
      const indice = montage.connexions[c.connexion]?.indice;
      if (indice !== undefined) marques.fils.set(indice, plusGrave(marques.fils.get(indice), c.verdict));
    } else if (breadboards.has(c.piece)) {
      // Un contact de breadboard : on marque le trou, pas toute la breadboard.
      if (c.point) marques.points.set(c.point, plusGrave(marques.points.get(c.point), c.verdict));
    } else marques.pieces.set(c.piece, plusGrave(marques.pieces.get(c.piece), c.verdict));
  }
  return marques;
}

/** Panneau des explications : chaque constat avec son verdict, sa valeur, sa limite, sa source et sa correction. */
export function htmlConstats(rapport: Rapport): string {
  if (!rapport.converge) return `<p class="erreur">Calcul impossible : ${echapper(rapport.message ?? '')}</p>`;
  const nonSimule = rapport.nonSimule.length
    ? `<p class="non-simule">Non simulé : ${rapport.nonSimule.map(echapper).join(' ; ')}</p>`
    : '';
  if (rapport.constats.length === 0) {
    return `<p class="rien">Rien à signaler : aucune limite dépassée, aucune règle en défaut.</p>${nonSimule}`;
  }
  const items = rapport.constats.map((c, i) => {
    const source = c.source ? `<p class="source">Source : ${echapper(texteSource(c.source))}${c.brouillon ? ' — fiche en brouillon' : ''}</p>` : '';
    const correction = c.correction ? `<p class="correction">À faire : ${echapper(c.correction)}</p>` : '';
    return (
      `<li class="constat verdict-${c.verdict}" data-constat="${i}" data-piece="${echapper(c.piece)}">` +
      `<span class="badge">${NOMS_VERDICTS[c.verdict]}</span> <strong>${echapper(c.titre)}</strong>` +
      ` <span class="origine">${c.origine === 'calcul' ? 'calcul' : `règle ${echapper(c.regle ?? '')}`}</span>` +
      `<p>${echapper(c.explication)}</p>${correction}${source}</li>`
    );
  });
  const resume = VERDICTS.map((v) => [v, rapport.constats.filter((c) => c.verdict === v).length] as const)
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${n} ${NOMS_VERDICTS[v]}`)
    .join(', ');
  return `<p class="resume">${rapport.constats.length} constat${rapport.constats.length > 1 ? 's' : ''} : ${resume}.</p><ol class="constats">${items.join('')}</ol>${nonSimule}`;
}

const NOMS_ETATS: Record<EtatBroche, string> = {
  entree: 'entrée (en l\'air)',
  entree_tirage_haut: 'entrée, tirage haut',
  entree_tirage_bas: 'entrée, tirage bas',
  sortie_haute: 'sortie haute (1)',
  sortie_basse: 'sortie basse (0)',
  impulsions: 'impulsions (STEP)',
};

/** Broches de microcontrôleur réglables : celles d'une carte qui renvoient à une broche capable d'entrée-sortie, et qui sont branchées. */
export function brochesReglables(piece: Piece, montage: Montage, fiches: (id: string) => Fiche | undefined): { nom: string; demarrage: EtatBroche; sortie: boolean }[] {
  if (piece.fiche.modele?.type !== 'microcontroleur') return [];
  const branchees = new Set(montage.connexions.flatMap((c) => [c.de, c.vers]).filter((e) => e.piece === piece.id).map((e) => e.broche));
  return piece.fiche.broches.flatMap((b) => {
    if (!branchees.has(b.nom) || !['entree_sortie_logique', 'entree_logique'].includes(b.role)) return [];
    const [ref, cible] = (b.vers ?? '').split('.');
    const sous = piece.fiche.sous_composants?.find((s) => s.ref === ref);
    const puce = sous ? fiches(sous.fiche) : undefined;
    const bp = puce && cible ? trouverBroche(puce, cible) : b;
    if (!bp?.['entree'] && !bp?.['sortie']) return [];
    return [{ nom: b.nom, demarrage: etatDemarrage(bp), sortie: (bp['capacites'] as { sortie?: boolean } | undefined)?.sortie !== false }];
  });
}

/** Panneau des réglages d'une pièce : ses paramètres, et l'état de ses broches pour un microcontrôleur. */
export function htmlReglages(piece: Piece, montage: Montage, fiches: (id: string) => Fiche | undefined): string {
  const lignes: string[] = [];
  for (const [nom, def] of Object.entries(piece.fiche.parametres ?? {})) {
    const valeur = piece.parametres[nom];
    const titre = `title="${echapper(def.description)}"`;
    if (typeof def.defaut === 'boolean') {
      lignes.push(`<label ${titre}><input type="checkbox" data-param="${echapper(nom)}"${valeur === true ? ' checked' : ''}> ${echapper(nom.replace(/_/g, ' '))}</label>`);
    } else if (def.choix) {
      const options = def.choix.map((ch) => `<option value="${echapper(String(ch))}"${String(ch) === String(valeur) ? ' selected' : ''}>${echapper(String(ch))}</option>`).join('');
      lignes.push(`<label ${titre}>${echapper(nom.replace(/_/g, ' '))} <select data-param="${echapper(nom)}">${options}</select></label>`);
    } else {
      const bornes = `${def.min !== undefined ? ` min="${def.min}"` : ''}${def.max !== undefined ? ` max="${def.max}"` : ''}`;
      const unite = def.unite === '1' ? '' : ` ${echapper(def.unite)}`;
      lignes.push(
        `<label ${titre}>${echapper(nom.replace(/_/g, ' '))} <input type="number" step="any"${bornes} data-param="${echapper(nom)}" value="${valeur === undefined ? '' : echapper(String(valeur))}" placeholder="—">${unite}</label>`,
      );
    }
  }
  const broches = brochesReglables(piece, montage, fiches);
  if (broches.length > 0) {
    lignes.push('<p class="sous-titre">État des broches (réglé à la main, faute d\'émuler le programme)</p>');
    for (const b of broches) {
      const actuel = piece.etats[b.nom];
      const options = [`<option value="">au démarrage : ${NOMS_ETATS[b.demarrage]}</option>`]
        .concat(
          ETATS_BROCHE.filter((e) => b.sortie || (!e.startsWith('sortie') && e !== 'impulsions')).map(
            (e) => `<option value="${e}"${actuel === e ? ' selected' : ''}>${NOMS_ETATS[e]}</option>`,
          ),
        )
        .join('');
      // Impulsions : leur fréquence, en Hz (une impulsion = un micro-pas pour un driver).
      const frequence =
        actuel === 'impulsions'
          ? ` <input type="number" min="1" step="any" data-frequence="${echapper(b.nom)}" value="${piece.frequences[b.nom] ?? FREQUENCE_DEFAUT}" title="Impulsions par seconde"> Hz`
          : '';
      lignes.push(`<label>${echapper(b.nom)} <select data-etat="${echapper(b.nom)}">${options}</select>${frequence}</label>`);
    }
  }
  if (lignes.length === 0) lignes.push('<p>Rien à régler sur cette pièce.</p>');
  return `<p class="sous-titre">${echapper(piece.id)} : ${echapper(piece.fiche.nom)}</p>${lignes.join('')}`;
}

/** Nombre à la française, avec n décimales. */
function nombre(x: number, n = 0): string {
  return x.toFixed(n).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Panneau des effets sous tension : pour chaque moteur, ce qui le fait tourner (ou l'en empêche),
 * sa vitesse, son couple et la vitesse au-delà de laquelle le driver ne tient plus le courant ;
 * pour chaque LED, son courant et son intensité.
 */
export function htmlEffets(effets: Effet[]): string {
  if (effets.length === 0) return '';
  const items = effets.map((e) => {
    if (e.type === 'led') {
      return `<li class="effet" data-piece="${echapper(e.piece)}"><strong>${echapper(e.piece)}</strong> ${e.eclat > 0 ? 'allumée' : 'éteinte'} : ${echapper(e.raison)}</li>`;
    }
    if (!e.tourne) return `<li class="effet" data-piece="${echapper(e.piece)}"><strong>${echapper(e.piece)}</strong> à l'arrêt : ${echapper(e.raison)}</li>`;
    const details: string[] = [];
    if (e.toursParSeconde !== undefined) {
      const tps = Math.abs(e.toursParSeconde);
      details.push(`${nombre(tps * 60)} tr/min (${nombre(tps * (e.pasParTour ?? 200), 0)} pas complets/s)`);
    }
    if (e.microPas !== undefined) details.push(`${e.microPas} micro-pas (${e.reglageMicroPas === 'UART' ? 'réglés par le programme' : 'MS1/MS2'})`);
    if (e.sens !== undefined) details.push(`sens ${e.sens > 0 ? '+ (DIR à 0)' : '− (DIR à 1)'}`);
    if (e.courant !== undefined) details.push(`${formater(e.courant, 'A')} par bobine`);
    if (e.coupleArret !== undefined) details.push(`couple à l'arrêt ≈ ${nombre(e.coupleArret, 2)} N·m`);
    if (e.vitesseMax !== undefined) details.push(`le driver tient ce courant jusqu'à ≈ ${nombre(e.vitesseMax * 60)} tr/min`);
    if (e.couple !== undefined && e.coupleArret !== undefined && e.couple < e.coupleArret * 0.999) {
      details.push(`à cette vitesse : ${formater(e.courantEffectif ?? 0, 'A')}, couple ≈ ${nombre(e.couple, 2)} N·m (${nombre((100 * e.couple) / e.coupleArret)} %)`);
    }
    if (e.roue) details.push(`roue de ${nombre(e.roue.diametre * 1000)} mm : ${nombre(Math.abs(e.roue.vitesse), 2)} m/s au sol`);
    return `<li class="effet" data-piece="${echapper(e.piece)}"><strong>${echapper(e.piece)}</strong> tourne : ${echapper(e.raison)}<br>${details.map(echapper).join(' · ')}</li>`;
  });
  return `<h3>Ce qui bouge et s'allume</h3><ul class="effets">${items.join('')}</ul><p class="discret">Vitesse max et couple : estimation au premier ordre (datasheet du TMC2209, p. 43-44), moteur à vide.</p>`;
}
