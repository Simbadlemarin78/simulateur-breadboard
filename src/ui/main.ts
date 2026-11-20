// Point d'entrée de l'interface (étape 7) : éditeur du montage sur le plan de travail 2D.
// Ce fichier ne fait que traduire la souris et le clavier en appels à l'éditeur (edition.ts),
// puis redessine le plan (plan.ts). Survoler une broche éclaire tout son nœud.
import { catalogueIntegre as catalogue } from '../moteur/fiches-integrees';
import { MontageInvalide } from '../moteur/montage';
import { brochesDeComposants, construireReseau, type Reseau } from '../moteur/reseau';
import { verifier, type Rapport } from '../moteur/verifications';
import { htmlConstats, htmlEffets, htmlReglages, marquesVerdicts, mesurerCourant, mesurerTension } from './affichage';
import { contexte, messageErreur, outilsAssistant, poserQuestion, type EnvironnementAssistant, type FonctionSample, type MessageChat } from './assistant';
import { diagrammeVide, Editeur, fichesPosables, type Diagramme } from './edition';
import { P, type Point } from './pieces/dessins';
import { cadreDe, dessinerPlan, placerPieces, positionBroche, zoomerCadre, type Cadre, type Placement } from './plan';

const MONTAGES = import.meta.glob<Diagramme>(['../../montages/*.diagram.json', '../../montages/cas/*.diagram.json'], { eager: true, import: 'default' });
const SVG = 'http://www.w3.org/2000/svg';

/** Noms courts de la palette. */
const NOMS_COURTS: Record<string, string> = {
  'breadboard-830': 'Breadboard',
  'esp32-devkitc': 'ESP32 DevKitC',
  'led-rouge-5mm': 'LED rouge',
  'raspberry-pi-5': 'Raspberry Pi 5',
  'tmc2209-module': 'Driver TMC2209',
  '17hs4401': 'Moteur 17HS4401',
  resistance: 'Résistance',
  'condensateur-electrolytique': 'Condensateur',
  'alim-labo': 'Alim de labo',
  'lipo-4s': 'LiPo 4S',
};

function element<T extends Element>(selecteur: string): T {
  const el = document.querySelector<T>(selecteur);
  if (!el) throw new Error(`élément ${selecteur} absent de la page`);
  return el;
}

const etat = element<HTMLParagraphElement>('#etat');
const info = element<HTMLParagraphElement>('#info');
const conteneur = element<HTMLDivElement>('#plan');
const palette = element<HTMLElement>('#palette');
const choixMontage = element<HTMLSelectElement>('#choix-montage');
const boutonAnnuler = element<HTMLButtonElement>('#annuler');
const boutonRetablir = element<HTMLButtonElement>('#retablir');
const boutonSupprimer = element<HTMLButtonElement>('#supprimer');
const boutonExporter = element<HTMLButtonElement>('#exporter');
const champImporter = element<HTMLInputElement>('#importer');
const boutonTension = element<HTMLButtonElement>('#tension');
const ecran = element<HTMLSpanElement>('#ecran');
const texteMesure = element<HTMLParagraphElement>('#mesure');
const panneauReglages = element<HTMLElement>('#reglages');
const panneauResultats = element<HTMLElement>('#resultats');

let editeur = new Editeur(catalogue, diagrammeVide());
let cadre: Cadre | undefined;
let placements = new Map<string, Placement>();
let reseau: Reseau | undefined;
let choix: { piece?: string; fil?: number } = {};

/** Sous tension : le calcul et les verdicts suivent chaque modification. */
let sousTension = false;
let rapport: { pour: Diagramme; rapport: Rapport } | undefined;
let outil: 'editer' | 'mesurer' = 'editer';
/** Multimètre : deux sondes sur des points, ou un fil dont on lit le courant. */
let sondes: { rouge?: string; noir?: string } = {};
let filMesure: number | undefined;

/** Zone du plan choisie par zoom ou déplacement ; undefined : tout le montage (« Ajuster »). */
let vue: Cadre | undefined;
/** Vue en train d'être déplacée (glisser le fond du plan). */
let panoramique: { depart: Point; vue0: Cadre; bouge: boolean } | undefined;
const texteZoom = element<HTMLSpanElement>('#zoom');

function cadreAffiche(): Cadre {
  return vue ?? cadre ?? { x: 0, y: 0, largeur: 800, hauteur: 400 };
}

/** Met le cadre affiché sur le SVG sans tout redessiner, et le pourcentage de zoom. */
function appliquerVue(): void {
  const c = cadreAffiche();
  conteneur.querySelector('svg')?.setAttribute('viewBox', `${c.x} ${c.y} ${c.largeur} ${c.hauteur}`);
  texteZoom.textContent = `${Math.round(((cadre?.largeur ?? c.largeur) / c.largeur) * 100)} %`;
}

/** Zoome d'un facteur autour d'un point du plan (par défaut, le centre de la vue). */
function zoomer(facteur: number, centre?: Point): void {
  const c = cadreAffiche();
  const base = cadre ?? c;
  // Entre 8 fois plus près et 2 fois plus loin que la vue d'ensemble.
  vue = zoomerCadre(c, facteur, centre ?? { x: c.x + c.largeur / 2, y: c.y + c.hauteur / 2 }, base.largeur / 8, base.largeur * 2);
  appliquerVue();
}

function ajuster(): void {
  vue = undefined;
  afficher(true);
}

/** Rapport du moteur pour le montage affiché ; recalculé seulement quand le montage change. */
function rapportCourant(): Rapport {
  if (rapport?.pour !== editeur.diagramme) rapport = { pour: editeur.diagramme, rapport: verifier(editeur.montage(), catalogue) };
  return rapport.rapport;
}

function majMultimetre(): void {
  if (!sousTension) {
    ecran.textContent = '— V';
    texteMesure.textContent = 'Hors tension : clique « Mettre sous tension » pour mesurer.';
    return;
  }
  const r = rapportCourant();
  if (!r.converge) {
    ecran.textContent = 'Err';
    texteMesure.textContent = `Calcul impossible : ${r.message ?? ''}`;
    return;
  }
  const montage = editeur.montage();
  if (filMesure !== undefined) {
    const m = mesurerCourant(r.calcul, montage, filMesure);
    ecran.textContent = m.texte;
    texteMesure.textContent = `Courant ${m.detail}.`;
  } else if (sondes.rouge && sondes.noir) {
    const m = mesurerTension(r.calcul, sondes.rouge, sondes.noir);
    ecran.textContent = m.texte;
    texteMesure.textContent = m.valeur === undefined ? m.detail : `Tension ${m.detail}.`;
  } else {
    ecran.textContent = '— V';
    texteMesure.textContent = sondes.rouge
      ? `Sonde rouge sur ${sondes.rouge} : clique le point où poser la sonde noire.`
      : outil === 'mesurer'
        ? 'Clique un point pour la sonde rouge, puis un autre pour la noire ; ou clique un fil pour lire son courant.'
        : 'Choisis l\'outil Multimètre, puis clique deux points ou un fil.';
  }
}

function majPanneaux(): void {
  const montage = editeur.montage();
  const piece = choix.piece !== undefined ? montage.pieces.find((p) => p.id === choix.piece) : undefined;
  panneauReglages.innerHTML =
    '<h2>Réglages</h2>' +
    (piece ? htmlReglages(piece, montage, (id) => catalogue.fiche(id)) : '<p>Clique une pièce (outil Éditer) pour voir ses réglages : tension et limite de l\'alim, VREF, état des broches de l\'ESP32...</p>');
  panneauResultats.innerHTML =
    '<h2>Verdicts</h2>' +
    (sousTension
      ? htmlConstats(rapportCourant()) + htmlEffets(rapportCourant().effets)
      : '<p>Hors tension. Clique « Mettre sous tension » : l\'appli calcule tensions et courants, puis montre ce qui grille, chauffe ou ne marchera pas.</p>');
  majMultimetre();
}

/** Fil en train d'être tiré : droit jusqu'au lâcher, routé ensuite. */
let filEnCours: { de: string; ligne: SVGLineElement; depart: Point; glisse: boolean } | undefined;
/** Pièce en train d'être déplacée. */
let deplacement: { id: string; origine: Point; prise: Point; elements: SVGElement[]; bouge: boolean; dx: number; dy: number } | undefined;

function message(texte: string, erreur = false): void {
  info.textContent = texte;
  info.classList.toggle('erreur', erreur);
}

function unir(a: Cadre, b: Cadre): Cadre {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, largeur: Math.max(a.x + a.largeur, b.x + b.largeur) - x, hauteur: Math.max(a.y + a.hauteur, b.y + b.hauteur) - y };
}

/** Redessine le plan. Le cadre ne fait que s'agrandir, pour que la vue ne saute pas à chaque geste. */
function afficher(recadrer = false): void {
  const montage = editeur.montage();
  placements = placerPieces(montage);
  reseau = construireReseau(montage, catalogue);
  const juste = cadreDe(placements, 8 * P);
  cadre = recadrer || !cadre ? juste : unir(cadre, juste);
  if (recadrer) vue = undefined;
  // Les sondes ne survivent pas à la disparition de leur point.
  for (const couleur of ['rouge', 'noir'] as const) {
    const point = sondes[couleur];
    if (point && !reseau.noeudDe(point)) sondes = {};
  }
  if (filMesure !== undefined && !montage.connexions.some((c) => c.indice === filMesure)) filMesure = undefined;
  const r = sousTension ? rapportCourant() : undefined;
  conteneur.innerHTML = dessinerPlan(montage, reseau, {
    cadre: cadreAffiche(),
    choix,
    sondes,
    ...(r?.converge ? { verdicts: marquesVerdicts(r, montage), effets: new Map(r.effets.map((e) => [e.piece, e])) } : {}),
  });
  boutonAnnuler.disabled = !editeur.peutAnnuler();
  boutonRetablir.disabled = !editeur.peutRetablir();
  boutonSupprimer.disabled = choix.piece === undefined && choix.fil === undefined;
  appliquerVue();
  boutonTension.textContent = sousTension ? 'Couper le courant' : 'Mettre sous tension';
  boutonTension.classList.toggle('allume', sousTension);
  const fils = montage.connexions.filter((c) => c.couleur !== '').length;
  etat.textContent =
    `${montage.pieces.length} pièces, ${fils} fils, ${montage.connexions.length - fils} broches enfichées.` +
    (r ? (r.converge ? ` Sous tension : ${r.constats.length === 0 ? 'rien à signaler' : `${r.constats.length} constat${r.constats.length > 1 ? 's' : ''}`}.` : ' Sous tension : calcul impossible.') : ' Hors tension.');
  majPanneaux();
}

/** Charge un montage. Au démarrage, il devient le point de départ ; ensuite, Ctrl+Z ramène le précédent. */
function charger(d: Diagramme, premier = false): boolean {
  if (premier) {
    try {
      editeur = new Editeur(catalogue, d);
    } catch (e) {
      message(e instanceof MontageInvalide ? e.message : String(e), true);
      return false;
    }
  } else {
    const refus = editeur.remplacer(d);
    if (refus) {
      message(`Montage illisible : ${refus}`, true);
      return false;
    }
  }
  choix = {};
  sondes = {};
  filMesure = undefined;
  afficher(true);
  return true;
}

function versPlan(e: PointerEvent | MouseEvent): Point {
  const svg = conteneur.querySelector('svg');
  const m = svg?.getScreenCTM();
  if (!svg || !m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function pointDe(el: Element | null): string | undefined {
  return el?.closest<SVGElement>('.broche')?.dataset['point'];
}

// ------------------------------------------------------------------------------- fils
function commencerFil(de: string): void {
  const svg = conteneur.querySelector('svg');
  const [piece, broche] = [de.slice(0, de.indexOf(':')), de.slice(de.indexOf(':') + 1)];
  const depart = positionBroche(placements, piece, broche);
  if (!svg || !depart) return;
  const ligne = document.createElementNS(SVG, 'line');
  ligne.setAttribute('class', 'fil-en-cours');
  for (const [k, v] of [['x1', depart.x], ['y1', depart.y], ['x2', depart.x], ['y2', depart.y]] as const) ligne.setAttribute(k, String(v));
  svg.appendChild(ligne);
  filEnCours = { de, ligne, depart, glisse: false };
  message(`Fil depuis ${de} : lâche-le sur une autre broche ou un trou (Échap pour abandonner).`);
}

function abandonnerFil(): void {
  filEnCours?.ligne.remove();
  filEnCours = undefined;
}

function terminerFil(vers: string): void {
  const de = filEnCours?.de;
  abandonnerFil();
  if (!de) return;
  const refus = editeur.ajouterFil(de, vers);
  afficher();
  if (refus) message(`Fil refusé : ${refus}.`, true);
  else message(`Fil tracé de ${de} à ${vers}.`);
}

// ------------------------------------------------------------------------------- souris
conteneur.addEventListener('pointerdown', (e) => {
  // Molette enfoncée, ou Maj : on déplace la vue, même au-dessus d'une pièce.
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    abandonnerFil();
    commencerPanoramique(e);
    return;
  }
  if (e.button !== 0) return;
  const cible = e.target instanceof Element ? e.target : null;
  const point = pointDe(cible);
  if (outil === 'mesurer') {
    // Multimètre : premier clic = sonde rouge, deuxième = sonde noire ; un fil donne son courant.
    const fil = cible?.closest<SVGElement>('.fil-groupe');
    if (point) {
      filMesure = undefined;
      sondes = !sondes.rouge || sondes.noir ? { rouge: point } : { rouge: sondes.rouge, noir: point };
    } else if (fil) {
      sondes = {};
      filMesure = Number(fil.dataset['connexion']);
    } else {
      commencerPanoramique(e);
      return;
    }
    if (!sousTension) message('Hors tension : mets le montage sous tension pour lire une valeur.');
    afficher();
    e.preventDefault();
    return;
  }
  if (filEnCours) {
    // Deuxième clic du mode « clic, puis clic » : sur une broche, le fil est tracé.
    if (point && point !== filEnCours.de) terminerFil(point);
    else {
      abandonnerFil();
      message('Fil abandonné.');
    }
    e.preventDefault();
    return;
  }
  if (point) {
    commencerFil(point);
    conteneur.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  const fil = cible?.closest<SVGElement>('.fil-groupe');
  if (fil) {
    choix = { fil: Number(fil.dataset['connexion']) };
    afficher();
    message(`Fil choisi : ${fil.querySelector('title')?.textContent ?? ''}. Suppr pour l'enlever.`);
    return;
  }
  const groupe = cible?.closest<SVGGElement>('.piece');
  const id = groupe?.dataset['piece'];
  const pl = id ? placements.get(id) : undefined;
  if (id && pl) {
    // Les pièces enfichées dans une breadboard qu'on déplace bougent avec elle.
    const ids = new Set([id]);
    if (pl.piece.fiche.modele?.type === 'breadboard') {
      for (const c of editeur.montage().connexions) {
        if (c.couleur === '' && c.vers.piece === id) ids.add(c.de.piece);
        if (c.couleur === '' && c.de.piece === id) ids.add(c.vers.piece);
      }
    }
    const elements = [...conteneur.querySelectorAll<SVGElement>('.piece, .broche')].filter((el) => {
      const p = el.dataset['piece'] ?? el.dataset['point']?.split(':')[0];
      return p !== undefined && ids.has(p);
    });
    deplacement = { id, origine: { x: pl.x, y: pl.y }, prise: versPlan(e), elements, bouge: false, dx: 0, dy: 0 };
    conteneur.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  // Le fond : on déplace la vue (un simple clic, sans bouger, efface la sélection).
  commencerPanoramique(e);
});

function commencerPanoramique(e: PointerEvent): void {
  panoramique = { depart: { x: e.clientX, y: e.clientY }, vue0: cadreAffiche(), bouge: false };
  conteneur.setPointerCapture(e.pointerId);
  e.preventDefault();
}

// Molette (ou pincement du pavé tactile) : zoom autour de la souris.
conteneur.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoomer(Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 40 : 1)), versPlan(e));
  },
  { passive: false },
);

conteneur.addEventListener('pointermove', (e) => {
  if (panoramique) {
    const svg = conteneur.querySelector('svg');
    const echelle = svg ? panoramique.vue0.largeur / svg.clientWidth : 1;
    const dx = e.clientX - panoramique.depart.x;
    const dy = e.clientY - panoramique.depart.y;
    if (Math.hypot(dx, dy) > 3) panoramique.bouge = true;
    if (panoramique.bouge) {
      vue = { ...panoramique.vue0, x: panoramique.vue0.x - dx * echelle, y: panoramique.vue0.y - dy * echelle };
      appliquerVue();
    }
    return;
  }
  const p = versPlan(e);
  if (filEnCours) {
    filEnCours.ligne.setAttribute('x2', String(p.x));
    filEnCours.ligne.setAttribute('y2', String(p.y));
    if (Math.hypot(p.x - filEnCours.depart.x, p.y - filEnCours.depart.y) > 4) filEnCours.glisse = true;
    return;
  }
  if (!deplacement) return;
  deplacement.dx = p.x - deplacement.prise.x;
  deplacement.dy = p.y - deplacement.prise.y;
  if (Math.hypot(deplacement.dx, deplacement.dy) > 2) deplacement.bouge = true;
  for (const el of deplacement.elements) {
    if (el.classList.contains('piece')) {
      const [x0, y0] = (el.dataset['origine'] ??= el.getAttribute('transform')?.match(/-?[\d.]+/g)?.join(' ') ?? '0 0').split(' ').map(Number);
      el.setAttribute('transform', `translate(${(x0 ?? 0) + deplacement.dx} ${(y0 ?? 0) + deplacement.dy})`);
    } else el.setAttribute('transform', `translate(${deplacement.dx} ${deplacement.dy})`);
  }
});

conteneur.addEventListener('pointerup', (e) => {
  if (panoramique) {
    const { bouge } = panoramique;
    panoramique = undefined;
    if (!bouge && outil === 'editer' && (choix.piece !== undefined || choix.fil !== undefined)) {
      choix = {};
      afficher();
    }
    return;
  }
  if (filEnCours) {
    const point = pointDe(document.elementFromPoint(e.clientX, e.clientY));
    if (point && point !== filEnCours.de) terminerFil(point);
    else if (filEnCours.glisse) {
      abandonnerFil();
      message('Fil abandonné : il faut le lâcher sur une broche ou un trou.');
    } else message(`Fil depuis ${filEnCours.de} : clique une autre broche ou un trou pour le finir (Échap pour abandonner).`);
    return;
  }
  if (!deplacement) return;
  const { id, origine, bouge, dx, dy } = deplacement;
  deplacement = undefined;
  if (!bouge) {
    choix = { piece: id };
    afficher();
    const fiche = placements.get(id)?.piece.fiche;
    message(`${id} : ${fiche?.nom ?? ''}. Glisse-la pour la déplacer, Suppr pour l'enlever.`);
    return;
  }
  const refus = editeur.deplacerPiece(id, origine.x + dx, origine.y + dy);
  choix = { piece: id };
  afficher();
  if (refus) message(`Déplacement refusé : ${refus}.`, true);
  else {
    const enfichees = editeur.montage().connexions.filter((c) => c.couleur === '' && (c.de.piece === id || c.vers.piece === id)).length;
    const bb = placements.get(id)?.piece.fiche.modele?.type === 'breadboard';
    message(bb ? `${id} déplacée, avec les pièces enfichées.` : enfichees > 0 ? `${id} enfichée : ${enfichees} broches dans les trous.` : `${id} posée (pas dans la breadboard).`);
  }
});

// Survoler une broche éclaire tout son nœud.
let allume = '';
conteneur.addEventListener('mouseover', (e) => {
  if (filEnCours || deplacement) return;
  const cible = e.target instanceof Element ? e.target.closest<SVGElement>('.broche') : null;
  const noeud = cible?.dataset['noeud'] ?? '';
  if (noeud === allume) return;
  conteneur.querySelectorAll('.broche.allumee').forEach((el) => el.classList.remove('allumee'));
  allume = noeud;
  if (!cible || noeud === '' || !reseau) return;
  conteneur.querySelectorAll(`.broche[data-noeud="${noeud}"]`).forEach((el) => el.classList.add('allumee'));
  const n = reseau.noeuds[Number(noeud)];
  const composants = n ? brochesDeComposants(n, editeur.montage()) : [];
  message(`${cible.dataset['point'] ?? ''} — ${composants.length > 0 ? `relié à : ${composants.join(', ')}` : 'relié à aucune broche de composant'}`);
});

// ------------------------------------------------------------------------------- commandes
function supprimerChoix(): void {
  let refus: string | undefined;
  if (choix.fil !== undefined) refus = editeur.supprimerFil(choix.fil);
  else if (choix.piece !== undefined) refus = editeur.supprimerPiece(choix.piece);
  else return;
  choix = {};
  afficher();
  message(refus ? `Suppression refusée : ${refus}.` : 'Supprimé.', refus !== undefined);
}

function annuler(): void {
  if (editeur.annuler()) {
    choix = {};
    afficher();
    message('Annulé.');
  }
}

function retablir(): void {
  if (editeur.retablir()) {
    choix = {};
    afficher();
    message('Rétabli.');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    abandonnerFil();
    if (choix.piece !== undefined || choix.fil !== undefined) {
      choix = {};
      afficher();
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    supprimerChoix();
    e.preventDefault();
  } else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    annuler();
    e.preventDefault();
  } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    retablir();
    e.preventDefault();
  } else if (!ctrl && (e.key === '+' || e.key === '=')) zoomer(1.25);
  else if (!ctrl && e.key === '-') zoomer(1 / 1.25);
  else if (!ctrl && e.key === '0') ajuster();
});

element<HTMLButtonElement>('#zoom-plus').addEventListener('click', () => zoomer(1.25));
element<HTMLButtonElement>('#zoom-moins').addEventListener('click', () => zoomer(1 / 1.25));
element<HTMLButtonElement>('#zoom-ajuster').addEventListener('click', ajuster);

boutonTension.addEventListener('click', () => {
  sousTension = !sousTension;
  afficher();
  if (!sousTension) message('Courant coupé.');
  else {
    const r = rapportCourant();
    message(r.converge ? (r.constats.length === 0 ? 'Sous tension : rien à signaler.' : `Sous tension : ${r.constats.length} constats, détaillés plus bas.`) : `Calcul impossible : ${r.message ?? ''}`, !r.converge);
  }
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="outil"]')) {
  radio.addEventListener('change', () => {
    outil = radio.value === 'mesurer' ? 'mesurer' : 'editer';
    abandonnerFil();
    if (outil === 'editer') {
      sondes = {};
      filMesure = undefined;
    }
    afficher();
    message(outil === 'mesurer' ? 'Multimètre : clique un point (sonde rouge), puis un autre (sonde noire), ou un fil.' : 'Édition : glisse les pièces, tire les fils.');
  });
}

// Réglages : chaque changement passe par l'éditeur, donc s'annule avec Ctrl+Z.
panneauReglages.addEventListener('change', (e) => {
  const id = choix.piece;
  const champ = e.target;
  if (!id || !(champ instanceof HTMLInputElement || champ instanceof HTMLSelectElement)) return;
  let refus: string | undefined;
  if (champ.dataset['param']) {
    const nom = champ.dataset['param'];
    const valeur =
      champ instanceof HTMLInputElement && champ.type === 'checkbox' ? champ.checked
      : champ instanceof HTMLInputElement && champ.type === 'number' ? (champ.value === '' ? undefined : Number(champ.value))
      : champ.value;
    refus = editeur.reglerPiece(id, nom, valeur);
  } else if (champ.dataset['etat']) {
    refus = editeur.reglerBroche(id, champ.dataset['etat'], champ.value);
  } else if (champ.dataset['frequence']) {
    const f = Number(champ.value);
    if (!(f > 0)) refus = 'la fréquence doit être un nombre de Hz au-dessus de 0';
    else refus = editeur.reglerBroche(id, champ.dataset['frequence'], 'impulsions', f);
  } else return;
  afficher();
  message(refus ? `Réglage refusé : ${refus}.` : `${id} réglée${sousTension ? ' : calcul relancé' : ''}.`, refus !== undefined);
});

// Un clic sur un verdict choisit la pièce concernée.
panneauResultats.addEventListener('click', (e) => {
  const li = e.target instanceof Element ? e.target.closest<HTMLElement>('.constat, .effet') : null;
  const piece = li?.dataset['piece'];
  if (!piece || !placements.has(piece)) return;
  choix = { piece };
  afficher();
});

boutonAnnuler.addEventListener('click', annuler);
boutonRetablir.addEventListener('click', retablir);
boutonSupprimer.addEventListener('click', supprimerChoix);

/** Hôte claude.ai : présent seulement quand la page est publiée comme Artifact. */
interface HoteClaude {
  use(nom: string): Promise<unknown>;
}
const hote = (window as unknown as { claude?: HoteClaude }).claude;

boutonExporter.addEventListener('click', async () => {
  // Sur claude.ai, la page ne peut pas télécharger elle-même : elle passe par la capacité « downloads ».
  const telechargements = (hote ? await hote.use('downloads').catch(() => null) : null) as { save(r: { filename: string; data: string }): Promise<unknown> } | null;
  if (telechargements) {
    try {
      await telechargements.save({ filename: 'montage.diagram.json', data: editeur.exporter() });
      message('diagram.json enregistré.');
    } catch (e) {
      const code = (e as { code?: string }).code;
      message(code === 'declined' ? 'Export annulé.' : `Export impossible ici (${code ?? 'erreur'}).`, code !== 'declined');
    }
    return;
  }
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([editeur.exporter()], { type: 'application/json' }));
  lien.download = 'montage.diagram.json';
  lien.click();
  URL.revokeObjectURL(lien.href);
  message('diagram.json exporté (montage.diagram.json, dans tes téléchargements).');
});

champImporter.addEventListener('change', async () => {
  const fichier = champImporter.files?.[0];
  champImporter.value = '';
  if (!fichier) return;
  let donnees: unknown;
  try {
    donnees = JSON.parse(await fichier.text());
  } catch {
    message(`Import impossible : ${fichier.name} n'est pas du JSON valide.`, true);
    return;
  }
  if (charger(donnees as Diagramme)) message(`${fichier.name} importé (Ctrl+Z pour revenir au montage précédent).`);
});

// Palette : une pièce posée sous le montage, à glisser ensuite où l'on veut.
for (const fiche of fichesPosables(catalogue)) {
  const bouton = document.createElement('button');
  bouton.textContent = NOMS_COURTS[fiche.id] ?? fiche.nom;
  bouton.title = fiche.nom;
  bouton.addEventListener('click', () => {
    const occupe = cadreDe(placements, 0);
    const x = placements.size > 0 ? occupe.x : 0;
    const y = placements.size > 0 ? occupe.y + occupe.hauteur + 4 * P : 0;
    const id = editeur.ajouterPiece(fiche.id, x, y);
    choix = { piece: id };
    // Zoomé, on amène la vue sur la nouvelle pièce pour qu'elle soit visible.
    if (vue) {
      const pl = placerPieces(editeur.montage()).get(id);
      if (pl) vue = { ...vue, x: pl.x + pl.dessin.largeur / 2 - vue.largeur / 2, y: pl.y + pl.dessin.hauteur / 2 - vue.hauteur / 2 };
    }
    afficher();
    message(`${id} posée sous le montage : glisse-la où tu veux (sur la breadboard pour l'enficher).`);
  });
  palette.appendChild(bouton);
}

// Montages fournis : la base roulante, sa version corrigée et les cas de test.
const nomMontage = (chemin: string): string => {
  const base = chemin.split('/').pop()!.replace('.diagram.json', '');
  if (base === 'base-roulante') return 'Base roulante (proposée)';
  if (base === 'base-roulante-corrigee') return 'Base roulante corrigée';
  const cas = /^cas-(\d+)([ab]?)-(.*)$/.exec(base);
  return cas ? `Cas ${Number(cas[1])}${cas[2]} : ${cas[3]!.replace(/-/g, ' ')}` : base;
};
const options: [string, string][] = [['vide', 'Montage vide'], ...Object.keys(MONTAGES).sort().map((c) => [c, nomMontage(c)] as [string, string])];
options.sort((a, b) => (a[0].includes('/cas/') ? 1 : 0) - (b[0].includes('/cas/') ? 1 : 0));
for (const [valeur, texte] of options) choixMontage.add(new Option(texte, valeur));
choixMontage.addEventListener('change', () => {
  const d = choixMontage.value === 'vide' ? diagrammeVide() : MONTAGES[choixMontage.value];
  if (d && charger(d)) message(`${choixMontage.selectedOptions[0]?.textContent ?? ''} chargé (Ctrl+Z pour revenir au montage précédent).`);
});

const depart = Object.keys(MONTAGES).find((c) => c.endsWith('/base-roulante.diagram.json'));
if (depart) {
  choixMontage.value = depart;
  charger(MONTAGES[depart]!, true);
}
message('Survole une broche ou un trou : tout ce qui lui est relié s\'allume.');

// ------------------------------------------------------------------------------- assistant
// La fenêtre n'apparaît que sur claude.ai, quand la page peut interroger Claude (capacité « sample »).
const sectionAssistant = element<HTMLElement>('#assistant');
const listeChat = element<HTMLOListElement>('#chat-messages');
const etatChat = element<HTMLParagraphElement>('#chat-etat');
const formulaireChat = element<HTMLFormElement>('#chat-formulaire');
const questionChat = element<HTMLTextAreaElement>('#chat-question');
const boutonEnvoyer = element<HTMLButtonElement>('#chat-envoyer');
const boutonArreter = element<HTMLButtonElement>('#chat-arreter');
const boutonEffacer = element<HTMLButtonElement>('#chat-effacer');
const conversation: MessageChat[] = [];
let controleurChat: AbortController | undefined;

const environnementAssistant: EnvironnementAssistant = {
  catalogue,
  editeur: () => editeur,
  apresModification: (resume) => {
    afficher();
    message(`Assistant : ${resume} (Ctrl+Z pour annuler).`);
  },
  progression: (texte) => {
    etatChat.textContent = texte;
  },
};

function bulle(classe: 'question' | 'reponse', texte: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = classe;
  li.textContent = texte;
  listeChat.appendChild(li);
  listeChat.scrollTop = listeChat.scrollHeight;
  return li;
}

async function demarrerAssistant(): Promise<void> {
  if (!hote) return;
  const sample = (await hote.use('sample').catch(() => null)) as (FonctionSample & { limits?(): Promise<{ tools?: { maxCount: number } }> }) | null;
  if (!sample) return;
  const limites = (await sample.limits?.().catch(() => null)) ?? null;
  let maxOutils = limites?.tools?.maxCount ?? 0;
  sectionAssistant.hidden = false;

  formulaireChat.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = questionChat.value.trim();
    if (!question || controleurChat) return;
    questionChat.value = '';
    bulle('question', question);
    const reponse = bulle('reponse', 'Réfléchit…');
    controleurChat = new AbortController();
    boutonEnvoyer.disabled = true;
    boutonArreter.hidden = false;
    const outils = maxOutils > 0 ? outilsAssistant(environnementAssistant).slice(0, maxOutils) : [];
    // Sans outils dans cette vue, on joint à la question le montage et ses verdicts (sans les garder ensuite).
    const donnees =
      outils.length === 0
        ? `\n[Données du simulateur, à jour]\n${JSON.stringify({
            montage: outilsAssistant(environnementAssistant).find((o) => o.name === 'lire_montage')!.execute({}),
            verdicts: outilsAssistant(environnementAssistant).find((o) => o.name === 'lire_verdicts')!.execute({}),
          })}`
        : '';
    const ecran = contexte(environnementAssistant, choix, sousTension);
    try {
      const r = await poserQuestion(sample, conversation, question + donnees, {
        outils,
        signal: controleurChat.signal,
        contexte: ecran,
        onText: (texte) => {
          reponse.textContent = texte;
          listeChat.scrollTop = listeChat.scrollHeight;
        },
      });
      reponse.textContent = r.texte + (r.tronque ? '\n(Réponse coupée : demande moins à la fois.)' : '');
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'upstream_error';
      if (code === 'tools_unavailable') maxOutils = 0;
      const { texte, cacher } = messageErreur(code);
      const partiel = (err as { text?: string }).text;
      reponse.textContent = partiel ? `${partiel}\n— ${texte}` : texte;
      reponse.classList.add('erreur');
      if (cacher) formulaireChat.hidden = true;
    } finally {
      // La question gardée pour la suite, sans les données jointes.
      const derniere = [...conversation].reverse().find((m) => m.role === 'user');
      if (derniere && donnees) derniere.content = `${ecran}\n${question}`;
      controleurChat = undefined;
      boutonEnvoyer.disabled = false;
      boutonArreter.hidden = true;
      etatChat.textContent = '';
      listeChat.scrollTop = listeChat.scrollHeight;
    }
  });

  questionChat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formulaireChat.requestSubmit();
    }
  });
  boutonArreter.addEventListener('click', () => controleurChat?.abort());
  boutonEffacer.addEventListener('click', () => {
    controleurChat?.abort();
    conversation.length = 0;
    listeChat.replaceChildren();
    etatChat.textContent = '';
  });
}

void demarrerAssistant();
