# MIMT — État vérifié du projet

Dernière revue : **2026-10-22**. Source de vérité : branche `main` de `takatakca/mimtcaapp`, `AGENTS.md`, `WORKLOG.md`, `docs/MIMT-LAUNCH.md`, GitHub Actions. Ce document distingue **code présent**, **tests CI** et **service réel opérationnel**.

## 22 octobre 2026 — héros et notification d'appel

Le code (branche `cursor/hero-incoming-call-push-2e59`, pas encore `main` au moment de l'écriture) ajoute le texte du héros sur les textos @nom et les 120 minutes d'appels entre applications, et le Web Push « Appel entrant » quand l'app sonne. **Présence dans le dépôt n'est pas une publication.** `mimt.ca` se met à jour après CI sur `main`. `app.mimt.ca` et `api.mimt.ca` attendent un Deploy manuel, portée `all` pour les trois ensemble. Aucun de ces changements ne lance les appels, les textos ou le 9-1-1.

## Produits et propriétaires

| Périmètre | Code constaté | Vérification | Statut |
| --- | --- | --- | --- |
| Site vitrine `mimt.ca` | Next.js export statique, français/anglais, tarifs, aide, juridique | CI 38610373813 et auto-publication 38610692280 réussies au SHA `3fdcc676` | **En production comme vitrine/prélancement** |
| Webphone `app.mimt.ca` | React/Vite, appels WebRTC, SMS, messagerie vocale, PBX, AI, paramètres, PWA | CI et e2e en mémoire réussis sur les versions examinées; dernière publication manuelle 38116824409 : échec FTPS `ENOTFOUND` | **Code présent, déploiement non validé** |
| API `api.mimt.ca` | Fastify, appels/SMS/9-1-1, comptes, portabilité, facturation, webhooks, PBX | `/readyz` avec PostgreSQL privé déclaré OK le 2026-10-11 (issue #5); disponibilité du jour non revérifiée | **Base rétablie, lancement non certifié** |
| PostgreSQL MIMT privé | `mimt-prod-postgres` dans Coolify, migrations MIMT | Test de migrations GitHub 38181589120 réussi; sauvegardes/restauration non prouvées | **Protection des données à compléter** |
| Mobile iOS/Android | Expo React Native, Twilio Voice natif, onboarding, SMS, appels, contacts | CI TypeScript/tests; test sur appareils et publications magasins non prouvés | **Non lancé** |
| Revendeur Internet/mobile | Modèles d'offres et commandes, adaptateur de fournisseur | Accès commercial/API Vidéotron pas validé | **Dépendance externe** |

## Dernière intervention du 14 octobre 2026

Le flux `CI → Auto deploy MIMT website` publie déjà la vitrine; une exécution réussie a été constatée au SHA `3fdcc676`. Suite aux redéploiements répétitifs, le workflow compare maintenant le commit approuvé par CI à la tête distante de `main` juste avant l'envoi FTPS : une version dépassée est ignorée. La publication inclut aussi `mimt-release.json`, dont le SHA doit correspondre au commit réellement envoyé. La publication manuelle du site vérifie la même preuve. La CI et la nouvelle publication de ces modifications doivent être constatées indépendamment.

Le workflow manuel `Deploy` vérifie seulement les secrets utilisés par la portée choisie : `website`, `webphone`, `api` ou `all`. Les applications télécom ne sont **pas** ajoutées à la publication automatique.

## Bloquants explicites

1. Corriger la valeur GitHub `MOCHAHOST_APP_FTP_SERVER` (un hôte FTPS réel et résoluble), puis publier et tester `app.mimt.ca`, y compris les URL profondes et TLS.
2. Configurer des sauvegardes PostgreSQL chiffrées **hors hôte** et exécuter une restauration documentée sans toucher TAKATAK.
3. Certifier l'état de l'API, les migrations attendues, OAuth TAKATAK et les vrais flux Twilio sur un environnement contrôlé.
4. Valider le partenaire 9-1-1, les avis réglementaires, la confidentialité/Loi 25, les paiements Stripe/IAP, les paramètres de taxation et les accords fournisseurs avant activation commerciale.
5. Vérifier les connexions stockages MMS/voicemail, le service email, les offres/prix et les appareils iOS/Android réels.
6. Conserver le déploiement API **manuel** jusqu'aux autorisations opérationnelles. Aucune CI ne certifie les urgences.
7. Le script `scripts/db/backup-mimt.sh` de sauvegarde PostgreSQL privée, chiffrée age vers stockage S3 hors hôte, et son test hermétique `scripts/db/test-backup-mimt.sh` ont été ajoutés en octobre 2026. **Aucun backup de production, planification, stockage ou restauration réelle n'a été effectué par cette seule addition de code.**

## Publication vérifiée et confidentialité (14 octobre 2026)

La correction du contrôle GitHub Actions a réussi au commit `024dc80ce6de9a8cee5d9bb1ea90ec08ded4ea59` (CI [38622709087](https://github.com/takatakca/mimtcaapp/actions/runs/38622709087)). La **publication FTP avec validation HTTP du manifeste SHA** a réussi dans [38622899829](https://github.com/takatakca/mimtcaapp/actions/runs/38622899829). Ces preuves s'appliquent à la vitrine seulement, pas à la téléphonie.

Les adaptateurs de secours de notifications/logs ont été corrigés et testés dans le code pour ne jamais journaliser transcription, sujet d'email, numéro d'appelant ou destinataire; la CI de la nouvelle révision était encore en attente lors de la mise à jour. **Un adaptateur de log n'est pas un prestataire de notification** : l'envoi réel exige une intégration push/email certifiée et des accès fournisseur.

## Livraison consentements (16 octobre 2026)

- `GET /v1/consents` est implémenté côté API, authentifié, restreint aux décisions du compte connecté, réduit à la plus récente par catégorie et ne retourne ni IP ni historique complet. Les écrans Confidentialité mobile et webphone restaurent les valeurs enregistrées après reconnexion; les consentements publicitaires ne sont pas présumés accordés en cas d'échec réseau.
- **CI réussie :** [38949670716](https://github.com/takatakca/mimtcaapp/actions/runs/38949670716) ; **tests PostgreSQL réussis :** [38949670692](https://github.com/takatakca/mimtcaapp/actions/runs/38949670692) ; **site vitrine FTPS + preuve SHA :** [38949802395](https://github.com/takatakca/mimtcaapp/actions/runs/38949802395) au code `e71fefe21d81fe82aabf95a8f8ec1aa3cc0367d6`.
- L'effacement local de la personnalisation publicitaire à la déconnexion (`b4b0c873...`) est poussé; un test de régression isolé (`4b3a6d50...`) et la CI [38950202953](https://github.com/takatakca/mimtcaapp/actions/runs/38950202953) ont réussi. Cela ne remplace pas un test sur un appareil réel. **API, webphone et applications mobiles ne sont pas pour autant publiés en production.** L'identité TAKATAK reste centrale; les consentements sont des enregistrements propres à MIMT.

## Principes

TAKATAK est maître d'identité et des habilitations. MIMT est propriétaire des données télécom isolées; aucun secret, donnée client ou schéma du tableau de bord TAKATAK ne doit être copié ici. Chaque entreprise doit être isolée côté serveur. Le 9-1-1 n'est jamais bloqué par le forfait, un plafond ou une suspension; ses obligations de configuration/consentement restent en vigueur.

Suivi actif : [issue #5](https://github.com/takatakca/mimtcaapp/issues/5), [GitHub Actions](https://github.com/takatakca/mimtcaapp/actions), [checklist du lancement](MIMT-LAUNCH.md).
