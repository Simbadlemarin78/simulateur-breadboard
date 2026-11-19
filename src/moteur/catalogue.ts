// Le catalogue regroupe les fiches connues du moteur et retrouve celle d'une pièce
// à partir de son type (identifiant de fiche, ou type Wokwi comme "wokwi-resistor").
import type { Fiche } from './fiche';

export class Catalogue {
  private readonly parId = new Map<string, Fiche>();
  private readonly parTypeWokwi = new Map<string, Fiche[]>();

  constructor(fiches: Iterable<Fiche>) {
    for (const fiche of fiches) {
      this.parId.set(fiche.id, fiche);
      if (fiche.wokwi) {
        const liste = this.parTypeWokwi.get(fiche.wokwi.type) ?? [];
        liste.push(fiche);
        this.parTypeWokwi.set(fiche.wokwi.type, liste);
      }
    }
  }

  fiche(id: string): Fiche | undefined {
    return this.parId.get(id);
  }

  /** Fiches dont le type Wokwi est celui demandé (souvent zéro ou une). */
  fichesWokwi(type: string): Fiche[] {
    return this.parTypeWokwi.get(type) ?? [];
  }

  get fiches(): Fiche[] {
    return [...this.parId.values()];
  }
}
