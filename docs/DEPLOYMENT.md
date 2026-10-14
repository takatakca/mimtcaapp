# MIMT — Déploiement et preuve de publication

Vérifié au 2026-10-14. Repository `takatakca/mimtcaapp`, branche `main`. Node 22, pnpm 10.28.0. **Ne pas lancer de builds Node directement sur MochaHost** : GitHub Actions compile les artefacts statiques.

## Environnements

| Nom | Origine | Destination | Procédure |
| --- | --- | --- | --- |
| `mimt.ca` | `apps/web/out/` (Next.js statique) | compte FTPS MochaHost propre au site, répertoire de connexion `./` | automatique après **CI complète réussie** sur `main`; également manuel |
| `app.mimt.ca` | `apps/webphone/dist/` (Vite) | compte FTPS distinct pointant vers le véritable document root `app.mimt.ca`, `./` | manuel; dernier FTP `ENOTFOUND` |
| `api.mimt.ca` | `apps/api/Dockerfile` | application MIMT sur Coolify, proxy HTTPS vers 8080 | manuel (télécom, conformité et paiements restent des portes de lancement) |
| PostgreSQL | `mimt-prod-postgres` | PostgreSQL privée sur Coolify | migration explicite, sauvegardes/restore séparés |

## Secrets GitHub (noms seulement)

- Site : `MOCHAHOST_FTP_SERVER`, `MOCHAHOST_FTP_USERNAME`, `MOCHAHOST_FTP_PASSWORD`.
- Portail : `MOCHAHOST_APP_FTP_SERVER`, `MOCHAHOST_APP_FTP_USERNAME`, `MOCHAHOST_APP_FTP_PASSWORD`.
- API : `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_API_UUID`.
- Variables non secrètes : `FTP_PROTOCOL` (par défaut `ftps`), `API_URL`, `TAKATAK_ISSUER`, `TAKATAK_CLIENT_ID`, `FORMS_ENDPOINT`.

Ne jamais inclure des valeurs dans un commit, une URL, un journal ou une réponse publique.

## Contrôles de livraison

1. Une modification sur `main` déclenche `CI` : installation figée, compilation du paquet partagé, TypeScript, tests unitaires, sites statiques, e2e Playwright et vérifications de sécurité du webphone.
2. Lorsque la CI d'un **push de la branche main** réussit, `Auto deploy MIMT website` commence par le job `release-candidate` (comparaison du SHA CI à `main`). Un ancien commit est **ignoré avant les installations/builds**. Si le SHA est encore courant, `deploy-website` construit ce commit et refait la comparaison dans `release-gate` juste avant FTP. **Un workflow vert dont le job d'envoi est `skipped` ne prouve aucune nouvelle publication.** Vérifier les étapes `Upload` et `Confirm` comme `success` pour annoncer une livraison.
3. Le site publié doit contenir `/mimt-release.json`, par exemple `{"commit":"<sha de 40 caractères>"}`. Le contrôle HTTP compare l'identifiant servi au SHA de la CI, et vérifie la présence de la marque française MIMT et l'absence des anciennes références Fongo. Un transfert seul n'est pas une preuve de succès.
4. Pour publication manuelle : GitHub → Actions → **Deploy** → Run workflow → portée `website`, `webphone`, `api` ou `all`; laisser les chemins FTPS `./` pour les comptes dédiés. Les secrets sont contrôlés uniquement pour la portée choisie.
5. Le portail vérifie le titre `MIMT Web`, le montage `root`, `/connexion`, `/messages` et l'absence d'erreur FTPS. Le serveur Apache doit conserver `apps/webphone/public/.htaccess` pour les URL SPA. Vérifier les assets et TLS indépendamment.
6. L'API nécessite `GET https://api.mimt.ca/healthz` -> `ok:true` et `GET /readyz` -> `ok:true, db:up`. Cela **ne valide pas** appels, SMS, 9-1-1, billing ou conformité.
7. Pour un échec : ouvrir l'étape exacte dans GitHub Actions, classifier DNS/TLS/auth/transfert/docroot/schéma/health, corriger la cause, et éviter de relancer la même erreur sans modification.

## Débogage reproductible

```bash
pnpm install --frozen-lockfile
pnpm --filter @mimt/shared build
pnpm typecheck
pnpm test
pnpm --filter @mimt/web build
pnpm --filter @mimt/webphone build
curl -fsS https://mimt.ca/mimt-release.json
curl -fsS https://api.mimt.ca/healthz
curl -fsS https://api.mimt.ca/readyz
```

Les requêtes sont **en lecture seule** et échouent si DNS/TLS n'est pas disponible. Pour l'app : vérifier dans un navigateur sans cache `https://app.mimt.ca/connexion` et `https://app.mimt.ca/messages`.

**Attention** : `MOCHAHOST_APP_FTP_SERVER` était invalide à la dernière publication manuelle examinée (run 38116824409). Il faut un véritable **nom DNS FTP**, sans `ftp://`, numéro de port ni répertoire. Ne pas réutiliser l'identifiant FTPS du site vitrine sur la racine du portail.

Documents complémentaires : [MIMT-LAUNCH.md](MIMT-LAUNCH.md), [MIMT-SELFHOSTED-POSTGRES-RECOVERY.md](MIMT-SELFHOSTED-POSTGRES-RECOVERY.md), [issue #5](https://github.com/takatakca/mimtcaapp/issues/5).
