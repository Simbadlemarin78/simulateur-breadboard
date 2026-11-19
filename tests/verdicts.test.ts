// Étape 6 : vérifications, règles, verdicts. Les 10 cas de CLAUDE.md (le cas 2 en deux montages)
// donnent le verdict attendu, et le montage corrigé ne donne aucune fausse alerte.
// Les montages sont produits par outils/generer_montages.py.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import corrigee from '../montages/base-roulante-corrigee.diagram.json';
import type { Verdict } from '../src/moteur/constats';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { verifierEnTexte } from '../src/moteur/rapport-texte';
import { verifier } from '../src/moteur/verifications';

const cas = import.meta.glob<unknown>('../montages/cas/*.diagram.json', { eager: true, import: 'default' });
const montageCas = (nom: string): unknown => {
  const d = cas[`../montages/cas/${nom}.diagram.json`];
  if (!d) throw new Error(`montage ${nom} absent : relancer python outils/generer_montages.py`);
  return d;
};
const verifierDonnees = (donnees: unknown) => verifier(lireMontage(donnees, catalogue), catalogue);

interface Attendu {
  montage: string;
  piece: string;
  verdict: Verdict;
  /** Règle de la fiche qui doit donner ce verdict (absente : verdict du calcul). */
  regle?: string;
  /** Mot du titre, pour les verdicts du calcul. */
  titre?: string;
}

const ATTENDUS: [string, Attendu][] = [
  ['1. 12 V sur une broche de l\'ESP32', { montage: 'cas-01-12v-sur-broche', piece: 'esp', verdict: 'grille', titre: 'diode de protection' }],
  ['2a. VM et GND inversés sur une LiPo 4S', { montage: 'cas-02a-vm-inverse-lipo', piece: 'drv1', verdict: 'grille', titre: 'diodes du pont' }],
  ['2b. VM et GND inversés sur l\'alim limitée à 1 A', { montage: 'cas-02b-vm-inverse-alim-1a', piece: 'drv1', verdict: 'risque_eleve', titre: 'diodes du pont' }],
  ['3. moteur débranché, VM alimenté', { montage: 'cas-03-moteur-debranche', piece: 'drv1', verdict: 'risque_eleve', regle: 'pas-de-branchement-a-chaud' }],
  ['4. pas de condensateur de 100 µF', { montage: 'cas-04-sans-condensateur', piece: 'drv1', verdict: 'risque_eleve', regle: 'condensateur-reservoir' }],
  ['5. EN qui flotte au démarrage', { montage: 'cas-05-en-flotte', piece: 'drv1', verdict: 'risque', regle: 'en-au-demarrage' }],
  ['6. STEP sur IO34, entrée seule', { montage: 'cas-06-step-sur-io34', piece: 'esp', verdict: 'ne_marchera_pas', regle: 'entree-seule' }],
  ['7. MS1/MS2 différents, sans UART', { montage: 'cas-07-micro-pas-sans-uart', piece: 'drv2', verdict: 'ne_marchera_pas', regle: 'micro-pas-identiques' }],
  ['8. masses ESP32 et alim moteurs non reliées', { montage: 'cas-08-masses-separees', piece: 'drv1', verdict: 'ne_marchera_pas', titre: 'masse commune' }],
  ['9. plus de 1 A dans un contact', { montage: 'cas-09-contact-surcharge', piece: 'bb1', verdict: 'chauffe', titre: 'Contact bb1:bp.1' }],
  ['10. courant moteur au-dessus de 1,7 A', { montage: 'cas-10-courant-moteur', piece: 'mot1', verdict: 'chauffe', titre: '1,75 A par bobine' }],
];

describe('les 10 cas donnent le verdict attendu', () => {
  it.each(ATTENDUS)('%s', (_nom, a) => {
    const r = verifierDonnees(montageCas(a.montage));
    expect(r.converge, r.message).toBe(true);
    const trouve = r.constats.find(
      (c) => c.piece === a.piece && c.verdict === a.verdict && (a.regle ? c.regle === a.regle : c.origine === 'calcul' && c.titre.includes(a.titre!)),
    );
    expect(trouve, r.constats.map((c) => `${c.verdict} ${c.piece} ${c.titre}`).join('\n')).toBeDefined();
    // C'est bien le pire verdict de la pièce : pas de « grillé » caché derrière un « risque élevé ».
    expect(r.parPiece.get(a.piece)).toBe(a.verdict);
    // Toute explication est rédigée, et un verdict de règle cite sa source.
    expect(trouve!.explication.length).toBeGreaterThan(40);
    if (a.regle) expect(trouve!.source).toBeDefined();
  });

  it('2a. signale aussi le risque d\'incendie de la LiPo', () => {
    const r = verifierDonnees(montageCas('cas-02a-vm-inverse-lipo'));
    expect(r.constats.some((c) => c.piece === 'batt' && c.verdict === 'risque_eleve' && c.regle === 'surintensite-batterie')).toBe(true);
  });

  it('9. ne charge que le fil et les contacts de l\'alim : 0,95 A par bobine reste sous 1 A', () => {
    const r = verifierDonnees(montageCas('cas-09-contact-surcharge'));
    expect(r.constats.every((c) => c.verdict === 'chauffe')).toBe(true);
    expect(r.constats.every((c) => /alim|bp\.1|bn\.1/.test(c.titre))).toBe(true);
  });

  it('10. reste « chauffe » : moteur vers 110 °C (seuil 130 °C), puce vers 90 °C', () => {
    const r = verifierDonnees(montageCas('cas-10-courant-moteur'));
    expect(r.constats.some((c) => c.verdict === 'risque')).toBe(false);
    expect(r.constats.some((c) => c.piece === 'drv1' && c.verdict === 'chauffe')).toBe(true);
  });

  it('« grillé » ne sort que du calcul', () => {
    for (const nom of Object.keys(cas)) {
      const r = verifierDonnees(cas[nom]);
      for (const c of r.constats.filter((x) => x.verdict === 'grille')) expect(c.origine, `${nom} : ${c.titre}`).toBe('calcul');
    }
  });
});

describe('montages de référence', () => {
  it('le montage corrigé ne donne aucune alerte', () => {
    const r = verifierDonnees(corrigee);
    expect(r.converge, r.message).toBe(true);
    expect(r.constats.map((c) => `${c.verdict} ${c.titre}`)).toEqual([]);
    expect(r.nonSimule).toEqual([]);
  });

  it('la base roulante proposée manque d\'un condensateur par driver, et c\'est tout', () => {
    const r = verifierDonnees(baseRoulante);
    expect(r.constats.map((c) => `${c.piece} ${c.regle}`)).toEqual(['drv1', 'drv2', 'drv3', 'drv4'].map((d) => `${d} condensateur-reservoir`));
    expect(r.constats.every((c) => c.verdict === 'risque_eleve' && c.brouillon)).toBe(true);
  });

  it('un seul driver inversé dans la base corrigée : le calcul trouve le court-circuit par ses deux GND', () => {
    // VM de drv1 sur le rail des masses, GND.1 sur le rail VM : par la liaison GND.1-GND.2 du
    // module et la masse commune, le + de l'alim est en court-circuit avec la masse.
    const d = structuredClone(corrigee) as unknown as { connections: [string, string, string, unknown[]][] };
    for (const c of d.connections) {
      if (c[0] === 'bb1:3b.j' && c[1] === 'bb1:bp.3') c[1] = 'bb1:bn.3';
      else if (c[0] === 'bb1:4b.j' && c[1] === 'bb1:bn.4') c[1] = 'bb1:bp.4';
    }
    const r = verifierDonnees(d);
    expect(r.converge, r.message).toBe(true);
    const alim = r.calcul.sources.find((s) => s.piece === 'alim')!;
    expect(alim.regime).toBe('courant');
    expect(alim.tension).toBeLessThan(1);
    expect(r.constats.some((c) => c.piece === 'alim' && c.verdict === 'ne_marchera_pas')).toBe(true);
    expect(r.constats.some((c) => c.verdict === 'chauffe' && c.titre.includes('3,00 A'))).toBe(true);
  });

  it('les 11 montages de cas existent', () => {
    expect(Object.keys(cas)).toHaveLength(11);
  });
});

describe('rapport en ligne de commande', () => {
  it('ne signale rien sur le montage corrigé, et sort 0', () => {
    const r = verifierEnTexte(corrigee, 'corrigee');
    expect(r.code).toBe(0);
    expect(r.texte).toContain('Rien à signaler');
  });

  it('écrit verdict, explication, correction et source de chaque constat, et sort 1', () => {
    const r = verifierEnTexte(montageCas('cas-06-step-sur-io34'), 'cas 6');
    expect(r.code).toBe(1);
    expect(r.texte).toContain('NE MARCHERA PAS');
    expect(r.texte).toContain('esp:34 ne peut pas commander drv1:STEP');
    expect(r.texte).toMatch(/Correction : .*IO32/);
    expect(r.texte).toContain('Source : esp32-ds, p. 61');
  });

  it('dit pourquoi un montage est illisible, et sort 2', () => {
    const r = verifierEnTexte({ parts: [{ id: 'x', type: 'inconnu' }], connections: [] }, 'faux');
    expect(r.code).toBe(2);
    expect(r.texte).toContain('inconnu');
  });
});
