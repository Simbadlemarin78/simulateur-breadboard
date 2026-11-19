// Point d'entrée de l'interface (étape 4) : affiche la base roulante sur le plan de travail 2D,
// en lecture seule. Survoler une broche ou un trou éclaire tout son nœud (les points reliés).
import baseRoulante from '../../montages/base-roulante.diagram.json';
import { catalogueIntegre } from '../moteur/fiches-integrees';
import { lireMontage, MontageInvalide } from '../moteur/montage';
import { brochesDeComposants, construireReseau } from '../moteur/reseau';
import { dessinerPlan } from './plan';

const etat = document.querySelector<HTMLParagraphElement>('#etat');
const conteneur = document.querySelector<HTMLDivElement>('#plan');
const info = document.querySelector<HTMLParagraphElement>('#info');

function afficher(): void {
  if (!etat || !conteneur || !info) return;
  try {
    const montage = lireMontage(baseRoulante, catalogueIntegre);
    const reseau = construireReseau(montage, catalogueIntegre);
    conteneur.innerHTML = dessinerPlan(montage, reseau);
    etat.textContent =
      `Base roulante : ${montage.pieces.length} pièces, ${montage.connexions.length} connexions. ` +
      'Lecture seule pour l\'instant (étape 4 sur 9) : le calcul arrive aux étapes 5 et 6, l\'édition à l\'étape 7.';
    info.textContent = 'Survole une broche ou un trou : tout ce qui lui est relié s\'allume.';

    let actif = '';
    conteneur.addEventListener('mouseover', (e) => {
      const cible = e.target instanceof Element ? e.target.closest<SVGElement>('.broche') : null;
      const noeud = cible?.dataset['noeud'] ?? '';
      if (noeud === actif) return;
      conteneur.querySelectorAll('.broche.allumee').forEach((el) => el.classList.remove('allumee'));
      actif = noeud;
      if (!cible || noeud === '') return;
      conteneur.querySelectorAll(`.broche[data-noeud="${noeud}"]`).forEach((el) => el.classList.add('allumee'));
      const n = reseau.noeuds[Number(noeud)];
      const composants = n ? brochesDeComposants(n, montage) : [];
      info.textContent =
        `${cible.dataset['point'] ?? ''} — ` +
        (composants.length > 0 ? `relié à : ${composants.join(', ')}` : 'relié à aucune broche de composant');
    });
  } catch (e) {
    etat.textContent = e instanceof MontageInvalide ? e.message : `Erreur : ${String(e)}`;
  }
}

afficher();
