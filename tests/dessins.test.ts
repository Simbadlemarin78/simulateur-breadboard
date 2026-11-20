// Étape 4 : affichage 2D. Test du plan : chaque broche de chaque fiche a une position sur
// son dessin. On vérifie aussi que les pièces enfichées tombent pile sur leurs trous.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { construireReseau } from '../src/moteur/reseau';
import { dessinPour, P } from '../src/ui/pieces/dessins';
import { dessinerPlan, filsVisibles, placerPieces, positionBroche, zoomerCadre } from '../src/ui/plan';

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

describe('noms des broches sur les dessins', () => {
  const montage = lireMontage(baseRoulante, catalogue);
  const piece = (id: string) => montage.pieces.find((p) => p.id === id)!;
  const etiquettes = (svg: string) => [...svg.matchAll(/<text[^>]*class="etiquette-broche[^"]*"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  it('le module TMC2209 porte le nom de ses 19 broches, comme imprimé sur la carte', () => {
    const svg = dessinPour(catalogue.fiche('tmc2209-module')!).corps(piece('drv1'));
    expect(etiquettes(svg)).toEqual(['EN', 'MS1', 'MS2', 'PDN', 'PDN', 'CLK', 'STEP', 'DIR', 'VM', 'GND', 'A2', 'A1', 'B1', 'B2', 'VDD', 'GND', 'VREF', 'DIAG', 'INDEX']);
    // La deuxième position du pont PDN, non reliée, est grisée.
    expect(svg.match(/class="etiquette-broche nc"/g)).toHaveLength(1);
  });

  it('le moteur porte A+, A-, B+, B- et la couleur de chaque fil notée dans sa fiche', () => {
    const svg = dessinPour(catalogue.fiche('17hs4401')!).corps(piece('mot1'));
    expect(etiquettes(svg).sort()).toEqual(['A+', 'A-', 'B+', 'B-']);
    // Rouge (A+), vert (A-), jaune (B+), bleu (B-) chez MotionKing et HANPOSE.
    expect(svg.match(/class="fil-moteur"[^>]*stroke="(#[0-9a-f]+)"/g)).toHaveLength(4);
    for (const couleur of ['#d62c1f', '#2e9e3e', '#e8c21c', '#2b62d6']) expect(svg).toContain(`stroke="${couleur}"`);
  });

  it('chaque nom de broche du module tombe dans le dessin, sans chevaucher sa voisine', () => {
    const svg = dessinPour(catalogue.fiche('tmc2209-module')!).corps(piece('drv1'));
    const xs = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*class="etiquette-broche/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    for (const [x, y] of xs) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(9 * P);
      expect(y).toBeLessThan(7 * P);
    }
    // Une rangée : un nom par pas de 0,1 pouce.
    const rangee = xs.filter(([, y]) => y === 1.75 * P).map(([x]) => x);
    expect(rangee).toHaveLength(8);
    for (let i = 1; i < rangee.length; i++) expect(rangee[i]! - rangee[i - 1]!).toBe(P);
  });
});

describe('zoom du plan', () => {
  const cadre = { x: 0, y: 0, largeur: 800, hauteur: 400 };

  it('garde immobile le point sous la souris et les proportions', () => {
    const centre = { x: 200, y: 100 };
    const z = zoomerCadre(cadre, 2, centre, 10, 10000);
    expect(z).toEqual({ x: 100, y: 50, largeur: 400, hauteur: 200 });
    // Le point sous la souris est à la même fraction du cadre avant et après.
    expect((centre.x - z.x) / z.largeur).toBeCloseTo((centre.x - cadre.x) / cadre.largeur, 12);
    expect((centre.y - z.y) / z.hauteur).toBeCloseTo((centre.y - cadre.y) / cadre.hauteur, 12);
  });

  it('reste dans les bornes de largeur', () => {
    expect(zoomerCadre(cadre, 100, { x: 400, y: 200 }, 200, 3200).largeur).toBe(200);
    expect(zoomerCadre(cadre, 0.01, { x: 400, y: 200 }, 200, 3200).largeur).toBe(3200);
  });

  it('zoomer puis dézoomer du même facteur revient au cadre de départ', () => {
    const centre = { x: 123, y: 321 };
    const retour = zoomerCadre(zoomerCadre(cadre, 1.25, centre, 10, 10000), 1 / 1.25, centre, 10, 10000);
    for (const k of ['x', 'y', 'largeur', 'hauteur'] as const) expect(retour[k]).toBeCloseTo(cadre[k], 9);
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
