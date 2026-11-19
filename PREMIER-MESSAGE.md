Lis CLAUDE.md puis docs/etude-et-plan.md : c'est le contexte complet du projet, décidé dans une discussion précédente sur claude.ai.

Ensuite :
1. Résume-moi en 5 lignes ce que tu as compris, et signale toute incohérence entre les deux fichiers.
2. Fais l'étape 1 du plan (socle) : Vite + TypeScript + Vitest, une CI GitHub Actions qui lance les tests à chaque push, et le déploiement sur GitHub Pages.
3. Remplace outils/test_schema.py par un test Vitest (avec la bibliothèque Ajv), pour que `npm test` vérifie le schéma des fiches.

Explique-moi chaque fichier créé en une ou deux lignes. Avant toute commande qui installe un paquet ou pousse sur GitHub, dis-moi ce que tu vas faire.
