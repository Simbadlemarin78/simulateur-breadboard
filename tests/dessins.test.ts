// Étape 4 : affichage 2D. Test du plan : chaque broche de chaque fiche a une position sur
// son dessin. On vérifie aussi que les pièces enfichées tombent pile sur leurs trous.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { construireReseau } from '../src/moteur/reseau';
import { dessinPour, P } from '../src/ui/pieces/dessins';
import { dessinerPlan, filsVisibles, placerPieces, positionBroche } from '../src/ui/plan';

describe.each(catalogue.fiches.map((f) => [f.id, f] as const))('dessin de %s', (_id, fiche) => {
  const dessin = dessinPour(fiche);

  it('donne une position à chaque broche, dans le dessin', () => {
    const sansPosition = fiche.broches.filter((b) => !dessin.broches.has(b.nom)).map((b) => b.nom);
    expect(sansPosition).toEqual([]);
    for (const [nom, p] of dessin.broches) {
      expect(p.x, nom).toBeGreaterThanOrEqual(0);
      expect(p.y, nom).toBeGreaterThanOrEqual(0);
      expect(p.x, nom).toBeLessThanOrEqual(dessin.largeur);
      expect(p.y, nom).toBeLessThanOrEqual(dessin.hauteur);
    }
  });

  it('ne met pas deux broches au même endroit', () => {
    const positions = new Set([...dessin.broches.values()].map((p) => `${p.x},${p.y}`));
    expect(positions.size).toBe(dessin.broches.size);
  });
});

describe('géométrie des dessins', () => {
  it('écarte les deux rangées de la DevKitC d\'un pouce (10 pas)', () => {
    const esp = dessinPour(catalogue.fiche('esp32-devkitc')!);
    expect(esp.broches.get('GND.2')!.x - esp.broches.get('3V3')!.x).toBe(10 * P);
    expect(esp.broches.get('EN')!.y - esp.broches.get('3V3')!.y).toBe(P);
  });

  it('écarte les rangées du module TMC2209 de 0,5 pouce, comme les rangées d et g de la breadboard', () => {
    const drv = dessinPour(catalogue.fiche('tmc2209-module')!);
    const bb = dessinPour(catalogue.fiche('breadboard-830')!);
    expect(drv.broches.get('VM')!.y - drv.broches.get('EN')!.y).toBe(5 * P);
    expect(bb.broches.get('10b.g')!.y - bb.broches.get('10t.d')!.y).toBe(5 * P);
  });
});

describe('plan de la base roulante', () => {
  const montage = lireMontage(baseRoulante, catalogue);
  const reseau = construireReseau(montage, catalogue);
  const placements = placerPieces(montage);

  it('pose chaque broche des drivers sur son trou de breadboard', () => {
    for (const c of montage.connexions.filter((x) => x.couleur === '')) {
      expect(positionBroche(placements, c.de.piece, c.de.broche), `${c.de.piece}:${c.de.broche}`).toEqual(
        positionBroche(placements, c.vers.piece, c.vers.broche),
      );
    }
  });

  it('dessine les 12 pièces, les fils visibles et toutes les broches', () => {
    const svg = dessinerPlan(montage, reseau);
    expect(svg.match(/<g class="piece"/g)).toHaveLength(12);
    expect(svg.match(/<path class="fil"/g)).toHaveLength(filsVisibles(montage).length);
    const nbBroches = montage.pieces.reduce((n, p) => n + p.fiche.broches.length, 0);
    expect(svg.match(/<rect class="broche/g)).toHaveLength(nbBroches);
  });

  it('marque chaque broche avec son nœud, pour l\'éclairage au survol', () => {
    const svg = dessinerPlan(montage, reseau);
    const en = reseau.noeudDe('esp:13')!.id;
    for (const point of ['esp:13', 'drv1:EN', 'drv4:EN']) {
      expect(svg).toContain(`data-point="${point}" data-noeud="${en}"`);
    }
  });
});
