// Raspberry Pi 5 (fiches raspberry-pi-5 et rp1, skill /ajouter-composant) : le 5 V et le 3,3 V
// de la carte, une sortie GPIO calculée à la main, et les erreurs typiques (5 V sur une GPIO,
// 12 V sur la broche 5V, Pi non alimentée, masses non reliées avec un ESP32).
import { describe, expect, it } from 'vitest';
import { calculer } from '../src/moteur/circuit';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { verifier } from '../src/moteur/verifications';
import { diagrammeVide, Editeur } from '../src/ui/edition';
import { dessinPour } from '../src/ui/pieces/dessins';

/** Vérifie qu'une valeur calculée est à moins de 1 % de la valeur calculée à la main. */
function aUnPourcent(calcule: number | undefined, main: number): void {
  expect(calcule).toBeDefined();
  expect(Math.abs(calcule! - main), `calculé ${calcule}, à la main ${main}`).toBeLessThanOrEqual(0.01 * Math.abs(main));
}

type Partie = { type: string; id: string; attrs?: Record<string, unknown> };
function monter(parts: Partie[], fils: [string, string][]) {
  const montage = lireMontage({ parts, connections: fils.map(([a, b]) => [a, b, 'green', []]) }, catalogue);
  return { montage, calcul: calculer(montage, catalogue), rapport: verifier(montage, catalogue) };
}
const resume = (r: ReturnType<typeof verifier>) => r.constats.map((c) => `${c.verdict} ${c.piece} ${c.titre}`).join('\n');

/** Résistance d'un fil Dupont (fiche fil-dupont) et consommation de la Pi vue sur le 5 V. */
const R_FIL = 0.045;
const R_CONSO = 5 / 0.8;

describe('Raspberry Pi 5', () => {
  it('sur son bloc USB-C : 5 V et 3,3 V sur le connecteur, SDA tirée à 3,3 V, aucune alerte', () => {
    const { calcul, rapport } = monter([{ type: 'raspberry-pi-5', id: 'pi' }], []);
    expect(calcul.converge, calcul.message).toBe(true);
    aUnPourcent(calcul.difference('pi:5V.2', 'pi:GND.8'), 5);
    aUnPourcent(calcul.difference('pi:3V3.2', 'pi:GND.3'), 3.3);
    // GPIO2 (SDA) : tirage de 1,8 kΩ vers le 3,3 V, entrée sans courant.
    aUnPourcent(calcul.difference('pi:GPIO2', 'pi:GND.1'), 3.3);
    expect(rapport.constats, resume(rapport)).toEqual([]);
  });

  it('une sortie haute dans 1 kΩ : 3,17 mA, à travers les 42 Ω de la sortie', () => {
    // I = 3,3 / (1000 + 42 + 2 × 0,045) = 3,1667 mA ; tension aux bornes de la résistance : 3,1667 V.
    const { calcul, rapport } = monter(
      [
        { type: 'raspberry-pi-5', id: 'pi', attrs: { etats: { GPIO17: 'sortie_haute' } } },
        { type: 'wokwi-resistor', id: 'r1', attrs: { value: '1000' } },
      ],
      [
        ['pi:GPIO17', 'r1:1'],
        ['r1:2', 'pi:GND.2'],
      ],
    );
    const i = 3.3 / (1000 + 42 + 2 * R_FIL);
    aUnPourcent(calcul.courantFil(0), i);
    aUnPourcent(calcul.difference('r1:1', 'r1:2'), 1000 * i);
    expect(rapport.constats, resume(rapport)).toEqual([]);
  });

  it('5 V sur une GPIO : risque élevé (au-delà de 3,8 V), jamais grillé faute de donnée de courant', () => {
    const { rapport } = monter([{ type: 'raspberry-pi-5', id: 'pi' }], [['pi:5V.1', 'pi:GPIO17']]);
    const c = rapport.constats.find((x) => x.piece === 'pi' && x.titre.includes('GPIO17'));
    expect(c, resume(rapport)).toMatchObject({ verdict: 'risque_eleve', origine: 'calcul' });
    expect(c!.titre).toContain('3,80 V');
    expect(c!.source?.fiche).toBe('rp1');
    expect(rapport.parPiece.get('pi')).toBe('risque_eleve');
  });

  it('12 V sur la broche 5V : risque élevé (maximum de 6 V, hypothèse reprise de la CM5)', () => {
    const { rapport } = monter(
      [
        { type: 'raspberry-pi-5', id: 'pi' },
        { type: 'alim-labo', id: 'alim', attrs: { tension: 12, limite_courant: 3 } },
      ],
      [
        ['alim:+', 'pi:5V.2'],
        ['alim:-', 'pi:GND.1'],
      ],
    );
    const c = rapport.constats.find((x) => x.piece === 'pi' && x.titre.includes('5V.1'));
    expect(c, resume(rapport)).toMatchObject({ verdict: 'risque_eleve' });
    expect(c!.source?.src.type).toBe('hypothese');
  });

  it('sans alimentation : ne marchera pas', () => {
    const { rapport } = monter([{ type: 'raspberry-pi-5', id: 'pi', attrs: { alimentation_usb: false } }], []);
    const c = rapport.constats.find((x) => x.piece === 'pi' && x.titre.includes('5V.1'));
    expect(c, resume(rapport)).toMatchObject({ verdict: 'ne_marchera_pas' });
    expect(c!.explication).toContain('pas alimentée');
  });

  it('alimentée par sa broche 5V depuis une alim de labo : 0,79 A de consommation, sans alerte', () => {
    // I = 5 / (6,25 + 2 × 0,045) = 0,7886 A ; 5V.1 à 0,7886 × 6,25 = 4,93 V, dans la plage 4,75 à 5,25 V.
    const { calcul, rapport } = monter(
      [
        { type: 'raspberry-pi-5', id: 'pi', attrs: { alimentation_usb: false } },
        { type: 'alim-labo', id: 'alim', attrs: { tension: 5, limite_courant: 3 } },
      ],
      [
        ['alim:+', 'pi:5V.1'],
        ['alim:-', 'pi:GND.1'],
      ],
    );
    const i = 5 / (R_CONSO + 2 * R_FIL);
    aUnPourcent(calcul.courantFil(0), i);
    aUnPourcent(calcul.difference('pi:5V.1', 'pi:GND.1'), i * R_CONSO);
    expect(rapport.constats, resume(rapport)).toEqual([]);
  });

  it('se pose depuis la palette sous le nom pi1, et ne s\'enfiche pas (ses deux rangées tomberaient sur la même bande)', () => {
    const editeur = new Editeur(catalogue, diagrammeVide());
    expect(editeur.ajouterPiece('breadboard-830', 0, 0)).toBe('bb1');
    const id = editeur.ajouterPiece('raspberry-pi-5', 0, 300);
    expect(id).toBe('pi1');
    // Broche 1 posée sur le trou 10t.e : la broche 2 tombe sur 10t.d, même bande. La Pi reste
    // posée là, sans être enfichée : on la relie par des fils.
    const trou = dessinPour(catalogue.fiche('breadboard-830')!).broches.get('10t.e')!;
    const un = dessinPour(catalogue.fiche('raspberry-pi-5')!).broches.get('3V3.1')!;
    expect(editeur.deplacerPiece(id, trou.x - un.x, trou.y - un.y)).toBeUndefined();
    expect(editeur.diagramme.parts.find((p) => p.id === id)).toMatchObject({ left: trou.x - un.x, top: trou.y - un.y });
    expect(editeur.diagramme.connections.filter((c) => c[0].startsWith(`${id}:`) || c[1].startsWith(`${id}:`))).toEqual([]);
  });

  it('liaison série avec l\'ESP32 : sans alerte masses reliées, « ne marchera pas » sans le fil de masse', () => {
    const parts: Partie[] = [
      { type: 'raspberry-pi-5', id: 'pi' },
      { type: 'board-esp32-devkit-c-v4', id: 'esp', attrs: { etats: { '17': 'sortie_haute' } } },
    ];
    const relie = monter(parts, [
      ['esp:17', 'pi:GPIO15'],
      ['esp:GND.1', 'pi:GND.1'],
    ]);
    aUnPourcent(relie.calcul.difference('pi:GPIO15', 'pi:GND.1'), 3.3);
    expect(relie.rapport.constats, resume(relie.rapport)).toEqual([]);
    const separe = monter(parts, [['esp:17', 'pi:GPIO15']]);
    const c = separe.rapport.constats.find((x) => x.verdict === 'ne_marchera_pas' && x.titre.includes('masse'));
    expect(c, resume(separe.rapport)).toBeDefined();
    // Deux GPIO entrée-sortie : le moteur ne sait pas qui commande qui, la phrase reste neutre.
    expect(c!.explication).toContain('échangent un signal');
  });
});
