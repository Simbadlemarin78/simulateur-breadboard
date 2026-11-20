// Effets sous tension : un moteur qui tourne (vitesse, sens, couple, vitesse max) et une LED qui
// s'allume. Les valeurs attendues sont calculées à la main au-dessus de chaque test.
import { describe, expect, it } from 'vitest';
import corrigee from '../montages/base-roulante-corrigee.diagram.json';
import cas06 from '../montages/cas/cas-06-step-sur-io34.diagram.json';
import type { EffetLed, EffetMoteur } from '../src/moteur/effets';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { VT_25C } from '../src/moteur/solveur';
import { verifier } from '../src/moteur/verifications';
import { Editeur, type Diagramme } from '../src/ui/edition';
import { htmlEffets } from '../src/ui/affichage';
import { dessinPour } from '../src/ui/pieces/dessins';

function aPres(calcule: number | undefined, main: number, tolerance = 0.01): void {
  expect(calcule).toBeDefined();
  expect(Math.abs(calcule! - main), `calculé ${calcule}, à la main ${main}`).toBeLessThanOrEqual(tolerance * Math.abs(main));
}

/** Base roulante corrigée, l'ESP32 réglé à la main : EN bas (drivers actifs), DIR, et les impulsions STEP. */
function base(etats: Record<string, string>, frequences: Record<string, number> = {}, montage: unknown = corrigee) {
  const d = structuredClone(montage) as Diagramme;
  const esp = d.parts.find((p) => p.id === 'esp')!;
  esp.attrs = { ...esp.attrs, etats, frequences };
  const r = verifier(lireMontage(d, catalogue), catalogue);
  expect(r.converge, r.message).toBe(true);
  const moteur = (id: string) => r.effets.find((e): e is EffetMoteur => e.type === 'moteur' && e.piece === id)!;
  return { r, moteur };
}

// Driver à VREF = 1,2 V : I = 0,325 / (0,11 + 0,02) / √2 × 1,2 / 2,5 = 0,8485 A par bobine.
const I = (0.325 / 0.13) * Math.SQRT1_2 * (1.2 / 2.5);
// Couple : 0,4 N·m au courant nominal de 1,7 A → 0,4 × 0,8485 / 1,7 = 0,1996 N·m.
const COUPLE = (0.4 * I) / 1.7;

describe('moteur pas à pas', () => {
  it('3 200 impulsions/s, 16 micro-pas (UART) : 1 tr/s, 60 tr/min, roue de 60 mm à 0,188 m/s', () => {
    // UART utilisée sur la base roulante : micro-pas du programme, 16 par défaut.
    // 3 200 / (16 × 200) = 1 tr/s ; roue : π × 0,060 × 1 = 0,1885 m/s. DIR à 0 : sens +.
    const { r, moteur } = base({ '13': 'sortie_basse', '32': 'impulsions', '33': 'sortie_basse' }, { '32': 3200 });
    const m = moteur('mot1');
    expect(m).toMatchObject({ tourne: true, driver: 'drv1', source: 'esp:32', microPas: 16, reglageMicroPas: 'UART', sens: 1 });
    aPres(m.toursParSeconde, 1);
    aPres(m.roue?.vitesse, Math.PI * 0.06);
    aPres(m.courant, I);
    aPres(m.coupleArret, COUPLE);
    // À 1 tr/s, il faut √((1,84 × 0,8485 + 0,1176 × 6,28)² + (2,8 mH × 50 × 6,28 × 0,8485)²) = 2,42 V,
    // bien sous 12 × 255 / 374 = 8,18 V : le driver tient son courant, couple plein.
    aPres(m.couple, COUPLE);
    // Les trois autres moteurs n'ont pas d'impulsions.
    expect(moteur('mot2')).toMatchObject({ tourne: false });
    expect(moteur('mot2').raison).toContain('STEP');
    expect(r.constats.filter((c) => c.piece.startsWith('mot'))).toEqual([]);
  });

  it('vitesse max à ce courant : environ 400 tr/min sous 12 V', () => {
    // R = 1,5 + 2 × 0,17 = 1,84 Ω ; C = 0,4 / (2 × 1,7) = 0,1176 V/(rad/s) (TMC2209 p. 44) ;
    // L·ωe = 2,8 mH × 50 × ω ; tension disponible U = 12 × 255 / 374 = 8,182 V (p. 43).
    // (C² + (L·50·I)²) ω² + 2·C·R·I·ω + (R·I)² − U² = 0 → ω = 41,91 rad/s = 6,67 tr/s = 400 tr/min.
    // VS est un peu sous 12 V (fils et contacts) : 2 % de marge.
    const { moteur } = base({ '13': 'sortie_basse', '32': 'impulsions', '33': 'sortie_basse' }, { '32': 3200 });
    aPres(moteur('mot1').vitesseMax, 41.91 / (2 * Math.PI), 0.02);
  });

  it('10 tr/s, au-delà de la vitesse max : courant tenu vers 0,25 A, couple réduit à 30 %, sans verdict', () => {
    // ω = 62,83 rad/s : X = 2,8 mH × 50 × ω = 8,796 Ω ; C·ω = 7,392 V.
    // (R² + X²) I² + 2·R·C·ω·I + (C·ω)² − U² = 0. Sous 12 V tout rond (U = 8,182 V) : I = 0,2566 A.
    // Près de la limite, I dépend beaucoup de U : on part du VS calculé (un peu sous 12 V à cause
    // des fils et des contacts), puis on résout à la main.
    const { r, moteur } = base({ '13': 'sortie_basse', '32': 'impulsions', '33': 'sortie_haute' }, { '32': 32000 });
    const m = moteur('mot1');
    expect(m.sens).toBe(-1);
    aPres(m.toursParSeconde, -10);
    const vs = r.calcul.difference('drv1/U1:VS', 'drv1/U1:GND')!;
    expect(vs).toBeGreaterThan(11.8);
    const w = 20 * Math.PI;
    const [R, C, X, U] = [1.84, 0.4 / 3.4, 2.8e-3 * 50 * w, (vs * 255) / 374];
    const a = R * R + X * X;
    const b = 2 * R * C * w;
    const i = (-b + Math.sqrt(b * b - 4 * a * ((C * w) ** 2 - U * U))) / (2 * a);
    aPres(m.courantEffectif, i);
    aPres(m.couple, (0.4 / 1.7) * i);
    expect(m.couple! / m.coupleArret!).toBeGreaterThan(0.25);
    expect(m.couple! / m.coupleArret!).toBeLessThan(0.35);
    expect(r.constats.some((c) => c.piece === 'mot1')).toBe(false);
    expect(htmlEffets(r.effets)).toMatch(/couple ≈ 0,0\d N·m \(\d\d %\)/);
  });

  it('20 tr/s : la f.c.é.m. dépasse la tension disponible, « ne marchera pas »', () => {
    // C·ω = 0,1176 × 125,7 = 14,8 V > 8,18 V : le courant tombe à zéro, le moteur décroche.
    const { r } = base({ '13': 'sortie_basse', '32': 'impulsions', '33': 'sortie_basse' }, { '32': 64000 });
    const c = r.constats.find((x) => x.piece === 'mot1');
    expect(c).toMatchObject({ verdict: 'ne_marchera_pas', origine: 'calcul' });
    expect(c!.titre).toContain('1200 tr/min demandés');
  });

  it('ne tourne pas sans impulsions, ni driver coupé (EN haut), ni depuis une broche d\'entrée seule (cas 6)', () => {
    expect(base({ '13': 'sortie_basse' }).moteur('mot1')).toMatchObject({ tourne: false, driver: 'drv1' });
    const coupe = base({ '13': 'sortie_haute', '32': 'impulsions' }, { '32': 3200 }).moteur('mot1');
    expect(coupe.tourne).toBe(false);
    expect(coupe.raison).toContain('coupé');
    // Cas 6 : STEP de drv1 sur IO34, qui ne peut pas être une sortie.
    const io34 = base({ '13': 'sortie_basse', '34': 'impulsions' }, { '34': 3200 }, cas06).moteur('mot1');
    expect(io34.tourne).toBe(false);
    expect(io34.raison).toContain('entrée seule');
  });

  it('la roue tourne sur le plan, dans le sens de DIR, et l\'éditeur règle état et fréquence en un seul Ctrl+Z', () => {
    const { r, moteur } = base({ '13': 'sortie_basse', '32': 'impulsions', '33': 'sortie_haute' }, { '32': 3200 });
    const piece = lireMontage(corrigee, catalogue).pieces.find((p) => p.id === 'mot1')!;
    const svg = dessinPour(piece.fiche).corps(piece, moteur('mot1'));
    expect(svg).toContain('class="rotor tourne inverse" style="animation-duration:1.000s"');
    expect(svg).toContain('60 tr/min ↺ · 0,19 m/s');
    expect(r.effets.filter((e) => e.type === 'moteur')).toHaveLength(4);

    const editeur = new Editeur(catalogue, corrigee as unknown as Diagramme);
    const avant = editeur.exporter();
    editeur.reglerBroche('esp', '32', 'impulsions');
    expect(editeur.diagramme.parts.find((p) => p.id === 'esp')!.attrs['frequences']).toEqual({ '32': 1000 });
    editeur.reglerBroche('esp', '32', 'impulsions', 2500);
    expect(editeur.montage().pieces.find((p) => p.id === 'esp')!.frequences).toEqual({ '32': 2500 });
    editeur.reglerBroche('esp', '32', '');
    expect(editeur.diagramme.parts.find((p) => p.id === 'esp')!.attrs['frequences']).toBeUndefined();
    editeur.annuler();
    editeur.annuler();
    editeur.annuler();
    expect(editeur.exporter()).toBe(avant);
  });
});

/** Courant d'une LED en série avec une résistance r sous une tension u, par point fixe sur sa loi. */
function courantLed(u: number, r: number): number {
  // Modèle de la fiche : V = 1,855 + 3,5·VT·ln(I / 10 mA) + 4,5 Ω × I.
  let i = 0.01;
  for (let k = 0; k < 200; k++) i = (u - 1.855 - 3.5 * VT_25C * Math.log(i / 0.01)) / (r + 4.5);
  return i;
}

describe('LED rouge 5 mm', () => {
  type Partie = { type: string; id: string; attrs?: Record<string, unknown> };
  function monter(parts: Partie[], fils: [string, string][]) {
    const r = verifier(lireMontage({ parts, connections: fils.map(([a, b]) => [a, b, 'green', []]) }, catalogue), catalogue);
    expect(r.converge, r.message).toBe(true);
    return { r, led: r.effets.find((e): e is EffetLed => e.type === 'led')! };
  }
  const alim = (v: number): Partie => ({ type: 'alim-labo', id: 'alim', attrs: { tension: v, limite_courant: 1 } });
  const R_FIL = 0.045;

  it('5 V et 330 Ω : 9,4 mA, allumée à 47 %, environ 47 mcd, sans alerte', () => {
    // 5 = (330 + 2 × 0,045) × I + V(I) → I = 9,42 mA ; éclat I / 20 mA ; intensité 50 mcd × I / 10 mA.
    const { r, led } = monter(
      [alim(5), { type: 'wokwi-resistor', id: 'r1', attrs: { value: '330' } }, { type: 'wokwi-led', id: 'led1' }],
      [
        ['alim:+', 'r1:1'],
        ['r1:2', 'led1:A'],
        ['led1:C', 'alim:-'],
      ],
    );
    const i = courantLed(5, 330 + 3 * R_FIL);
    aPres(led.courant, i);
    aPres(led.eclat, i / 0.02);
    aPres(led.intensite, (50 * i) / 0.01);
    expect(r.constats).toEqual([]);
    const piece = lireMontage({ parts: [{ type: 'wokwi-led', id: 'led1' }], connections: [] }, catalogue).pieces[0]!;
    expect(dessinPour(piece.fiche).corps(piece, led)).toContain('corps-led allumee');
  });

  it('5 V sans résistance : 0,6 A, au-delà des 160 mA de crête, grillée', () => {
    // 5 = 2 × 0,045 × I + V(I) → I ≈ 0,60 A, sous la limite de 1 A de l'alim.
    const { r, led } = monter([alim(5), { type: 'wokwi-led', id: 'led1' }], [
      ['alim:+', 'led1:A'],
      ['led1:C', 'alim:-'],
    ]);
    aPres(led.courant, courantLed(5, 2 * R_FIL), 0.02);
    expect(r.parPiece.get('led1')).toBe('grille');
  });

  it('à l\'envers : éteinte et « ne marchera pas » sous 5 V, « risque élevé » sous 9 V (tension inverse max 5 V)', () => {
    const fils: [string, string][] = [
      ['alim:+', 'r1:1'],
      ['r1:2', 'led1:C'],
      ['led1:A', 'alim:-'],
    ];
    const parts = (v: number): Partie[] => [alim(v), { type: 'wokwi-resistor', id: 'r1', attrs: { value: '330' } }, { type: 'wokwi-led', id: 'led1' }];
    const cinq = monter(parts(5), fils);
    expect(cinq.led.eclat).toBe(0);
    expect(cinq.r.parPiece.get('led1')).toBe('ne_marchera_pas');
    expect(monter(parts(9), fils).r.parPiece.get('led1')).toBe('risque_eleve');
  });

  it('directement sur une GPIO de la Pi 5 : LED sous 30 mA, mais la broche dépasse ses 16 mA', () => {
    // 3,3 = (42 + 2 × 0,045 + 4,5) × I + V(I) : environ 29 mA.
    const { r, led } = monter([{ type: 'raspberry-pi-5', id: 'pi', attrs: { etats: { GPIO17: 'sortie_haute' } } }, { type: 'wokwi-led', id: 'led1' }], [
      ['pi:GPIO17', 'led1:A'],
      ['led1:C', 'pi:GND.2'],
    ]);
    aPres(led.courant, courantLed(3.3, 42 + 2 * R_FIL), 0.02);
    expect(r.parPiece.get('led1')).toBeUndefined();
    const c = r.constats.find((x) => x.piece === 'pi');
    expect(c).toMatchObject({ verdict: 'risque_eleve' });
    expect(c!.titre).toContain('au-delà de 16,0 mA');
  });
});
