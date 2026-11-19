// Étape 3 : du montage au réseau. Test du plan : les quatre EN sur le même nœud que IO13,
// et le nombre de nœuds de la base roulante égal à celui compté à la main.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { bandeBreadboard, brochesDeComposants, construireReseau } from '../src/moteur/reseau';

describe('base roulante', () => {
  const montage = lireMontage(baseRoulante, catalogue);
  const reseau = construireReseau(montage, catalogue);
  const noeud = (point: string) => {
    const n = reseau.noeudDe(point);
    if (!n) throw new Error(`point inconnu : ${point}`);
    return n;
  };

  it('met les quatre EN sur le même nœud que IO13', () => {
    const en = noeud('esp:13');
    for (const drv of ['drv1', 'drv2', 'drv3', 'drv4']) expect(noeud(`${drv}:EN`)).toBe(en);
    // Et jusque dans les puces : ENN de chaque TMC2209, GPIO13 de l'ESP32.
    expect(en.points).toEqual(expect.arrayContaining(['drv1/U1:ENN', 'drv4/U1:ENN', 'esp/U1:GPIO13']));
  });

  it('compte 30 nœuds qui relient au moins deux broches de composants', () => {
    // Compte à la main : GND, VM, 3V3, EN, UART (IO16, R1, 4 PDN_UART), TX (IO17, R1)
    // = 6 ; STEP et DIR des 4 drivers = 8 ; 4 bobines × 2 fils × 4 moteurs = 16. Total 30.
    const relies = reseau.noeuds.filter((n) => brochesDeComposants(n, montage).length >= 2);
    expect(relies).toHaveLength(30);
  });

  it('relie toutes les masses : alim, ESP32 et les deux GND de chaque driver', () => {
    const gnd = noeud('alim:-');
    for (const p of ['esp:GND.1', 'esp:GND.3', 'drv1:GND.1', 'drv1:GND.2', 'drv4:GND.2']) expect(noeud(p)).toBe(gnd);
    expect(noeud('alim:+')).not.toBe(gnd);
  });

  it('met VM des 4 drivers sur le + de l\'alim, et VDD sur le 3V3 de l\'ESP32', () => {
    for (const drv of ['drv1', 'drv2', 'drv3', 'drv4']) {
      expect(noeud(`${drv}:VM`)).toBe(noeud('alim:+'));
      expect(noeud(`${drv}:VDD`)).toBe(noeud('esp:3V3'));
    }
  });

  it('donne les adresses UART par MS1/MS2 : 0-0, 1-0, 0-1, 1-1', () => {
    const v33 = noeud('esp:3V3');
    const adresse = (drv: string) => [noeud(`${drv}:MS1`) === v33 ? 1 : 0, noeud(`${drv}:MS2`) === v33 ? 1 : 0];
    expect(['drv1', 'drv2', 'drv3', 'drv4'].map(adresse)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });

  it('isole chaque STEP et chaque bobine', () => {
    expect(brochesDeComposants(noeud('drv1:STEP'), montage)).toEqual(['drv1:STEP', 'esp:32']);
    expect(brochesDeComposants(noeud('mot2:A+'), montage)).toEqual(['drv2:A1', 'mot2:A+']);
  });

  it('garde les résistances internes comme éléments entre deux nœuds', () => {
    const tirageEN = reseau.elements.find((e) => e.piece === 'drv1' && e.entre[0] === 'drv1:EN');
    expect(tirageEN?.type).toBe('resistance');
    expect(tirageEN?.noeuds).toEqual([noeud('esp:13').id, noeud('esp:3V3').id]);
    expect(tirageEN?.valeur?.typ).toBe(20);
  });

  it('accepte un alias dans noeudDe', () => {
    expect(reseau.noeudDe('esp:IO13')).toBe(noeud('esp:13'));
  });
});

describe('bandes de la breadboard', () => {
  it('regroupe les trous par colonne et par rail', () => {
    expect(bandeBreadboard('27t.c', false)).toBe('27t');
    expect(bandeBreadboard('27b.f', false)).toBe('27b');
    expect(bandeBreadboard('tn.6', false)).toBe('tn');
    expect(bandeBreadboard('bp.26', true)).toBe('bp-2');
    expect(bandeBreadboard('bp.25', true)).toBe('bp-1');
    expect(bandeBreadboard('GND', false)).toBeUndefined();
  });

  const reseauDe = (connections: string[][], railsCoupes = false) => {
    const montage = lireMontage(
      {
        parts: [
          { type: 'wokwi-breadboard', id: 'bb', attrs: { rails_coupes: String(railsCoupes) } },
          { type: 'wokwi-resistor', id: 'ra' },
          { type: 'wokwi-resistor', id: 'rb' },
        ],
        connections,
      },
      catalogue,
    );
    return construireReseau(montage, catalogue);
  };

  it('relie deux pattes dans la même colonne d\'une même moitié', () => {
    const r = reseauDe([['ra:1', 'bb:10t.a'], ['rb:1', 'bb:10t.e']]);
    expect(r.noeudDe('ra:1')).toBe(r.noeudDe('rb:1'));
  });

  it('ne relie pas les deux moitiés d\'une colonne ni deux colonnes voisines', () => {
    const r = reseauDe([['ra:1', 'bb:10t.e'], ['rb:1', 'bb:10b.f'], ['rb:2', 'bb:11t.e']]);
    expect(r.noeudDe('ra:1')).not.toBe(r.noeudDe('rb:1'));
    expect(r.noeudDe('ra:1')).not.toBe(r.noeudDe('rb:2'));
  });

  it('relie tout un rail, sauf si les rails sont coupés au milieu', () => {
    const fils = [['ra:1', 'bb:tp.1'], ['rb:1', 'bb:tp.50']];
    const continu = reseauDe(fils);
    expect(continu.noeudDe('ra:1')).toBe(continu.noeudDe('rb:1'));
    const coupe = reseauDe(fils, true);
    expect(coupe.noeudDe('ra:1')).not.toBe(coupe.noeudDe('rb:1'));
  });
});
