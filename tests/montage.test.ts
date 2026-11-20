// Étape 3 : lecture d'un diagram.json (pièces, réglages, extrémités des fils).
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage, MontageInvalide } from '../src/moteur/montage';

/** Petit montage de départ, modifié par chaque test. */
function montageMinimal(): { parts: Record<string, unknown>[]; connections: unknown[][] } {
  return {
    parts: [
      { type: 'board-esp32-devkit-c-v4', id: 'esp', attrs: {} },
      { type: 'wokwi-resistor', id: 'r1', attrs: { value: '10000' } },
    ],
    connections: [['esp:13', 'r1:1', 'green', []]],
  };
}

function erreursDe(donnees: unknown): string[] {
  try {
    lireMontage(donnees, catalogue);
  } catch (e) {
    if (e instanceof MontageInvalide) return e.erreurs;
    throw e;
  }
  return [];
}

describe('lecture de la base roulante', () => {
  const montage = lireMontage(baseRoulante, catalogue);

  it('rattache chaque pièce à sa fiche', () => {
    const fiches = Object.fromEntries(montage.pieces.map((p) => [p.id, p.fiche.id]));
    expect(fiches).toMatchObject({
      bb1: 'breadboard-830',
      esp: 'esp32-devkitc',
      alim: 'alim-labo',
      r1: 'resistance',
      drv1: 'tmc2209-module',
      drv4: 'tmc2209-module',
      mot1: '17hs4401',
      mot4: '17hs4401',
    });
    expect(montage.pieces).toHaveLength(12);
  });

  it('lit les réglages et complète par les valeurs par défaut des fiches', () => {
    const piece = (id: string) => montage.pieces.find((p) => p.id === id)!;
    expect(piece('alim').parametres).toEqual({ tension: 12, limite_courant: 3 });
    expect(piece('r1').parametres).toMatchObject({ value: 1000, puissance_nominale: 0.25 });
    expect(piece('drv1').parametres).toEqual({ vref: 1.2, micro_pas_uart: 16 });
    expect(piece('bb1').parametres).toEqual({ rails_coupes: false });
  });

  it('lit toutes les connexions, sans avertissement', () => {
    expect(montage.connexions).toHaveLength(baseRoulante.connections.length);
    expect(montage.avertissements).toEqual([]);
  });
});

describe('erreurs et cas particuliers', () => {
  it('accepte un montage minimal', () => {
    expect(erreursDe(montageMinimal())).toEqual([]);
  });

  it('refuse un type inconnu', () => {
    const d = montageMinimal();
    d.parts.push({ type: 'wokwi-lcd1602', id: 'lcd' });
    expect(erreursDe(d)).toEqual([expect.stringContaining('type « wokwi-lcd1602 » inconnu')]);
  });

  it('refuse une broche qui n\'existe pas', () => {
    const d = montageMinimal();
    d.connections.push(['esp:99', 'r1:2', '', []]);
    expect(erreursDe(d)).toEqual([expect.stringContaining('pas de broche « 99 »')]);
  });

  it('refuse une pièce absente', () => {
    const d = montageMinimal();
    d.connections.push(['drv9:EN', 'r1:2', '', []]);
    expect(erreursDe(d)).toEqual([expect.stringContaining('« drv9 » n\'existe pas')]);
  });

  it('refuse un id en double', () => {
    const d = montageMinimal();
    d.parts.push({ type: 'wokwi-resistor', id: 'r1' });
    expect(erreursDe(d)).toEqual([expect.stringContaining('id en double')]);
  });

  it('refuse un réglage hors de la plage de la fiche', () => {
    const d = montageMinimal();
    d.parts.push({ type: 'alim-labo', id: 'alim', attrs: { tension: '40' } });
    expect(erreursDe(d)).toEqual([expect.stringContaining('tension = 40 V dépasse le maximum (30)')]);
  });

  it('refuse un réglage qui n\'est pas un nombre', () => {
    const d = montageMinimal();
    d.parts.push({ type: 'alim-labo', id: 'alim', attrs: { tension: 'douze' } });
    expect(erreursDe(d)).toEqual([expect.stringContaining('n\'a pas le bon type')]);
  });

  it('accepte un alias de broche et le remplace par le nom de la fiche', () => {
    const d = montageMinimal();
    d.connections = [['esp:IO13', 'r1:1', '', []]];
    const montage = lireMontage(d, catalogue);
    expect(montage.connexions[0]?.de).toEqual({ piece: 'esp', broche: '13' });
  });

  it('ignore les instruments de Wokwi ($serialMonitor)', () => {
    const d = montageMinimal();
    d.connections.push(['esp:TX', '$serialMonitor:RX', '', []]);
    expect(lireMontage(d, catalogue).connexions).toHaveLength(1);
  });

  it('signale un attribut inconnu sans bloquer', () => {
    const d = montageMinimal();
    d.parts.push({ type: 'wokwi-stepper-motor', id: 'mot', attrs: { size: '17' } });
    expect(lireMontage(d, catalogue).avertissements).toEqual([expect.stringContaining('attribut « size » ignoré')]);
  });

  it('lit l\'état des broches réglé à la main, et refuse un état inconnu', () => {
    const d = montageMinimal();
    (d.parts[0] as { attrs: Record<string, unknown> }).attrs = { etats: { IO13: 'sortie_basse', '32': 'sortie_haute' } };
    expect(lireMontage(d, catalogue).pieces[0]?.etats).toEqual({ '13': 'sortie_basse', '32': 'sortie_haute' });
    (d.parts[0] as { attrs: Record<string, unknown> }).attrs = { etats: { '13': 'clignote' } };
    expect(erreursDe(d)).toEqual([expect.stringContaining('état « clignote » inconnu')]);
  });

  it('refuse un fichier qui n\'a pas la forme d\'un diagram.json', () => {
    expect(erreursDe({ parts: [] })).toEqual([expect.stringContaining('« parts » et « connections »')]);
  });
});
