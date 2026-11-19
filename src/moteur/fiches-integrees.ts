// Catalogue des fiches du dépôt (fiches/*.json), chargées au moment de la construction
// par Vite. Le reste du moteur ne dépend pas de Vite : il reçoit un Catalogue en paramètre.
import { Catalogue } from './catalogue';
import type { Fiche } from './fiche';

const fichiers = import.meta.glob<Fiche>('../../fiches/*.json', { eager: true, import: 'default' });

export const catalogueIntegre = new Catalogue(Object.values(fichiers));
