// Assistant du simulateur : une fenêtre de chat où l'on demande à Claude à quoi sert un
// composant, pourquoi le montage marche ou ne marche pas, ou de poser une pièce et tracer un fil.
//
// Claude est appelé par la capacité « sample » d'un Artifact claude.ai, avec le compte de la
// personne qui regarde la page : il ne voit que la conversation que la page lui envoie, et ne
// connaît le montage qu'à travers les outils ci-dessous, qui sont des fonctions de la page.
// Le moteur calcule, Claude explique : chaque chiffre qu'il cite vient d'un outil (calcul ou
// fiche sourcée), jamais de sa mémoire. Hors de claude.ai (GitHub Pages), la fenêtre est cachée.
//
// Ce fichier ne touche pas au navigateur : les outils travaillent sur l'éditeur et le moteur,
// et le dialogue reçoit la fonction « sample » en argument. Testable avec Vitest.
import type { Catalogue } from '../moteur/catalogue';
import { NOMS_VERDICTS, texteSource } from '../moteur/constats';
import { trouverBroche, type Fiche } from '../moteur/fiche';
import { ETATS_BROCHE } from '../moteur/montage';
import { verifier, type Rapport } from '../moteur/verifications';
import { mesurerCourant, mesurerTension } from './affichage';
import type { Editeur } from './edition';
import { cadreDe, placerPieces } from './plan';
import { P } from './pieces/dessins';

/** Un tour de conversation, comme l'attend la capacité « sample ». */
export interface MessageChat {
  role: 'user' | 'assistant';
  content: string;
}

/** Un outil offert à Claude : une fonction de la page (forme de la capacité « sample »). */
export interface OutilAssistant {
  name: string;
  description: string;
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  execute(input: Record<string, unknown>): unknown;
}

/** Ce que les outils lisent et modifient. */
export interface EnvironnementAssistant {
  catalogue: Catalogue;
  /** L'éditeur du montage affiché. */
  editeur(): Editeur;
  /** Appelé après chaque modification du montage par un outil (redessiner la page). */
  apresModification(resume: string): void;
  /** Appelé quand un outil commence, pour montrer ce que fait l'assistant. */
  progression?(texte: string): void;
}

/** La fonction « sample » de la capacité, réduite à ce que l'assistant utilise. */
export type FonctionSample = (
  input: MessageChat[],
  options: { tools?: OutilAssistant[]; onText?: (u: { text: string; delta: string }) => void; signal?: AbortSignal; cache?: false; modelTier?: 'quick' | 'default' | 'complex' },
) => Promise<{ text: string; truncated: boolean }>;

/** Consignes, envoyées en tête de chaque appel (Claude ne garde rien entre deux appels). */
export const CONSIGNES = `Tu es l'assistant d'un simulateur de breadboard : une appli web où l'on pose des composants sur un plan de travail 2D, trace les fils, met sous tension et lit des verdicts (grillé, risque élevé, risque, chauffe, ne marchera pas). Son auteur, Jean, est élève ingénieur et débutant en électronique ; il prépare un robot (ESP32, 4 drivers TMC2209, 4 moteurs pas à pas 17HS4401, alim de labo 12 V puis LiPo 4S).

Règles :
- Réponds en français, tutoie, phrases courtes. Explique en une ligne chaque terme technique la première fois. Vise moins de 150 mots, sauf si on te demande plus.
- Le montage, les verdicts, les mesures et les fiches des composants ne se lisent qu'avec tes outils : appelle-les avant de répondre sur le montage, ne devine pas.
- Le moteur du simulateur calcule, toi tu expliques. Chaque valeur que tu cites (tension, courant, limite, page de datasheet) vient d'un outil. N'invente jamais une valeur de datasheet. Si une donnée manque, dis-le.
- « Grillé » ne sort que du calcul du moteur. Ce que le moteur ne simule pas (phénomènes brefs, programme de l'ESP32), dis qu'il ne le simule pas.
- Les fiches marquées brouillon n'ont pas encore été relues par Jean : signale-le quand ta réponse en dépend.
- Pour poser une pièce, tracer un fil, changer un réglage ou supprimer, utilise les outils ; chaque modification s'annule avec Ctrl+Z, dis-le. Ne modifie le montage que si on te le demande.
- Un composant absent du catalogue (lister_catalogue) ne peut pas être ajouté ici : il lui faut d'abord une fiche tirée de sa datasheet, que Jean crée avec Claude Code dans le dépôt du projet. Dis-le simplement.
- Les noms de points s'écrivent « pièce:broche », par exemple esp:13, drv1:VM, bb1:10t.a (trou de breadboard : colonne, t ou b pour la moitié haute ou basse, puis la rangée a à j ; rails tp, tn, bp, bn).`;

const LIMITE_RESULTAT = 30_000;

/** Coupe un résultat d'outil trop long pour Claude (32 Ko au plus). */
function borner(valeur: unknown): unknown {
  const texte = JSON.stringify(valeur);
  if (texte.length <= LIMITE_RESULTAT) return valeur;
  return { tronque: true, debut: texte.slice(0, LIMITE_RESULTAT) };
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** Fiche d'une pièce du montage ou d'un identifiant de fiche. */
function ficheDe(env: EnvironnementAssistant, nom: string): { fiche: Fiche; piece?: string } | undefined {
  const piece = env.editeur().montage().pieces.find((p) => p.id === nom);
  if (piece) return { fiche: piece.fiche, piece: piece.id };
  const fiche = env.catalogue.fiche(nom) ?? env.catalogue.fichesWokwi(nom)[0];
  return fiche ? { fiche } : undefined;
}

function statut(fiche: Fiche): string {
  return (fiche['validation'] as { statut?: string } | undefined)?.statut ?? 'inconnu';
}

/** Résumé compact d'une valeur de fiche : « -0,5 à 32 V ». */
function plage(g: unknown): string | undefined {
  const x = g as { min?: number; typ?: number; max?: number; unite?: string } | undefined;
  if (!x || typeof x !== 'object' || x.unite === undefined) return undefined;
  const parts = [x.min !== undefined ? `min ${x.min}` : '', x.typ !== undefined ? `typ ${x.typ}` : '', x.max !== undefined ? `max ${x.max}` : ''].filter(Boolean);
  return `${parts.join(', ')} ${x.unite}`;
}

function rapportCourant(env: EnvironnementAssistant): Rapport {
  return verifier(env.editeur().montage(), env.catalogue);
}

/** Les outils offerts à Claude, du plus utile au moins utile (on coupe la fin si la vue en accepte moins). */
export function outilsAssistant(env: EnvironnementAssistant): OutilAssistant[] {
  const signaler = (t: string) => env.progression?.(t);

  return [
    {
      name: 'lire_verdicts',
      description:
        'Met le montage sous tension dans le moteur et renvoie ses verdicts : pour chacun, gravité, pièce, titre, explication chiffrée, correction et source (page de datasheet ou hypothèse). Renvoie aussi ce qui n\'est pas simulé. À appeler pour toute question « pourquoi ça marche / ne marche pas / ça grille ? ».',
      execute: () => {
        signaler('Lit les verdicts du moteur…');
        const r = rapportCourant(env);
        if (!r.converge) return { calcul: 'impossible', raison: r.message };
        return borner({
          resume: r.constats.length === 0 ? 'rien à signaler' : `${r.constats.length} constats`,
          constats: r.constats.map((c) => ({
            verdict: NOMS_VERDICTS[c.verdict],
            piece: c.piece,
            titre: c.titre,
            explication: c.explication,
            correction: c.correction,
            source: c.source ? texteSource(c.source) : undefined,
            origine: c.origine === 'calcul' ? 'calcul' : `règle ${c.regle ?? ''}`,
            fiche_brouillon: c.brouillon,
          })),
          non_simule: r.nonSimule,
          drivers: r.calcul.drivers.map((d) => ({ piece: d.piece, actif: d.actif, raison: d.raison, courant_bobine_A: Number(d.courantBobine.toFixed(3)) })),
          sources: r.calcul.sources.map((s) => ({ piece: s.piece, regime: s.regime, tension_V: Number(s.tension.toFixed(3)), courant_A: Number(s.courant.toFixed(4)) })),
        });
      },
    },
    {
      name: 'lire_montage',
      description:
        'Renvoie le montage affiché : chaque pièce (identifiant, fiche, réglages, état des broches réglé à la main), chaque fil (de, vers, couleur) et les broches enfichées dans la breadboard. À appeler avant de parler du câblage ou de le modifier.',
      execute: () => {
        signaler('Lit le montage…');
        const m = env.editeur().montage();
        return borner({
          pieces: m.pieces.map((p) => ({
            id: p.id,
            fiche: p.fiche.id,
            nom: p.fiche.nom,
            reglages: p.parametres,
            ...(Object.keys(p.etats).length > 0 ? { etats_broches: p.etats } : {}),
          })),
          fils: m.connexions.filter((c) => c.couleur !== '').map((c) => `${c.de.piece}:${c.de.broche} -> ${c.vers.piece}:${c.vers.broche} (${c.couleur})`),
          enfichages: m.connexions.filter((c) => c.couleur === '').map((c) => `${c.de.piece}:${c.de.broche} dans ${c.vers.piece}:${c.vers.broche}`),
        });
      },
    },
    {
      name: 'lire_fiche',
      description:
        'Renvoie la fiche d\'un composant (identifiant de pièce du montage comme « drv1 », ou de fiche comme « tmc2209-module ») : à quoi il sert, ses broches (rôle, limites absolues, plage recommandée, note), ses réglages, ses règles et son statut (brouillon ou relue). Pour « à quoi sert ce composant ? ».',
      inputSchema: { type: 'object', properties: { composant: { type: 'string', description: 'Pièce du montage (drv1, esp) ou identifiant de fiche.' } }, required: ['composant'] },
      execute: (input) => {
        const nom = texte(input['composant']);
        signaler(`Lit la fiche de ${nom}…`);
        const trouve = ficheDe(env, nom);
        if (!trouve) throw new Error(`aucune pièce ni fiche « ${nom} » ; voir lire_montage ou lister_catalogue`);
        const { fiche } = trouve;
        return borner({
          id: fiche.id,
          nom: fiche.nom,
          categorie: fiche.categorie,
          description: fiche['description'],
          statut: statut(fiche),
          broches: fiche.broches.map((b) => ({
            nom: b.nom,
            role: b.role,
            ...(b.vers ? { vers_la_puce: b.vers } : {}),
            ...(plage((b['max_absolus'] as { tension?: unknown } | undefined)?.tension) ? { max_absolus_tension: plage((b['max_absolus'] as { tension?: unknown }).tension) } : {}),
            ...(plage((b['recommande'] as { tension?: unknown } | undefined)?.tension) ? { recommande_tension: plage((b['recommande'] as { tension?: unknown }).tension) } : {}),
            ...(b['note'] ? { note: String(b['note']).slice(0, 300) } : {}),
          })),
          reglages: Object.fromEntries(Object.entries(fiche.parametres ?? {}).map(([k, p]) => [k, `${p.description} (${p.unite}${p.defaut !== undefined ? `, défaut ${String(p.defaut)}` : ''})`])),
          regles: ((fiche['regles'] as { id: string; verdict: string; explication: string }[] | undefined) ?? []).map((r) => `${r.id} (${r.verdict}) : ${r.explication}`),
          sous_composants: (fiche.sous_composants ?? []).map((s) => `${s.ref} : fiche ${s.fiche}`),
        });
      },
    },
    {
      name: 'mesurer_tension',
      description: 'Multimètre : tension entre deux points « pièce:broche » (sonde rouge, sonde noire), calculée par le moteur pour le montage tel qu\'il est réglé. Renvoie la valeur en volts, ou rien si les points ne sont reliés par rien.',
      inputSchema: { type: 'object', properties: { rouge: { type: 'string', description: 'Point de la sonde rouge, ex. esp:13' }, noir: { type: 'string', description: 'Point de la sonde noire, ex. esp:GND.1' } }, required: ['rouge', 'noir'] },
      execute: (input) => {
        const rouge = texte(input['rouge']);
        const noir = texte(input['noir']);
        signaler(`Mesure entre ${rouge} et ${noir}…`);
        const r = rapportCourant(env);
        if (!r.converge) throw new Error(`calcul impossible : ${r.message ?? ''}`);
        const m = mesurerTension(r.calcul, rouge, noir);
        return { affichage: m.texte, valeur_V: m.valeur, detail: m.detail };
      },
    },
    {
      name: 'mesurer_courant',
      description: 'Multimètre : courant dans le fil (ou l\'enfichage) qui relie deux points « pièce:broche », avec son sens, calculé par le moteur.',
      inputSchema: { type: 'object', properties: { de: { type: 'string' }, vers: { type: 'string' } }, required: ['de', 'vers'] },
      execute: (input) => {
        const a = texte(input['de']);
        const b = texte(input['vers']);
        signaler(`Mesure le courant entre ${a} et ${b}…`);
        const montage = env.editeur().montage();
        // Nom canonique d'un point (alias résolu) : « esp:IO13 » -> « esp:13 ».
        const canonique = (p: string) => {
          const [piece, broche] = [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)];
          const fiche = montage.pieces.find((x) => x.id === piece)?.fiche;
          return `${piece}:${(fiche && trouverBroche(fiche, broche)?.nom) ?? broche}`;
        };
        const [ca, cb] = [canonique(a), canonique(b)];
        const point = (e: { piece: string; broche: string }) => `${e.piece}:${e.broche}`;
        const c = montage.connexions.find((x) => (point(x.de) === ca && point(x.vers) === cb) || (point(x.de) === cb && point(x.vers) === ca));
        if (!c) throw new Error(`aucun fil ni enfichage entre ${a} et ${b}`);
        const r = rapportCourant(env);
        if (!r.converge) throw new Error(`calcul impossible : ${r.message ?? ''}`);
        const m = mesurerCourant(r.calcul, montage, c.indice);
        return { affichage: m.texte, valeur_A: m.valeur, detail: m.detail };
      },
    },
    {
      name: 'lister_catalogue',
      description: 'Liste les composants qu\'on peut poser (identifiant de fiche, nom, catégorie, réglages). Un composant absent de cette liste n\'a pas encore de fiche.',
      execute: () => {
        signaler('Lit le catalogue…');
        return env.catalogue.fiches
          .filter((f) => f.categorie !== 'puce' && f.modele?.type !== 'fil')
          .map((f) => ({ fiche: f.id, nom: f.nom, categorie: f.categorie, reglages: Object.keys(f.parametres ?? {}), statut: statut(f) }));
      },
    },
    {
      name: 'poser_piece',
      description:
        'Pose une pièce du catalogue. Avec « trou » (ex. bb1:10t.a), sa première broche s\'enfiche dans ce trou et les autres dans les trous voisins (résistance : la broche 2 six colonnes plus loin) ; sans « trou », elle est posée sous le montage. Renvoie son identifiant et les trous occupés. S\'annule avec Ctrl+Z.',
      inputSchema: { type: 'object', properties: { fiche: { type: 'string', description: 'Identifiant de fiche (lister_catalogue).' }, trou: { type: 'string', description: 'Optionnel : trou de breadboard pour la première broche.' } }, required: ['fiche'] },
      execute: (input) => {
        const idFiche = texte(input['fiche']);
        const trou = texte(input['trou']);
        const editeur = env.editeur();
        const fiche = env.catalogue.fiche(idFiche);
        if (!fiche || fiche.categorie === 'puce' || fiche.modele?.type === 'fil') throw new Error(`fiche « ${idFiche} » absente du catalogue des pièces : voir lister_catalogue`);
        signaler(`Pose ${fiche.nom}…`);
        const placements = placerPieces(editeur.montage());
        const occupe = cadreDe(placements, 0);
        const id = editeur.ajouterPiece(fiche.id, placements.size > 0 ? occupe.x : 0, placements.size > 0 ? occupe.y + occupe.hauteur + 4 * P : 0);
        if (trou) {
          const [bb, nom] = [trou.slice(0, trou.indexOf(':')), trou.slice(trou.indexOf(':') + 1)];
          const apres = placerPieces(editeur.montage());
          const pTrou = apres.get(bb)?.dessin.broches.get(nom);
          const pl = apres.get(id);
          const premiere = pl ? [...pl.dessin.broches.values()][0] : undefined;
          if (!pTrou || !pl || !premiere) {
            env.apresModification(`${id} posée`);
            throw new Error(`trou « ${trou} » introuvable : ${id} est posée sous le montage`);
          }
          editeur.deplacerPiece(id, apres.get(bb)!.x + pTrou.x - premiere.x, apres.get(bb)!.y + pTrou.y - premiere.y);
        }
        const enfichees = editeur.diagramme.connections.filter((c) => c[2] === '' && c[0].startsWith(`${id}:`)).map((c) => `${c[0]} dans ${c[1]}`);
        env.apresModification(`${id} posée`);
        return { id, enfichee: enfichees.length > 0, enfichages: enfichees, note: trou && enfichees.length === 0 ? 'pas enfichée : trou occupé, ou deux broches sur une même bande' : undefined };
      },
    },
    {
      name: 'tracer_fil',
      description: 'Trace un fil entre deux points « pièce:broche » (un trou de breadboard ne reçoit qu\'une chose). La couleur est choisie seule si on ne la donne pas. S\'annule avec Ctrl+Z.',
      inputSchema: { type: 'object', properties: { de: { type: 'string' }, vers: { type: 'string' }, couleur: { type: 'string', description: 'Optionnel : red, black, green, blue, yellow, orange...' } }, required: ['de', 'vers'] },
      execute: (input) => {
        const de = texte(input['de']);
        const vers = texte(input['vers']);
        signaler(`Trace un fil de ${de} à ${vers}…`);
        const refus = env.editeur().ajouterFil(de, vers, texte(input['couleur']) || undefined);
        if (refus) throw new Error(refus);
        env.apresModification(`fil ${de} -> ${vers}`);
        return { trace: `${de} -> ${vers}` };
      },
    },
    {
      name: 'regler',
      description:
        `Change un réglage d'une pièce : un paramètre de sa fiche (ex. alim : tension, limite_courant ; drv1 : vref, courant_uart ; r1 : value), ou l'état d'une broche de l'ESP32 avec nom « etat:<broche> » et une valeur parmi ${ETATS_BROCHE.join(', ')} (vide = état au démarrage). S'annule avec Ctrl+Z.`,
      inputSchema: { type: 'object', properties: { piece: { type: 'string' }, nom: { type: 'string' }, valeur: { type: ['string', 'number', 'boolean'] } }, required: ['piece', 'nom'] },
      execute: (input) => {
        const piece = texte(input['piece']);
        const nom = texte(input['nom']);
        const brut = input['valeur'];
        signaler(`Règle ${piece} : ${nom}…`);
        const editeur = env.editeur();
        let refus: string | undefined;
        if (nom.startsWith('etat:')) {
          const broche = nom.slice(5);
          const etats = { ...((editeur.diagramme.parts.find((p) => p.id === piece)?.attrs['etats'] as Record<string, string> | undefined) ?? {}) };
          const valeur = texte(brut);
          if (valeur === '') delete etats[broche];
          else if (!(ETATS_BROCHE as readonly string[]).includes(valeur)) throw new Error(`état « ${valeur} » inconnu`);
          else etats[broche] = valeur;
          refus = editeur.reglerPiece(piece, 'etats', Object.keys(etats).length > 0 ? etats : undefined);
        } else {
          const valeur = typeof brut === 'string' && brut.trim() !== '' && !Number.isNaN(Number(brut)) ? Number(brut) : brut;
          refus = editeur.reglerPiece(piece, nom, valeur === null ? undefined : valeur);
        }
        if (refus) throw new Error(refus);
        env.apresModification(`${piece} : ${nom} réglé`);
        return { regle: `${piece} : ${nom} = ${String(brut ?? '(défaut)')}` };
      },
    },
    {
      name: 'supprimer',
      description: 'Supprime une pièce (« piece ») avec ses fils, ou le fil entre deux points (« de » et « vers »). Seulement si on te le demande. S\'annule avec Ctrl+Z.',
      inputSchema: { type: 'object', properties: { piece: { type: 'string' }, de: { type: 'string' }, vers: { type: 'string' } } },
      execute: (input) => {
        const editeur = env.editeur();
        const piece = texte(input['piece']);
        if (piece) {
          signaler(`Supprime ${piece}…`);
          const refus = editeur.supprimerPiece(piece);
          if (refus) throw new Error(refus);
          env.apresModification(`${piece} supprimée`);
          return { supprime: piece };
        }
        const de = texte(input['de']);
        const vers = texte(input['vers']);
        const indice = editeur.diagramme.connections.findIndex((c) => c[2] !== '' && ((c[0] === de && c[1] === vers) || (c[0] === vers && c[1] === de)));
        if (indice < 0) throw new Error(`aucun fil entre ${de} et ${vers}`);
        signaler(`Supprime le fil ${de} -> ${vers}…`);
        const refus = editeur.supprimerFil(indice);
        if (refus) throw new Error(refus);
        env.apresModification(`fil ${de} -> ${vers} supprimé`);
        return { supprime: `${de} -> ${vers}` };
      },
    },
  ];
}

/** Contexte ajouté à chaque question : ce que la personne voit à l'écran. */
export function contexte(env: EnvironnementAssistant, choix: { piece?: string }, sousTension: boolean): string {
  const m = env.editeur().montage();
  return `[Écran : ${m.pieces.length} pièces, ${m.connexions.filter((c) => c.couleur !== '').length} fils ; ${sousTension ? 'sous tension' : 'hors tension'}${choix.piece ? ` ; pièce choisie : ${choix.piece}` : ''}]`;
}

/** Nombre de tours gardés (les plus anciens partent, jamais les consignes). */
export const TOURS_GARDES = 20;

/**
 * Pose une question : envoie les consignes, la conversation gardée et la question, laisse
 * Claude appeler les outils, et renvoie la réponse. La conversation est complétée en place
 * (question, puis réponse si elle arrive).
 */
export async function poserQuestion(
  sample: FonctionSample,
  conversation: MessageChat[],
  question: string,
  options: { outils?: OutilAssistant[]; onText?: (texte: string) => void; signal?: AbortSignal; contexte?: string },
): Promise<{ texte: string; tronque: boolean }> {
  conversation.push({ role: 'user', content: options.contexte ? `${options.contexte}\n${question}` : question });
  while (conversation.length > TOURS_GARDES) conversation.shift();
  // Une conversation commence par un tour de la personne : on retire une réponse orpheline.
  while (conversation[0]?.role === 'assistant') conversation.shift();
  const entree: MessageChat[] = [{ role: 'user', content: CONSIGNES }, ...conversation];
  const resultat = await sample(entree, {
    ...(options.outils && options.outils.length > 0 ? { tools: options.outils } : { cache: false as const }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onText ? { onText: ({ text }) => options.onText?.(text) } : {}),
  });
  conversation.push({ role: 'assistant', content: resultat.text });
  return { texte: resultat.text, tronque: resultat.truncated };
}

/** Message à montrer pour une erreur de la capacité « sample » (codes du contrat). */
export function messageErreur(code: string): { texte: string; cacher: boolean } {
  switch (code) {
    case 'cancelled':
      return { texte: 'Arrêté.', cacher: false };
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return { texte: 'Claude n\'est pas autorisé pour cette page : l\'assistant est désactivé.', cacher: true };
    case 'rate_limited':
      return { texte: 'Trop de demandes, ou limite d\'usage de ton compte atteinte : réessaie dans un moment.', cacher: false };
    case 'session_expired':
      return { texte: 'Ta session claude.ai a expiré : reconnecte-toi, puis réessaie.', cacher: false };
    case 'prompt_too_large':
      return { texte: 'La conversation est trop longue : clique « Effacer » et repose ta question.', cacher: false };
    case 'refused':
      return { texte: 'Claude n\'a pas voulu répondre à cette demande : reformule-la.', cacher: false };
    case 'empty_completion':
      return { texte: 'Pas de réponse : pose une question plus simple.', cacher: false };
    default:
      return { texte: 'La réponse a été interrompue (souci de connexion ou du service) : réessaie.', cacher: false };
  }
}
