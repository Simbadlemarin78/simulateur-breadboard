// Vérifie le schéma des fiches composants (schema/fiche-composant.schema.json) :
// 1. un exemple valide passe et dix exemples fautifs sont refusés ;
// 2. chaque fiche de fiches/ respecte le schéma.
// Remplace l'ancien outils/test_schema.py (Python + jsonschema).
//
// Les valeurs de l'exemple sont INVENTÉES pour tester le schéma : ce ne sont pas des données réelles.

import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../schema/fiche-composant.schema.json';

// Réglages par défaut d'Ajv : il refuse un mot-clé inconnu dans le schéma.
// (strict: true refuserait aussi le "if/then" de validation, pourtant correct.)
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv); // vérifie les champs "format": "date"
const valider = ajv.compile(schema);

function erreurs(fiche: unknown): string[] {
  return valider(fiche) ? [] : (valider.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

const ds = { type: 'datasheet', doc: 'ds-test', page: 3, ou: 'Table 1' };

const valide = {
  format: 'fiche-composant/1',
  id: 'module-test',
  nom: 'Module de test',
  categorie: 'module',
  documents: [{ id: 'ds-test', titre: 'Datasheet de test', revision: '1.0' }],
  validation: { statut: 'brouillon', extraite_par: 'claude', date_extraction: '2026-11-19' },
  wokwi: { type: 'chip-test', broches: { VMOT: 'VM' } },
  sous_composants: [
    { ref: 'U1', fiche: 'puce-test' },
    { ref: 'R1', fiche: 'resistance', valeurs: { resistance: { typ: 0.1, unite: 'Ω', src: ds } } },
  ],
  broches: [
    {
      nom: 'VM',
      role: 'alim_entree',
      vers: 'U1.VS',
      position: { connecteur: 'J2', numero: 1 },
      domaine: { masse: 'GND' },
      max_absolus: { tension: { min: -0.5, max: 30, unite: 'V', src: ds } },
      recommande: { tension: { min: 5, max: 28, unite: 'V', src: ds } },
    },
    {
      nom: 'STEP',
      role: 'entree_logique',
      vers: 'U1.STEP',
      domaine: { alim: 'VIO', masse: 'GND' },
      niveaux: { vih_min: { typ: 2.0, unite: 'V', src: ds } },
      entree: {
        tirage: { vers: 'masse', resistance: { typ: 100, unite: 'kΩ', src: ds } },
        diodes_protection: {
          vers_alim: true,
          vers_masse: true,
          src: { type: 'hypothese', justification: 'structure habituelle des entrées CMOS' },
        },
      },
    },
    {
      nom: 'IO34',
      role: 'entree_logique',
      capacites: { entree: true, sortie: false, src: ds },
      etat_demarrage: { etat: 'haute_impedance', src: ds },
      lue_au_demarrage: { valeur: false, src: ds },
    },
    { nom: 'GND', role: 'masse' },
    { nom: 'GND_2', role: 'masse' },
  ],
  liaisons_internes: [{ entre: ['GND', 'GND_2'], type: 'direct', src: ds }],
  parametres: { courant_rms: { description: 'Courant moteur réglé', unite: 'A', defaut: 1.0, min: 0 } },
  modele: {
    type: 'driver_pas_a_pas',
    valeurs: {
      rdson: { typ: 0.2, unite: 'Ω', src: ds },
      uart_present: { valeur: true, src: ds },
      micro_pas: { colonnes: ['MS2', 'MS1', 'micro_pas'], lignes: [[0, 0, 8], [1, 1, 16]], src: ds },
    },
  },
  thermique: {
    resistance_thermique: { typ: 40, unite: 'K/W', src: ds },
    seuils: [{ nom: 'coupure', temperature: { typ: 150, unite: '°C', src: ds }, effet: 'sorties coupées' }],
  },
  regles: [
    {
      id: 'condensateur-reservoir',
      verdict: 'risque_eleve',
      parametres: { capacite_min: { min: 100, unite: 'µF', src: ds }, entre: ['VM', 'GND'] },
      explication: 'Texte de test.',
      src: ds,
    },
  ],
};

// Fixture de test : on la modifie librement, d'où le type any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Modif = (f: any) => void;

function fautif(nom: string, modif: Modif) {
  const fiche = structuredClone(valide);
  modif(fiche);
  return { nom, fiche };
}

const fautifs = [
  fautif('nombre sans source', (f) => delete f.broches[0].max_absolus.tension.src),
  fautif('datasheet sans page', (f) => delete f.broches[0].max_absolus.tension.src.page),
  fautif('unité inconnue', (f) => (f.broches[0].max_absolus.tension.unite = 'volts')),
  fautif('grandeur sans valeur', (f) => {
    delete f.broches[0].max_absolus.tension.min;
    delete f.broches[0].max_absolus.tension.max;
  }),
  fautif('relue sans relecteur', (f) => (f.validation.statut = 'relue')),
  fautif('liaison résistance sans valeur', (f) =>
    f.liaisons_internes.push({ entre: ['VM', 'GND'], type: 'resistance', src: ds }),
  ),
  fautif('verdict inconnu', (f) => (f.regles[0].verdict = 'grillé')),
  fautif('hypothèse non justifiée', (f) =>
    (f.broches[1].entree.diodes_protection.src = { type: 'hypothese', justification: '' }),
  ),
  fautif('champ inconnu', (f) => (f.couleur = 'bleu')),
  fautif('pas de broches', (f) => (f.broches = [])),
];

describe('schéma des fiches', () => {
  it('accepte l’exemple valide', () => {
    expect(erreurs(valide)).toEqual([]);
  });

  it.each(fautifs)('refuse : $nom', ({ fiche }) => {
    expect(valider(fiche)).toBe(false);
  });
});

describe('fiches de fiches/', () => {
  // Toutes les fiches JSON du dossier, lues au moment du test.
  const fiches = Object.entries(
    import.meta.glob<unknown>('../fiches/*.json', { eager: true, import: 'default' }),
  ).map(([chemin, fiche]) => ({ fichier: chemin.split('/').pop() ?? chemin, fiche }));

  if (fiches.length === 0) {
    it.todo('aucune fiche dans fiches/ pour l’instant (étape 2 du plan)');
    return;
  }

  it.each(fiches)('$fichier respecte le schéma', ({ fiche }) => {
    expect(erreurs(fiche)).toEqual([]);
  });

  it.each(fiches)('$fichier : son id est le nom du fichier', ({ fichier, fiche }) => {
    expect(`${(fiche as { id?: unknown }).id}.json`).toBe(fichier);
  });
});
