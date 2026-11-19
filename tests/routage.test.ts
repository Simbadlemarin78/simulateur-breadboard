// Routage des fils : tracés à angle droit, sans superposition, qui contournent les pièces
// et ne passent jamais sur une broche ou un trou qui n'est pas le leur.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import type { Point } from '../src/ui/pieces/dessins';
import { corpsDe, filsVisibles, placerPieces, positionBroche, tracerFils } from '../src/ui/plan';
import { PAS_GRILLE, router } from '../src/ui/routage';

/** Découpe un tracé en pas élémentaires de la grille : nœuds traversés et arêtes. */
function decouper(points: Point[]): { noeuds: string[]; aretes: string[] } {
  const noeuds: string[] = [];
  const aretes: string[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / PAS_GRILLE;
    for (let k = 0; k < n; k++) {
      const p = { x: a.x + (Math.sign(b.x - a.x) * k * PAS_GRILLE), y: a.y + (Math.sign(b.y - a.y) * k * PAS_GRILLE) };
      const q = { x: p.x + Math.sign(b.x - a.x) * PAS_GRILLE, y: p.y + Math.sign(b.y - a.y) * PAS_GRILLE };
      noeuds.push(`${p.x},${p.y}`);
      aretes.push([`${p.x},${p.y}`, `${q.x},${q.y}`].sort().join('|'));
    }
  }
  const dernier = points[points.length - 1];
  if (dernier) noeuds.push(`${dernier.x},${dernier.y}`);
  return { noeuds, aretes };
}

describe('fils de la base roulante', () => {
  const montage = lireMontage(baseRoulante, catalogue);
  const placements = placerPieces(montage);
  const fils = filsVisibles(montage);
  const traces = tracerFils(montage, placements);

  it('route chaque fil proprement, d\'une broche à l\'autre, à angle droit', () => {
    expect(traces).toHaveLength(fils.length);
    fils.forEach((c, i) => {
      const t = traces[i]!;
      expect(t.propre, `${c.de.piece}:${c.de.broche}`).toBe(true);
      expect(t.points[0]).toEqual(positionBroche(placements, c.de.piece, c.de.broche));
      expect(t.points[t.points.length - 1]).toEqual(positionBroche(placements, c.vers.piece, c.vers.broche));
      for (let j = 0; j + 1 < t.points.length; j++) {
        const a = t.points[j]!;
        const b = t.points[j + 1]!;
        expect(a.x === b.x || a.y === b.y, `segment oblique dans ${c.de.piece}:${c.de.broche}`).toBe(true);
      }
    });
  });

  it('ne superpose jamais deux fils', () => {
    const vues = new Map<string, number>();
    const doublons: string[] = [];
    traces.forEach((t, i) => {
      for (const a of new Set(decouper(t.points).aretes)) {
        const autre = vues.get(a);
        if (autre !== undefined && autre !== i) doublons.push(a);
        vues.set(a, i);
      }
    });
    expect(doublons).toEqual([]);
  });

  it('ne passe ni sur une broche étrangère ni à travers une autre pièce', () => {
    const broches = new Set(
      [...placements.values()].flatMap((pl) => [...pl.dessin.broches.values()].map((p) => `${pl.x + p.x},${pl.y + p.y}`)),
    );
    const erreurs: string[] = [];
    fils.forEach((c, i) => {
      const { noeuds } = decouper(traces[i]!.points);
      const miens = new Set([noeuds[0], noeuds[noeuds.length - 1]]);
      for (const n of noeuds) if (broches.has(n) && !miens.has(n)) erreurs.push(`${c.de.piece}:${c.de.broche} passe sur ${n}`);
      for (const pl of placements.values()) {
        if (pl.piece.fiche.modele?.type === 'breadboard' || pl.piece.id === c.de.piece || pl.piece.id === c.vers.piece) continue;
        const r = corpsDe(pl);
        for (const n of noeuds) {
          const [x, y] = n.split(',').map(Number) as [number, number];
          if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) erreurs.push(`${c.de.piece}:${c.de.broche} traverse ${pl.piece.id}`);
        }
      }
    });
    expect(erreurs).toEqual([]);
  });
});

describe('routeur', () => {
  it('écarte deux fils qui suivraient le même chemin', () => {
    const traces = router(
      [
        { a: { point: { x: 0, y: 0 }, sortie: 'droite' }, b: { point: { x: 100, y: 0 }, sortie: 'gauche' } },
        { a: { point: { x: 0, y: 10 }, sortie: 'droite' }, b: { point: { x: 100, y: -10 }, sortie: 'gauche' } },
      ],
      [],
      [],
    );
    const [a, b] = traces.map((t) => new Set(decouper(t.points).aretes));
    expect([...a!].filter((x) => b!.has(x))).toEqual([]);
    expect(traces.every((t) => t.propre)).toBe(true);
  });

  it('contourne un obstacle posé entre les deux bouts', () => {
    const [t] = router(
      [{ a: { point: { x: 0, y: 0 }, sortie: 'droite' }, b: { point: { x: 100, y: 0 }, sortie: 'gauche' } }],
      [{ x0: 40, y0: -20, x1: 60, y1: 20 }],
      [],
    );
    const { noeuds } = decouper(t!.points);
    expect(noeuds.some((n) => n === '50,0')).toBe(false);
    expect(t!.propre).toBe(true);
  });
});
