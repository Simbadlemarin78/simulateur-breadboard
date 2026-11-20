// Étape 7 : éditeur. Une broche posée sur un trou est reliée à sa bande, un fil tracé apparaît
// dans le diagram.json, export puis import redonne le même montage ; plus annuler, rétablir,
// supprimer, et les pièces qui suivent leur breadboard.
import { describe, expect, it } from 'vitest';
import baseRoulante from '../montages/base-roulante.diagram.json';
import { catalogueIntegre as catalogue } from '../src/moteur/fiches-integrees';
import { lireMontage } from '../src/moteur/montage';
import { construireReseau } from '../src/moteur/reseau';
import { ACCROCHE, Editeur, fichesPosables, type Diagramme } from '../src/ui/edition';
import { P } from '../src/ui/pieces/dessins';
import { dessinerPlan, placerPieces, positionBroche } from '../src/ui/plan';

const montages = import.meta.glob<Diagramme>(['../montages/*.diagram.json', '../montages/cas/*.diagram.json'], { eager: true, import: 'default' });

/** Breadboard en 0, 0 : le trou 10t.a est en (110, 45), le 16t.a en (170, 45). Broche 1 d'une résistance en (5, 10). */
function avecBreadboard(): Editeur {
  const e = new Editeur(catalogue);
  e.ajouterPiece('breadboard-830', 0, 0);
  return e;
}
const enfichages = (e: Editeur, id: string) => e.diagramme.connections.filter((c) => c[2] === '' && c[0].startsWith(`${id}:`)).map((c) => `${c[0]}>${c[1]}`);
const noeud = (e: Editeur, point: string) => construireReseau(e.montage(), catalogue).noeudDe(point)?.points ?? [];

describe('enficher une pièce dans la breadboard', () => {
  it('une broche lâchée près d\'un trou s\'y enfiche, et elle est reliée à toute sa bande', () => {
    const e = avecBreadboard();
    const r = e.ajouterPiece('resistance', 300, 300);
    // Lâchée à 4 px du bon endroit : recalée pile sur les trous.
    expect(e.deplacerPiece(r, 105 + 3, 35 - 2)).toBeUndefined();
    expect(enfichages(e, r)).toEqual([`${r}:1>bb1:10t.a`, `${r}:2>bb1:16t.a`]);
    const partie = e.diagramme.parts.find((p) => p.id === r)!;
    expect([partie.left, partie.top]).toEqual([105, 35]);
    expect(noeud(e, `${r}:1`)).toEqual(expect.arrayContaining(['bb1:10t.a', 'bb1:10t.b', 'bb1:10t.e']));
    expect(noeud(e, `${r}:2`)).toContain('bb1:16t.e');
    expect(noeud(e, `${r}:1`)).not.toContain('bb1:10b.f');
    // Le dessin la pose bien sur ses trous.
    const pl = placerPieces(e.montage());
    expect(positionBroche(pl, r, '1')).toEqual(positionBroche(pl, 'bb1', '10t.a'));
  });

  it('loin des trous, ou entre deux trous, la pièce est seulement posée', () => {
    const e = avecBreadboard();
    const r = e.ajouterPiece('resistance', 105, 400);
    expect(enfichages(e, r)).toEqual([]);
    expect(noeud(e, `${r}:1`)).toEqual([`${r}:1`]);
    // À mi-chemin de quatre trous : plus de ACCROCHE (6 px) de chacun.
    expect(Math.hypot(5, 5)).toBeGreaterThan(ACCROCHE);
    e.deplacerPiece(r, 105 + 5, 35 + 5);
    expect(enfichages(e, r)).toEqual([]);
  });

  it('ne met jamais deux broches sur la même bande, et n\'enfiche ni alim ni moteur', () => {
    const e = avecBreadboard();
    // La carte ESP32 est dessinée debout : ses broches tomberaient à la verticale, dans une même bande.
    const esp = e.ajouterPiece('esp32-devkitc', 0, 0);
    const pl = placerPieces(e.montage()).get(esp)!;
    const trou = placerPieces(e.montage()).get('bb1')!.dessin.broches.get('10t.a')!;
    const v = pl.dessin.broches.get('3V3')!;
    e.deplacerPiece(esp, trou.x - v.x, trou.y - v.y);
    expect(enfichages(e, esp)).toEqual([]);
    const alim = e.ajouterPiece('alim-labo', 0, 0);
    const plus = placerPieces(e.montage()).get(alim)!.dessin.broches.get('+')!;
    e.deplacerPiece(alim, trou.x - plus.x, trou.y - plus.y);
    expect(enfichages(e, alim)).toEqual([]);
  });

  it('déplacée hors de la breadboard, elle n\'y est plus reliée', () => {
    const e = avecBreadboard();
    const r = e.ajouterPiece('resistance', 105, 35);
    expect(enfichages(e, r)).toHaveLength(2);
    e.deplacerPiece(r, 400, 400);
    expect(enfichages(e, r)).toEqual([]);
    expect(noeud(e, `${r}:1`)).toEqual([`${r}:1`]);
  });

  it('ne s\'enfiche pas dans un trou déjà occupé', () => {
    const e = avecBreadboard();
    e.ajouterPiece('resistance', 105, 35);
    const r2 = e.ajouterPiece('resistance', 105, 35);
    expect(enfichages(e, r2)).toEqual([]);
  });

  it('un module TMC2209 s\'enfiche à cheval sur la rainure, ses 16 broches à leur place', () => {
    const e = avecBreadboard();
    const bb = placerPieces(e.montage()).get('bb1')!;
    const module = e.ajouterPiece('tmc2209-module', 0, 0);
    const pl = placerPieces(e.montage()).get(module)!;
    const en = pl.dessin.broches.get('EN')!;
    const trou = bb.dessin.broches.get('3t.d')!;
    e.deplacerPiece(module, trou.x - en.x + 2, trou.y - en.y - 1);
    const liste = enfichages(e, module);
    expect(liste).toHaveLength(16);
    expect(liste).toContain(`${module}:EN>bb1:3t.d`);
    expect(liste).toContain(`${module}:VM>bb1:3b.g`);
  });

  it('les pièces enfichées suivent leur breadboard', () => {
    const e = new Editeur(catalogue, baseRoulante as Diagramme);
    const avant = placerPieces(e.montage());
    e.deplacerPiece('bb1', 100, 50);
    const apres = placerPieces(e.montage());
    for (const id of ['drv1', 'drv4']) {
      expect(apres.get(id)!.x - avant.get(id)!.x).toBe(100);
      expect(apres.get(id)!.y - avant.get(id)!.y).toBe(50);
    }
    expect(positionBroche(apres, 'drv1', 'VM')).toEqual(positionBroche(apres, 'bb1', '3b.g'));
    // Les pièces non enfichées restent où elles sont.
    expect(apres.get('esp')!.x).toBe(avant.get('esp')!.x);
  });
});

describe('tracer et supprimer des fils', () => {
  it('un fil tracé apparaît dans le diagram.json et relie les deux nœuds', () => {
    const e = avecBreadboard();
    const r = e.ajouterPiece('resistance', 105, 35);
    expect(e.ajouterFil('bb1:10t.c', 'bb1:tp.1')).toBeUndefined();
    const exporte = JSON.parse(e.exporter()) as Diagramme;
    expect(exporte.connections).toContainEqual(['bb1:10t.c', 'bb1:tp.1', 'green', []]);
    expect(construireReseau(e.montage(), catalogue).noeudDe(`${r}:1`)?.points).toContain('bb1:tp.25');
  });

  it('choisit la couleur d\'après les broches : noir vers une masse, rouge vers une alim', () => {
    const e = new Editeur(catalogue);
    e.ajouterPiece('alim-labo', 0, 0);
    e.ajouterPiece('tmc2209-module', 300, 0);
    e.ajouterFil('alim1:+', 'drv1:VM');
    e.ajouterFil('alim1:-', 'drv1:GND.1');
    expect(e.diagramme.connections.map((c) => c[2])).toEqual(['red', 'black']);
  });

  it('refuse un trou déjà occupé, un fil en double et un fil d\'un point vers lui-même', () => {
    const e = avecBreadboard();
    e.ajouterPiece('resistance', 105, 35);
    expect(e.ajouterFil('bb1:10t.a', 'bb1:tp.1')).toContain('déjà occupé');
    expect(e.ajouterFil('bb1:10t.b', 'bb1:tp.1')).toBeUndefined();
    expect(e.ajouterFil('bb1:tp.1', 'bb1:10t.b')).toBeDefined();
    expect(e.ajouterFil('bb1:10t.c', 'bb1:10t.c')).toBeDefined();
    expect(e.ajouterFil('bb1:10t.c', 'bb1:99t.a')).toContain('introuvable');
  });

  it('supprime un fil, une pièce et ses connexions', () => {
    const e = avecBreadboard();
    const r = e.ajouterPiece('resistance', 105, 35);
    e.ajouterFil('bb1:10t.c', 'bb1:tp.1');
    const indice = e.diagramme.connections.findIndex((c) => c[0] === 'bb1:10t.c');
    expect(e.supprimerFil(indice)).toBeUndefined();
    expect(e.diagramme.connections.some((c) => c[0] === 'bb1:10t.c')).toBe(false);
    expect(e.supprimerPiece(r)).toBeUndefined();
    expect(e.diagramme.connections).toEqual([]);
    expect(e.diagramme.parts.map((p) => p.id)).toEqual(['bb1']);
  });

  it('chaque fil du plan porte le rang de sa ligne dans le diagram.json', () => {
    const e = new Editeur(catalogue, baseRoulante as Diagramme);
    const svg = dessinerPlan(e.montage(), construireReseau(e.montage(), catalogue));
    const indices = [...svg.matchAll(/class="fil-groupe" data-connexion="(\d+)"/g)].map((m) => Number(m[1]));
    expect(indices).toHaveLength(e.diagramme.connections.filter((c) => c[2] !== '').length);
    for (const i of indices) expect(e.diagramme.connections[i]![2]).not.toBe('');
  });
});

describe('annuler et rétablir', () => {
  it('défait puis refait chaque modification, dans l\'ordre', () => {
    const e = avecBreadboard();
    const r = e.ajouterPiece('resistance', 105, 35);
    e.ajouterFil('bb1:10t.c', 'bb1:tp.1');
    e.deplacerPiece(r, 400, 400);
    const etapes = [e.exporter()];
    expect(e.annuler()).toBe(true);
    etapes.push(e.exporter());
    expect(enfichages(e, r)).toHaveLength(2);
    expect(e.annuler()).toBe(true);
    expect(e.diagramme.connections.some((c) => c[0] === 'bb1:10t.c')).toBe(false);
    expect(e.retablir()).toBe(true);
    expect(e.exporter()).toBe(etapes[1]);
    expect(e.retablir()).toBe(true);
    expect(e.exporter()).toBe(etapes[0]);
    expect(e.retablir()).toBe(false);
  });

  it('une modification refusée ne touche ni au montage ni à l\'historique', () => {
    const e = avecBreadboard();
    const avant = e.exporter();
    expect(e.ajouterFil('bb1:1t.a', 'rien:1')).toBeDefined();
    expect(e.exporter()).toBe(avant);
    expect(e.annuler()).toBe(true); // annule la pose de la breadboard, pas le fil refusé
    expect(e.diagramme.parts).toEqual([]);
  });
});

describe('importer et exporter le diagram.json', () => {
  it.each(Object.keys(montages))('export puis import redonne le même montage : %s', (nom) => {
    const e = new Editeur(catalogue, montages[nom]!);
    const texte = e.exporter();
    const relu = Editeur.depuisTexte(texte, catalogue);
    expect(relu.exporter()).toBe(texte);
    expect(relu.montage()).toEqual(lireMontage(montages[nom], catalogue));
  });

  it('charger un autre montage s\'annule avec Ctrl+Z, et un montage illisible est refusé', () => {
    const e = new Editeur(catalogue, baseRoulante as Diagramme);
    const avant = e.exporter();
    expect(e.remplacer(montages['../montages/cas/cas-01-12v-sur-broche.diagram.json']!)).toBeUndefined();
    expect(e.montage().pieces).toHaveLength(17);
    expect(e.remplacer({ parts: [{ id: 'x', type: 'inconnu' }], connections: [] } as unknown as Diagramme)).toMatch(/inconnu/);
    expect(e.montage().pieces).toHaveLength(17);
    expect(e.annuler()).toBe(true);
    expect(e.exporter()).toBe(avant);
  });

  it('dit pourquoi un fichier ne se lit pas', () => {
    expect(() => Editeur.depuisTexte('{ pas du json', catalogue)).toThrow(/JSON/);
    expect(() => Editeur.depuisTexte('{"parts": [{"id": "x", "type": "inconnu"}], "connections": []}', catalogue)).toThrow(/inconnu/);
  });

  it('chaque pièce de la palette se pose et se relit', () => {
    const e = new Editeur(catalogue);
    fichesPosables(catalogue).forEach((f, i) => e.ajouterPiece(f.id, 0, 300 * i));
    const relu = Editeur.depuisTexte(e.exporter(), catalogue);
    expect(relu.montage().pieces.map((p) => p.fiche.id)).toEqual(fichesPosables(catalogue).map((f) => f.id));
    expect(new Set(relu.diagramme.parts.map((p) => p.id)).size).toBe(fichesPosables(catalogue).length);
  });

  it('dessine un montage vide, puis une pièce seule sans fil', () => {
    const e = new Editeur(catalogue);
    expect(dessinerPlan(e.montage(), construireReseau(e.montage(), catalogue))).toContain('<svg');
    e.ajouterPiece('resistance', 0, 0);
    expect(dessinerPlan(e.montage(), construireReseau(e.montage(), catalogue))).toContain('data-piece="r1"');
  });

  it('donne des identifiants uniques et lisibles', () => {
    const e = new Editeur(catalogue);
    expect([e.ajouterPiece('resistance', 0, 0), e.ajouterPiece('resistance', 0, 100), e.ajouterPiece('tmc2209-module', 0, 200)]).toEqual(['r1', 'r2', 'drv1']);
    e.supprimerPiece('r1');
    expect(e.ajouterPiece('resistance', 0, 0)).toBe('r1');
    expect(P).toBe(10);
  });
});
