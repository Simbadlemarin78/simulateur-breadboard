// Cohérence entre fiches, ce que le schéma JSON ne peut pas vérifier seul :
// noms de broches uniques, renvois "vers" (module -> puce), "domaine" et liaisons internes.
import { describe, expect, it } from 'vitest';

interface Broche {
  nom: string;
  alias?: string[];
  vers?: string;
  domaine?: { alim?: string; masse: string };
}
interface Fiche {
  id: string;
  broches: Broche[];
  sous_composants?: { ref: string; fiche: string }[];
  liaisons_internes?: { entre: string[] }[];
}

const fichiers = import.meta.glob<Fiche>('../fiches/*.json', { eager: true, import: 'default' });
const fiches = new Map(Object.values(fichiers).map((f) => [f.id, f]));

function nomsDe(fiche: Fiche): Set<string> {
  return new Set(fiche.broches.flatMap((b) => [b.nom, ...(b.alias ?? [])]));
}

describe.each([...fiches.values()].map((f) => [f.id, f] as const))('fiche %s', (_id, fiche) => {
  const noms = new Set(fiche.broches.map((b) => b.nom));

  it('chaque broche a un nom unique', () => {
    expect(noms.size).toBe(fiche.broches.length);
  });

  it('les domaines et les liaisons internes citent des broches de la fiche', () => {
    const inconnues: string[] = [];
    for (const b of fiche.broches) {
      for (const ref of [b.domaine?.alim, b.domaine?.masse]) {
        if (ref !== undefined && !noms.has(ref)) inconnues.push(`${b.nom} -> domaine ${ref}`);
      }
    }
    for (const l of fiche.liaisons_internes ?? []) {
      for (const ref of l.entre) if (!noms.has(ref)) inconnues.push(`liaison -> ${ref}`);
    }
    expect(inconnues).toEqual([]);
  });

  it('chaque "vers" pointe vers une broche réelle d\'une sous-fiche', () => {
    const erreurs: string[] = [];
    for (const b of fiche.broches) {
      if (b.vers === undefined) continue;
      const [ref, broche] = b.vers.split('.') as [string, string];
      const sous = fiche.sous_composants?.find((s) => s.ref === ref);
      const cible = sous && fiches.get(sous.fiche);
      if (!sous) erreurs.push(`${b.nom} : repère ${ref} absent de sous_composants`);
      else if (!cible) erreurs.push(`${b.nom} : fiche ${sous.fiche} introuvable`);
      else if (!nomsDe(cible).has(broche)) erreurs.push(`${b.nom} : ${sous.fiche} n'a pas de broche ${broche}`);
    }
    expect(erreurs).toEqual([]);
  });
});
