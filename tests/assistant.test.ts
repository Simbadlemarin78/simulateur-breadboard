// Assistant : les outils offerts à Claude répondent avec les chiffres du moteur, restent sous
// la taille permise, et leurs modifications passent par l'éditeur (donc s'annulent). Le
// dialogue envoie les consignes en tête et garde la conversation. Claude est remplacé ici par
// une fausse fonction « sample » qui joue un scénario d'appels d'outils.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { construireReseau } from '../src/moteur/reseau';
import { verifier } from '../src/moteur/verifications';
import { CONSIGNES, contexte, messageErreur, outilsAssistant, poserQuestion, TOURS_GARDES, type EnvironnementAssistant, type FonctionSample, type MessageChat } from '../src/ui/assistant';
import { Editeur, type Diagramme } from '../src/ui/edition';

const cas = import.meta.glob<Diagramme>('../montages/cas/*.diagram.json', { eager: true, import: 'default' });

function environnement(d: unknown = baseRoulante): { env: EnvironnementAssistant; editeur: Editeur; modifications: string[] } {
  const editeur = new Editeur(catalogue, d as Diagramme);
  const modifications: string[] = [];
  return { env: { catalogue, editeur: () => editeur, apresModification: (r) => modifications.push(r) }, editeur, modifications };
}
const outil = (env: EnvironnementAssistant, nom: string) => {
  const o = outilsAssistant(env).find((x) => x.name === nom);
  if (!o) throw new Error(`outil ${nom} absent`);
  return o;
};
const appeler = (env: EnvironnementAssistant, nom: string, input: Record<string, unknown> = {}) => outil(env, nom).execute(input) as Record<string, unknown>;

describe('outils offerts à Claude', () => {
  it('respectent le contrat : noms uniques et valides, descriptions et schémas sous leur taille', () => {
    const { env } = environnement();
    const outils = outilsAssistant(env);
    expect(new Set(outils.map((o) => o.name)).size).toBe(outils.length);
    for (const o of outils) {
      expect(o.name).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
      expect(new TextEncoder().encode(o.description).length).toBeLessThanOrEqual(1024);
      if (o.inputSchema) expect(JSON.stringify(o.inputSchema).length).toBeLessThanOrEqual(4096);
    }
  });

  it('tiennent sous 32 Ko de résultat, même sur la plus grosse fiche et le plus gros montage', () => {
    const { env } = environnement();
    const taille = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;
    expect(taille(appeler(env, 'lire_montage'))).toBeLessThan(32_000);
    expect(taille(appeler(env, 'lire_verdicts'))).toBeLessThan(32_000);
    for (const f of catalogue.fiches) expect(taille(appeler(env, 'lire_fiche', { composant: f.id })), f.id).toBeLessThan(32_000);
  });

  it('lire_verdicts rend les verdicts du moteur, avec explication et source', () => {
    const { env, editeur } = environnement(cas['../montages/cas/cas-01-12v-sur-broche.diagram.json']);
    const r = appeler(env, 'lire_verdicts') as { constats: { verdict: string; titre: string; source?: string }[] };
    const moteur = verifier(editeur.montage(), catalogue);
    expect(r.constats).toHaveLength(moteur.constats.length);
    expect(r.constats[0]).toMatchObject({ verdict: 'grillé', titre: 'esp:4 : 232 mA dans la diode de protection' });
    expect(r.constats[0]?.source).toContain('hypothèse');
  });

  it('les mesures sont celles du multimètre : 2,97 V sur EN, 28 mA dans le fil de l\'alim', () => {
    const { env } = environnement();
    expect(appeler(env, 'mesurer_tension', { rouge: 'esp:13', noir: 'esp:GND.1' })).toMatchObject({ affichage: '2,97 V' });
    expect(appeler(env, 'mesurer_courant', { de: 'bb1:bp.1', vers: 'alim:+' })).toMatchObject({ affichage: '28,0 mA', detail: 'dans le fil, de alim:+ vers bb1:bp.1' });
    // Un alias de broche est accepté : IO13 pour 13.
    expect(appeler(env, 'mesurer_tension', { rouge: 'esp:IO13', noir: 'esp:GND.1' })).toMatchObject({ affichage: '2,97 V' });
    expect(() => appeler(env, 'mesurer_courant', { de: 'esp:13', vers: 'alim:+' })).toThrow(/aucun fil/);
  });

  it('lire_fiche explique un composant du montage, avec son statut', () => {
    const { env } = environnement();
    const f = appeler(env, 'lire_fiche', { composant: 'drv1' }) as { id: string; statut: string; broches: { nom: string; vers_la_puce?: string }[] };
    expect(f.id).toBe('tmc2209-module');
    expect(f.statut).toBe('brouillon');
    expect(f.broches.find((b) => b.nom === 'EN')?.vers_la_puce).toBe('U1.ENN');
    expect(() => appeler(env, 'lire_fiche', { composant: 'lm2596' })).toThrow(/lister_catalogue/);
  });

  it('poser_piece enfiche une résistance au trou demandé, tracer_fil la relie, et Ctrl+Z défait tout', () => {
    const { env, editeur, modifications } = environnement();
    const avant = editeur.exporter();
    const r = appeler(env, 'poser_piece', { fiche: 'resistance', trou: 'bb1:52t.a' }) as { id: string; enfichages: string[] };
    expect(r.enfichages).toEqual([`${r.id}:1 dans bb1:52t.a`, `${r.id}:2 dans bb1:58t.a`]);
    appeler(env, 'tracer_fil', { de: 'bb1:52t.b', vers: 'bb1:tp.47' });
    expect(construireReseau(editeur.montage(), catalogue).noeudDe(`${r.id}:1`)?.points).toContain('esp:3V3');
    expect(modifications).toEqual([`${r.id} posée`, 'fil bb1:52t.b -> bb1:tp.47']);
    expect(() => appeler(env, 'tracer_fil', { de: 'bb1:52t.a', vers: 'bb1:tp.41' })).toThrow(/occupé/);
    editeur.annuler();
    editeur.annuler();
    editeur.annuler();
    expect(editeur.exporter()).toBe(avant);
  });

  it('regler change un paramètre ou l\'état d\'une broche, et refuse une valeur hors bornes', () => {
    const { env, editeur } = environnement();
    appeler(env, 'regler', { piece: 'esp', nom: 'etat:13', valeur: 'sortie_basse' });
    expect(verifier(editeur.montage(), catalogue).calcul.drivers.every((d) => d.actif)).toBe(true);
    appeler(env, 'regler', { piece: 'alim', nom: 'tension', valeur: '16' });
    expect(editeur.montage().pieces.find((p) => p.id === 'alim')?.parametres['tension']).toBe(16);
    expect(() => appeler(env, 'regler', { piece: 'alim', nom: 'tension', valeur: 40 })).toThrow(/maximum/);
    expect(() => appeler(env, 'regler', { piece: 'esp', nom: 'etat:13', valeur: 'clignote' })).toThrow(/inconnu/);
  });

  it('regler met une broche en impulsions à la fréquence demandée, et lire_verdicts dit que la roue tourne', () => {
    const { env, editeur } = environnement();
    appeler(env, 'regler', { piece: 'esp', nom: 'etat:13', valeur: 'sortie_basse' });
    appeler(env, 'regler', { piece: 'esp', nom: 'etat:32', valeur: 'impulsions' });
    appeler(env, 'regler', { piece: 'esp', nom: 'frequence:32', valeur: '3200' });
    expect(editeur.montage().pieces.find((p) => p.id === 'esp')!.frequences).toEqual({ '32': 3200 });
    const r = appeler(env, 'lire_verdicts') as { effets: { piece: string; tourne?: boolean; tr_min?: number }[] };
    expect(r.effets.find((e) => e.piece === 'mot1')).toMatchObject({ tourne: true, tr_min: 60 });
    expect(() => appeler(env, 'regler', { piece: 'esp', nom: 'frequence:32', valeur: -5 })).toThrow(/Hz/);
  });

  it('supprimer enlève un fil ou une pièce', () => {
    const { env, editeur } = environnement();
    appeler(env, 'supprimer', { de: 'alim:+', vers: 'bb1:bp.1' });
    expect(editeur.diagramme.connections.some((c) => c[0] === 'alim:+')).toBe(false);
    appeler(env, 'supprimer', { piece: 'r1' });
    expect(editeur.diagramme.parts.some((p) => p.id === 'r1')).toBe(false);
  });

  it('lister_catalogue ne propose que des pièces posables', () => {
    const { env } = environnement();
    const liste = appeler(env, 'lister_catalogue') as unknown as { fiche: string }[];
    expect(liste.map((f) => f.fiche)).toEqual(expect.arrayContaining(['resistance', 'tmc2209-module', 'esp32-devkitc']));
    expect(liste.map((f) => f.fiche)).not.toContain('tmc2209');
  });
});

describe('consignes', () => {
  it('renvoient un composant absent du catalogue vers /ajouter-composant, et interdisent d\'inventer une valeur', () => {
    expect(CONSIGNES).toContain('/ajouter-composant');
    expect(CONSIGNES).toContain('N\'invente jamais une valeur de datasheet');
  });
});

describe('dialogue', () => {
  it('envoie les consignes en tête, la question avec le contexte de l\'écran, et laisse Claude appeler les outils', async () => {
    const { env } = environnement(cas['../montages/cas/cas-05-en-flotte.diagram.json']);
    const recu: { entree: MessageChat[]; outils: string[] }[] = [];
    // Faux Claude : lit les verdicts avec l'outil, puis répond en citant le chiffre lu.
    const sample: FonctionSample = async (entree, options) => {
      recu.push({ entree, outils: (options.tools ?? []).map((t) => t.name) });
      const verdicts = (await options.tools!.find((t) => t.name === 'lire_verdicts')!.execute({})) as { constats: { explication: string }[] };
      const chiffre = /(\d,\d+ V)/.exec(verdicts.constats[0]!.explication)?.[1] ?? '?';
      const text = `EN est à ${chiffre} au démarrage : état incertain.`;
      options.onText?.({ text, delta: text });
      return { text, truncated: false };
    };
    const conversation: MessageChat[] = [];
    let streame = '';
    const r = await poserQuestion(sample, conversation, 'Pourquoi drv1 est en jaune ?', {
      outils: outilsAssistant(env),
      contexte: contexte(env, { piece: 'drv1' }, true),
      onText: (t) => (streame = t),
    });
    expect(r.texte).toBe('EN est à 2,28 V au démarrage : état incertain.');
    expect(streame).toBe(r.texte);
    expect(recu[0]!.entree[0]).toEqual({ role: 'user', content: CONSIGNES });
    expect(recu[0]!.entree.at(-1)?.content).toMatch(/^\[Écran : 16 pièces, \d+ fils ; sous tension ; pièce choisie : drv1\]\nPourquoi drv1 est en jaune \?$/);
    expect(recu[0]!.outils).toContain('poser_piece');
    expect(conversation.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('garde au plus les derniers tours, commence toujours par une question, et ne garde pas une réponse échouée', async () => {
    const conversation: MessageChat[] = [];
    let n = 0;
    const sample: FonctionSample = async (entree) => {
      expect(entree[0]?.content).toBe(CONSIGNES);
      expect(entree[1]?.role).toBe('user');
      expect(entree.at(-1)?.role).toBe('user');
      n++;
      if (n === 3) throw { code: 'upstream_error', message: 'coupure' };
      return { text: `réponse ${n}`, truncated: false };
    };
    for (let i = 0; i < 30; i++) {
      try {
        await poserQuestion(sample, conversation, `question ${i}`, {});
      } catch (e) {
        expect(messageErreur((e as { code: string }).code).cacher).toBe(false);
      }
    }
    expect(conversation.length).toBeLessThanOrEqual(TOURS_GARDES + 1);
    expect(conversation.at(-1)).toEqual({ role: 'assistant', content: 'réponse 30' });
  });

  it('cache l\'assistant quand Claude n\'est pas autorisé, garde la main sur les autres erreurs', () => {
    expect(messageErreur('not_granted').cacher).toBe(true);
    expect(messageErreur('sampling_disabled').cacher).toBe(true);
    expect(messageErreur('rate_limited').cacher).toBe(false);
    expect(messageErreur('code_inconnu').texte).toMatch(/réessaie/);
  });
});
