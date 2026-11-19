// Étape 5 : calcul en continu. Six circuits calculés à la main, à moins de 1 % près, puis la
// base roulante. Le détail de chaque calcul à la main est écrit au-dessus du test.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { calculer } from '../src/moteur/circuit';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { courantSaturation, resoudre, VT_25C } from '../src/moteur/solveur';

/** Vérifie qu'une valeur calculée est à moins de 1 % de la valeur calculée à la main. */
function aUnPourcent(calcule: number | undefined, main: number): void {
  expect(calcule).toBeDefined();
  expect(Math.abs(calcule! - main), `calculé ${calcule}, à la main ${main}`).toBeLessThanOrEqual(0.01 * Math.abs(main));
}

type Partie = { type: string; id: string; attrs?: Record<string, unknown> };
/** Montage au format diagram.json ; chaque connexion est un fil (couleur verte). */
function monter(parts: Partie[], fils: [string, string][]) {
  const m = lireMontage({ parts, connections: fils.map(([a, b]) => [a, b, 'green', []]) }, catalogue);
  return { montage: m, calcul: calculer(m, catalogue) };
}

/** Résistance d'un fil Dupont, lue dans sa fiche (0,045 Ω). */
const R_FIL = 0.045;

describe('six circuits calculés à la main', () => {
  it('1. pont diviseur : 12 V sur 10 kΩ + 4,7 kΩ donne 3,837 V au milieu', () => {
    // V = 12 × 4,7 / (10 + 4,7) = 3,8367 V ; I = 12 V / 14,7 kΩ = 0,8163 mA (les fils comptent pour 0,1 mΩ sur 14,7 kΩ).
    const { calcul } = monter(
      [
        { type: 'alim-labo', id: 'alim', attrs: { tension: 12, limite_courant: 1 } },
        { type: 'wokwi-resistor', id: 'r1', attrs: { value: '10000' } },
        { type: 'wokwi-resistor', id: 'r2', attrs: { value: '4700' } },
      ],
      [
        ['alim:+', 'r1:1'],
        ['r1:2', 'r2:1'],
        ['r2:2', 'alim:-'],
      ],
    );
    expect(calcul.converge).toBe(true);
    aUnPourcent(calcul.difference('r2:1', 'alim:-'), (12 * 4.7) / 14.7);
    aUnPourcent(calcul.courantFil(0), 12 / 14700);
    expect(calcul.sources[0]?.regime).toBe('tension');
  });

  it('2. LED + résistance : 5 V sur 150 Ω et une LED de 2 V donnent 20 mA', () => {
    // I = (5 − 2) / 150 = 20 mA, et la LED a bien 2 V à 20 mA (c'est ainsi qu'on l'a définie).
    // Aucune fiche de LED pour l'instant : le circuit est écrit directement pour le solveur.
    const n = 2;
    const led = { is: courantSaturation(2.0, 0.02, n), nvt: n * VT_25C };
    const s = resoudre(3, [
      { type: 'source', plus: 1, moins: 0, v: 5, absorbe: true },
      { type: 'resistance', a: 1, b: 2, r: 150 },
      { type: 'diode', anode: 2, cathode: 0, ...led },
    ]);
    expect(s.converge).toBe(true);
    aUnPourcent(s.courants[1], 0.02);
    aUnPourcent(s.tensions[2], 2.0);
  });

  it('3. alim limitée à 1 A en court-circuit : 1 A, et 45 mV aux bornes du fil', () => {
    // La limite est atteinte : courant constant de 1 A, tension = 1 A × 0,045 Ω.
    const { calcul } = monter([{ type: 'alim-labo', id: 'alim', attrs: { tension: 12, limite_courant: 1 } }], [['alim:+', 'alim:-']]);
    expect(calcul.converge).toBe(true);
    expect(calcul.sources[0]?.regime).toBe('courant');
    aUnPourcent(calcul.courantFil(0), 1);
    aUnPourcent(calcul.difference('alim:+', 'alim:-'), R_FIL);
  });

  describe('4. deux sources qui se battent : alim de labo face à une LiPo 4S', () => {
    const montage = (tension: number) =>
      monter(
        [
          { type: 'alim-labo', id: 'alim', attrs: { tension, limite_courant: 1 } },
          { type: 'lipo-4s', id: 'batt', attrs: { tension_element: 3.7 } },
        ],
        [
          ['alim:+', 'batt:+'],
          ['alim:-', 'batt:-'],
        ],
      );

    it('alim à 16 V, batterie à 14,8 V : l\'alim plafonne à 1 A et charge la batterie', () => {
      // Sans limite : (16 − 14,8) / (0,03 + 2 × 0,045) = 10 A. Limite : 1 A,
      // alim à 14,8 + 1 × (0,03 + 0,09) = 14,92 V.
      const { calcul } = montage(16);
      expect(calcul.converge).toBe(true);
      const alim = calcul.sources.find((s) => s.piece === 'alim')!;
      expect(alim.regime).toBe('courant');
      aUnPourcent(alim.courant, 1);
      aUnPourcent(calcul.difference('alim:+', 'alim:-'), 14.92);
      aUnPourcent(calcul.courantFil(0), 1);
    });

    it('alim à 12 V, batterie à 14,8 V : l\'alim ne peut pas absorber, elle se coupe', () => {
      // Une alim de labo ne reçoit pas de courant : sa sortie monte à 14,8 V et le courant s'annule.
      const { calcul } = montage(12);
      expect(calcul.converge).toBe(true);
      const alim = calcul.sources.find((s) => s.piece === 'alim')!;
      expect(alim.regime).toBe('coupee');
      expect(Math.abs(calcul.courantFil(0)!)).toBeLessThan(1e-6);
      aUnPourcent(calcul.difference('alim:+', 'alim:-'), 14.8);
    });
  });

  it('5. consommation d\'un driver : VREF à 1,2 V, deux bobines de 1,5 Ω, VM à 12 V donnent 0,252 A', () => {
    // Courant par bobine (p. 53) : 325 mV / (0,11 + 0,02) Ω × 1/√2 × 1,2 / 2,5 = 0,8485 A.
    // Boucle d'une bobine : 1,5 (moteur) + 2 × 0,045 (fils) + 0,17 (MOSFET bas) + 0,11 (mesure) = 1,87 Ω,
    // plus 0,17 Ω de MOSFET haut pour les pertes : P = 0,8485² × 2,04 = 1,469 W par bobine, 2,938 W en tout.
    // Courant sur VM : 2,938 W / 12 V + 7,5 mA (consommation propre, p. 76) = 0,2523 A.
    const { montage, calcul } = monter(
      [
        { type: 'alim-labo', id: 'alim', attrs: { tension: 12, limite_courant: 2 } },
        { type: 'board-esp32-devkit-c-v4', id: 'esp' },
        { type: 'tmc2209-module', id: 'drv', attrs: { vref: 1.2 } },
        { type: 'wokwi-stepper-motor', id: 'mot' },
      ],
      [
        ['alim:+', 'drv:VM'],
        ['alim:-', 'drv:GND.1'],
        ['esp:3V3', 'drv:VDD'],
        ['esp:GND.1', 'drv:GND.2'],
        ['drv:EN', 'esp:GND.2'],
        ['drv:A1', 'mot:A+'],
        ['drv:A2', 'mot:A-'],
        ['drv:B1', 'mot:B+'],
        ['drv:B2', 'mot:B-'],
      ],
    );
    expect(calcul.converge, calcul.message).toBe(true);
    expect(calcul.drivers[0]?.actif).toBe(true);
    const fil = (a: string) => montage.connexions.findIndex((c) => `${c.de.piece}:${c.de.broche}` === a);
    const courantBobine = (0.325 / 0.13) * Math.SQRT1_2 * (1.2 / 2.5);
    aUnPourcent(calcul.drivers[0]?.courantBobine, courantBobine);
    aUnPourcent(calcul.courantFil(fil('drv:A1')), courantBobine);
    aUnPourcent(calcul.courantFil(fil('drv:B1')), courantBobine);
    const puissance = 2 * courantBobine ** 2 * (1.5 + 2 * R_FIL + 0.17 + 0.11 + 0.17);
    aUnPourcent(calcul.drivers[0]?.puissance, puissance);
    aUnPourcent(calcul.courantFil(fil('alim:+')), puissance / 12 + 0.0075);
  });

  it('6. 12 V à travers 10 kΩ sur IO13 : environ 0,8 mA dans la diode de protection', () => {
    // La diode vers le 3,3 V conduit : I = (12 − 3,3 − 0,6) V / 10 kΩ = 0,81 mA, broche à 3,3 + 0,6 = 3,9 V.
    const { calcul } = monter(
      [
        { type: 'alim-labo', id: 'alim', attrs: { tension: 12, limite_courant: 1 } },
        { type: 'wokwi-resistor', id: 'r', attrs: { value: '10000' } },
        { type: 'board-esp32-devkit-c-v4', id: 'esp', attrs: { etats: { '13': 'entree' } } },
      ],
      [
        ['alim:+', 'r:1'],
        ['r:2', 'esp:13'],
        ['alim:-', 'esp:GND.1'],
      ],
    );
    expect(calcul.converge, calcul.message).toBe(true);
    aUnPourcent(calcul.courantFil(0), (12 - 3.3 - 0.6) / 10000);
    aUnPourcent(calcul.difference('esp:13', 'esp:GND.1'), 3.9);
    const k = calcul.etiquettes.findIndex((e) => e.piece === 'esp/U1' && e.role === 'diode_protection' && e.broches[0] === 'GPIO13' && e.broches[1] === 'VDD3P3');
    aUnPourcent(calcul.solution.courants[k], (12 - 3.3 - 0.6) / 10000);
  });
});

describe('base roulante', () => {
  const montage = lireMontage(baseRoulante, catalogue);
  const calcul = calculer(montage, catalogue);

  it('se calcule', () => {
    expect(calcul.converge, calcul.message).toBe(true);
    expect(calcul.avertissements).toEqual([]);
  });

  it('met EN vers 2,97 V au démarrage : 45 kΩ vers la masse (IO13) face à 4 × 20 kΩ vers 3,3 V', () => {
    // Quatre tirages de 20 kΩ en parallèle font 5 kΩ : EN = 3,3 × 45 / (45 + 5) = 2,97 V,
    // au-dessus du seuil haut du TMC2209 (0,7 × 3,3 = 2,31 V) : les drivers démarrent coupés.
    aUnPourcent(calcul.difference('esp:13', 'esp:GND.1'), (3.3 * 45) / 50);
    for (const d of calcul.drivers) expect(d.actif, d.raison).toBe(false);
  });

  it('ne prend sur l\'alim que la consommation propre des quatre drivers coupés : 4 × 7 mA', () => {
    const alim = calcul.sources.find((s) => s.piece === 'alim')!;
    expect(alim.regime).toBe('tension');
    aUnPourcent(alim.courant, 4 * 0.007);
  });
});
