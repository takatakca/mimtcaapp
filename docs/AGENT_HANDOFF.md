# MIMT — Relève du développeur principal

**Mise à jour : 2026-10-14.** Repository `takatakca/mimtcaapp`, branche de publication `main`. À la reprise, **lire `AGENTS.md`, ce fichier, `WORKLOG.md`, vérifier HEAD GitHub et les Actions avant toute modification**. Un document de relève ne remplace jamais une vérification de `main`.

## Dernière tâche terminée

1. Empêcher un ancien `workflow_run` CI de publier une version obsolète par FTPS : `.github/workflows/auto-deploy-website.yml` compare le SHA approuvé à la tête distante de `main` juste avant le transfert, et saute la publication si une version plus récente existe (commit `400e88a69084fdf27ad0ec8c9bed642362f9ca65`).
2. Découpler les secrets requis par cible `website` / `webphone` / `api` dans `.github/workflows/deploy.yml` (commit `3213d0b434fdc4397fe8b44a9d916f29f7dccd96`).
3. Générer et contrôler `mimt-release.json` pour obtenir la **preuve du SHA servi en production**, dans la publication automatique et manuelle (commits `bfcc01707a9975138e1b6f0ee81112763b4d6019`, `233ff06ce57acdda9605fd10fa5d670bf4afd2b2`).
4. Créer les documents obligatoires `PROJECT_STATUS.md`, `TASK_QUEUE.md`, `DEPLOYMENT.md`, `DECISIONS.md` et le présent `AGENT_HANDOFF.md`. Décrire l'état sans qualifier les services télécom de lancés.

## Tâche en cours

**Contrôler les résultats de la CI et de l'auto-publication depuis les changements du 2026-10-14**, puis corriger tout échec constaté. La file d'actions CI a été temporairement chargée à cause de plusieurs commits successifs. Le nouveau workflow possède deux portes : `release-candidate` AVANT compilation et `release-gate` juste avant FTPS. Un run `success` dont les étapes de transfert/vérification sont `skipped` ne prouve pas une publication; c'est un abandon sain d'un ancien commit. N'annoncer la publication comme « confirmée » qu'après la réussite réelle de ces étapes **et** concordance du SHA dans `https://mimt.ca/mimt-release.json`.

**Premier travail indépendant suivant :** étendre les tests du déploiement et auditer les flux télécom sans mettre en péril le 9-1-1. Pour la priorité `DEP-04`, le blocage est externe : corriger la valeur de `MOCHAHOST_APP_FTP_SERVER` dans les secrets Actions; ne pas inventer le nom du serveur.

## Fichiers modifiés/créés pendant la reprise

- `.github/workflows/auto-deploy-website.yml` — validation HEAD en deux étapes (avant build et avant FTPS) et empreinte de release.
- `.github/workflows/deploy.yml` — secrets par portée, release SHA pour le site manuel; contrôle DNS préalable du webphone issu de la session précédente.
- `WORKLOG.md` — déclaration de travail et statut.
- `docs/PROJECT_STATUS.md` — preuve/stade par composant.
- `docs/TASK_QUEUE.md` — tâches indépendantes et dépendances.
- `docs/DEPLOYMENT.md` — procédures et contrôles.
- `docs/DECISIONS.md` — décisions approuvées.
- `docs/AGENT_HANDOFF.md` — relève.
- `AGENTS.md`, `.github/workflows/ci.yml` — lecture obligatoire de la relève et vérification en CI de la présence des cinq documents et des protections de déploiement.

## SHA Git

- **Dernier SHA de code de déploiement avant les nouveaux documents :** `233ff06ce57acdda9605fd10fa5d670bf4afd2b2`.
- **Dernier commit de documentation confirmé avant création de ce fichier :** `65a7750d4d5a898173a466e809923f8d36cb5418` (`docs/DECISIONS.md`).
- **Dernier commit de cette reprise vérifié avant la mise à jour finale de la relève :** `6bdcb607a8f1ae804a050c7535cb02cb08b0c863` (`WORKLOG.md`); optimisation pré-build : `9baf035918d72ccea15a1e93319abd89f1004432`; garde de contrat CI : `0b2dcbd4e2375da28c8309872cc7e1b5e3ca3c15`.
- **SHA courant de publication** : lire `refs/heads/main` dans GitHub; il doit être postérieur aux SHA ci-dessus. Le présent commit de relève et tout commit ultérieur ne peuvent pas s'auto-citer par SHA.

## Commandes / vérifications effectivement exécutées

- Lecture via le connecteur GitHub de `AGENTS.md`, `WORKLOG.md`, `docs/MIMT-LAUNCH.md` et des workflows `CI`, `Deploy`, `Auto deploy MIMT website`.
- Consultation GitHub du HEAD, des commits récents, de l'arborescence complète, des PR ouvertes (aucune à l'inspection), de l'issue #5 et des GitHub Actions.
- Dernière CI **antérieure à la reprise** : `38610373813`, succès à `3fdcc6768ef848ab53d45ac209213f5d60c6f33a`.
- Déploiement du site **antérieur à la reprise** : `38610692280`, succès au même SHA (ancienne validation du contenu du site; pas encore un contrôle de `mimt-release.json`).
- Les CI de cette nouvelle série ont commencé : `38612947004`, `38612979336`, `38613017799`, `38613110281`, `38613148388` et `38613403340` réussies à la dernière vérification. Les suivantes, incluant les changements de docs et la protection à deux étapes, étaient encore en file. **Ne pas déclarer le dernier SHA validé avant son statut GitHub `completed/success`.**
- Le run auto [38613261711](https://github.com/takatakca/mimtcaapp/actions/runs/38613261711) a terminé `success` mais a **omis FTP et contrôle HTTP** parce que sa révision n'était plus la tête de `main` : protection anti-retour arrière effectivement constatée. Il ne prouve PAS une nouvelle publication.
- L'outil Web n'a pas pu ouvrir directement `api.mimt.ca/readyz`, `api.mimt.ca/healthz` ou `app.mimt.ca` dans cette session; **indisponible depuis l'outil n'est pas synonyme d'une panne réelle**.
- Aucune commande télécom, aucun changement de secret Coolify/Twilio/Stripe, aucun appel réel 9-1-1 et aucune migration de base n'ont été exécutés dans cette reprise.

## Erreurs connues et état réel du déploiement

| Cible | Dernière preuve certaine | Condition restante |
| --- | --- | --- |
| `mimt.ca` | site vitrine auto-publié le 2026-10-14 sur l'ancien SHA `3fdcc676`; CI réussie | démontrer désormais le manifeste du **nouveau** SHA après le dernier cycle |
| `app.mimt.ca` | ancien site HTML et assets consultés par actions historiques; dernière mise à jour FTP `38116824409` échoue (`ENOTFOUND`) | valeur FTPS valide + racine dédiée + relance et vérification de liens profonds |
| `api.mimt.ca` | `/readyz` avec `db:up` au 2026-10-11 (issue #5) | vérification externe actuelle et flux Twilio/Stripe/9-1-1 |
| PostgreSQL MIMT | privée Coolify rétablie et migration testée | sauvegarde hors hôte et restauration contrôlée |
| iOS/Android | code Expo et tests CI | appareils réels, notifications, approbations stores et télécom |

Le lancement public de voix, SMS, numéro, paiement et 9-1-1 n'est pas approuvé. Les services purement marketing peuvent être publiés de façon séparée.

## Accès nécessaires (noms uniquement)

`MOCHAHOST_FTP_SERVER`, `MOCHAHOST_FTP_USERNAME`, `MOCHAHOST_FTP_PASSWORD`; `MOCHAHOST_APP_FTP_SERVER`, `MOCHAHOST_APP_FTP_USERNAME`, `MOCHAHOST_APP_FTP_PASSWORD`; `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_API_UUID`. Accès opérateur Twilio/9-1-1, Stripe, comptes Apple/Google, revue légale et sauvegarde PostgreSQL pour les tâches correspondantes. **Ne pas publier leurs valeurs.**

## Prochaines actions exactes

1. GitHub → Actions : ouvrir la dernière CI de `main` et le run `Auto deploy MIMT website` déclenché par cette CI; lire le résultat `Verify release commit still matches remote main`, le transfert FTPS et la vérification du manifeste.
2. Lire le contenu public `https://mimt.ca/mimt-release.json` et confirmer que `commit` correspond au SHA de publication attendu; ne pas se fier seulement à un titre HTML.
3. Si tout passe, mettre à jour `WORKLOG.md` et ce fichier avec les IDs de runs et le résultat. En cas d'échec, corriger la cause technique et recompiler sans désactiver les tests.
4. Pour le portail : une fois `MOCHAHOST_APP_FTP_SERVER` rectifié, lancer `Deploy` portée `webphone`, chemin `./`; vérifier `/connexion` et `/messages`.
5. Poursuivre `docs/TASK_QUEUE.md` (sauvegardes/restore, intégrations réelles, conformité), en conservant la séparation TAKATAK et le 9-1-1 non bloquable.

**Règle de fin :** ne jamais conclure « MIMT lancé à 100 % » avant tests réels, conformité, preuve de déploiement et restauration de secours.
