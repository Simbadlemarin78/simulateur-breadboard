// Point d'entrée de l'interface. Pour l'instant, il prouve seulement que le
// TypeScript est compilé et exécuté sur la page en ligne (étape 1 du plan).
const etat = document.querySelector<HTMLParagraphElement>('#etat');
if (etat) {
  etat.textContent =
    'En construction : socle en place (étape 1 sur 9). Le plan de travail 2D arrive à l\'étape 4, le moteur de calcul aux étapes 5 et 6.';
}
