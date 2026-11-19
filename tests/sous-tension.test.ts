// Étape 8 : mise sous tension et mesures. Les mesures affichées égalent celles du moteur, chaque
// cas de test marque sur le plan la bonne pièce du bon verdict, et les réglages à la main
// changent le calcul.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import corrigee from '../montages/base-roulante-corrigee.diagram.json';
import { formater } from '../src/moteur/constats';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { construireReseau } from '../src/moteur/reseau';
import { verifier } from '../src/moteur/verifications';
import { brochesReglables, htmlConstats, htmlReglages, marquesVerdicts, mesurerCourant, mesurerTension } from '../src/ui/affichage';
import { Editeur, type Diagramme } from '../src/ui/edition';
import { dessinerPlan } from '../src/ui/plan';

const cas = import.meta.glob<Diagramme>('../montages/cas/*.diagram.json', { eager: true, import: 'default' });
const editeurDe = (d: unknown) => new Editeur(catalogue, d as Diagramme);
const sousTension = (e: Editeur) => verifier(e.montage(), catalogue);
const fiches = (id: string) => catalogue.fiche(id);

describe('multimètre : les mesures affichées égalent celles du moteur', () => {
  it('tension entre deux points : EN de la base roulante au démarrage', () => {
    const e = editeurDe(baseRoulante);
    const r = sousTension(e);
    const m = mesurerTension(r.calcul, 'esp:13', 'esp:GND.1');
    expect(m.valeur).toBe(r.calcul.difference('esp:13', 'esp:GND.1'));
    expect(m.texte).toBe('2,97 V');
    expect(mesurerTension(r.calcul, 'drv1:VM', 'drv1:GND.1').texte).toBe(formater(r.calcul.difference('drv1:VM', 'drv1:GND.1')!, 'V'));
  });

  it('chaque fil de la base corrigée affiche le courant du moteur, dans le bon sens', () => {
    const e = editeurDe(corrigee);
    const r = sousTension(e);
    const montage = e.montage();
    montage.connexions.forEach((c, k) => {
      const m = mesurerCourant(r.calcul, montage, c.indice);
      const i = r.calcul.courantFil(k)!;
      expect(m.valeur).toBe(i);
      expect(m.texte).toBe(formater(Math.abs(i), 'A'));
      const [de, vers] = i >= 0 ? [c.de, c.vers] : [c.vers, c.de];
      expect(m.detail).toContain(`de ${de.piece}:${de.broche} vers ${vers.piece}:${vers.broche}`);
    });
  });

  it('cas 9 : 1,28 A de l\'alim vers le rail VM', () => {
    const e = editeurDe(cas['../montages/cas/cas-09-contact-surcharge.diagram.json']);
    const r = sousTension(e);
    const indice = e.diagramme.connections.findIndex((c) => c[0] === 'alim:+' && c[1] === 'bb1:bp.1');
    const m = mesurerCourant(r.calcul, e.montage(), indice);
    expect(m.texte).toBe('1,28 A');
    expect(m.detail).toBe('dans le fil, de alim:+ vers bb1:bp.1');
  });

  it('deux points que rien ne relie : pas de valeur', () => {
    const e = editeurDe(baseRoulante);
    const r1 = e.ajouterPiece('resistance', 0, 600);
    const m = mesurerTension(sousTension(e).calcul, `${r1}:1`, 'esp:GND.1');
    expect(m.valeur).toBeUndefined();
    expect(m.texte).toBe('— V');
  });
});

const ATTENDUS: [string, string, string][] = [
  ['cas-01-12v-sur-broche', 'esp', 'grille'],
  ['cas-02a-vm-inverse-lipo', 'drv1', 'grille'],
  ['cas-02b-vm-inverse-alim-1a', 'drv1', 'risque_eleve'],
  ['cas-03-moteur-debranche', 'drv1', 'risque_eleve'],
  ['cas-04-sans-condensateur', 'drv1', 'risque_eleve'],
  ['cas-05-en-flotte', 'drv1', 'risque'],
  ['cas-06-step-sur-io34', 'esp', 'ne_marchera_pas'],
  ['cas-07-micro-pas-sans-uart', 'drv2', 'ne_marchera_pas'],
  ['cas-08-masses-separees', 'drv1', 'ne_marchera_pas'],
  ['cas-10-courant-moteur', 'mot1', 'chauffe'],
];

describe('verdicts sur le plan', () => {
  it.each(ATTENDUS)('%s : %s marqué « %s »', (nom, piece, verdict) => {
    const e = editeurDe(cas[`../montages/cas/${nom}.diagram.json`]);
    const r = sousTension(e);
    const marques = marquesVerdicts(r, e.montage());
    expect(marques.pieces.get(piece)).toBe(verdict);
    const svg = dessinerPlan(e.montage(), construireReseau(e.montage(), catalogue), { verdicts: marques });
    expect(svg).toMatch(new RegExp(`class="piece[^"]* verdict-${verdict}" data-piece="${piece}"`));
    if (verdict === 'grille') expect(svg).toContain('class="fumee"');
  });

  it('cas 9 : le trou du contact et le fil de l\'alim chauffent, pas la breadboard entière', () => {
    const e = editeurDe(cas['../montages/cas/cas-09-contact-surcharge.diagram.json']);
    const marques = marquesVerdicts(sousTension(e), e.montage());
    expect(marques.pieces.has('bb1')).toBe(false);
    expect(marques.points.get('bb1:bp.1')).toBe('chauffe');
    const indice = e.diagramme.connections.findIndex((c) => c[0] === 'alim:+');
    expect(marques.fils.get(indice)).toBe('chauffe');
    const svg = dessinerPlan(e.montage(), construireReseau(e.montage(), catalogue), { verdicts: marques });
    expect(svg).toMatch(/class="broche trou verdict-chauffe" data-point="bb1:bp\.1"/);
    expect(svg).toContain(`class="fil-groupe verdict-chauffe" data-connexion="${indice}"`);
  });

  it('le montage corrigé n\'a aucune marque, et les sondes se dessinent', () => {
    const e = editeurDe(corrigee);
    const marques = marquesVerdicts(sousTension(e), e.montage());
    const svg = dessinerPlan(e.montage(), construireReseau(e.montage(), catalogue), { verdicts: marques, sondes: { rouge: 'esp:13', noir: 'esp:GND.1' } });
    expect(svg).not.toContain('verdict-');
    expect(svg).toContain('class="sonde sonde-rouge"');
    expect(svg).toContain('class="sonde sonde-noir"');
  });
});

describe('panneaux', () => {
  it('le panneau des verdicts donne verdict, explication, correction et source', () => {
    const r = sousTension(editeurDe(cas['../montages/cas/cas-05-en-flotte.diagram.json']));
    const html = htmlConstats(r);
    expect(html).toContain('<span class="badge">risque</span>');
    expect(html).toContain('EN de drv1 est à 2,28 V');
    expect(html).toContain('À faire : Tirer EN vers 3,3 V');
    expect(html).toContain('Source : tmc2209-ds, p. 9');
    expect(html).toContain('fiche en brouillon');
    expect(htmlConstats(sousTension(editeurDe(corrigee)))).toContain('Rien à signaler');
  });

  it('le panneau des réglages montre les paramètres et l\'état des broches branchées', () => {
    const e = editeurDe(baseRoulante);
    const montage = e.montage();
    const piece = (id: string) => montage.pieces.find((p) => p.id === id)!;
    const alim = htmlReglages(piece('alim'), montage, fiches);
    expect(alim).toContain('data-param="tension" value="12"');
    expect(alim).toContain('data-param="limite_courant" value="3"');
    expect(htmlReglages(piece('drv1'), montage, fiches)).toContain('data-param="courant_uart" value=""');
    const broches = brochesReglables(piece('esp'), montage, fiches);
    expect(broches.map((b) => b.nom)).toEqual(expect.arrayContaining(['13', '32', '33', '16', '17']));
    expect(broches.find((b) => b.nom === '13')?.demarrage).toBe('entree_tirage_bas');
    expect(htmlReglages(piece('esp'), montage, fiches)).toContain('<select data-etat="13">');
  });

  it('un réglage change le calcul : alim à 16 V, puis IO13 en sortie basse active les drivers', () => {
    const e = editeurDe(corrigee);
    expect(e.reglerPiece('alim', 'tension', 16)).toBeUndefined();
    expect(sousTension(e).calcul.sources.find((s) => s.piece === 'alim')?.tension).toBeCloseTo(16, 6);
    expect(e.reglerPiece('esp', 'etats', { '13': 'sortie_basse' })).toBeUndefined();
    expect(sousTension(e).calcul.drivers.every((d) => d.actif)).toBe(true);
    // Un réglage hors des bornes de la fiche est refusé, et rien ne change.
    expect(e.reglerPiece('alim', 'tension', 40)).toContain('dépasse le maximum');
    expect(e.annuler()).toBe(true);
    expect(sousTension(e).calcul.drivers.every((d) => !d.actif)).toBe(true);
  });
});
