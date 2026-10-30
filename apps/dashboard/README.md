# MIMT — Tableau de bord « expérience »

Internal admin dashboard (French-first) for MIMT staff. Server-rendered Next.js
app that reads the read-only `/v1/admin/*` endpoints of `@mimt/api`.

## Pages

- `/` — Vue d'ensemble (KPIs: inscriptions, utilisateurs actifs, MRR, volumes)
- `/utilisateurs` — recherche par courriel / téléphone / nom, forfait et numéros
- `/utilisation` — minutes/SMS par compte vs plafonds, top parleurs, écarts 9-1-1, inventaire par indicatif
- `/revenus` — abonnements par forfait × canal, essais, recouvrement, affiliés, points
- `/sante` — état API (`/readyz`) + événements antifraude récents
- `/soutien` — file de soutien : utilisateurs non vérifiés, écarts 9-1-1, journal d'audit

## Authentification (v1)

There is no service credential yet: on `/connexion`, paste the bearer token of an
admin session (a user id listed in the API's `CATALOG_ADMIN_USER_IDS`). The token
is validated against `GET /v1/admin/overview`, then stored in an httpOnly cookie
(`mimt_admin_token`, 24 h). Every page redirects to `/connexion` when the token
is missing, expired or rejected (401/403).

Follow-up before any exposure beyond staff: replace the pasted token with a
proper service credential / SSO.

## Développement

```bash
cp .env.example .env.local   # MIMT_API_URL=https://api.mimt.ca
pnpm --filter @mimt/dashboard dev
```

## Déploiement

Any Node host (Coolify, Vercel…). Set `MIMT_API_URL`. `next build` / `next start`.
Keep it behind staff-only access: the app is only as safe as the token in the cookie.
