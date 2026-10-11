# MIMT Web (app.mimt.ca)

Web softphone and MIMT Affaires admin portal: calls (Twilio Voice JS), texts, voicemail, account, business portal (extensions, ring groups, IVR, hours, numbers, team, recordings, AI receptionist), internet/mobile offers and orders, and number transfer. French first, English second. Installable as a PWA.

## Développement

```sh
pnpm install
pnpm --filter @mimt/shared build
cp apps/webphone/.env.example apps/webphone/.env.local   # VITE_MOCK_API=1 for demo data without an API
pnpm --filter @mimt/webphone dev
```

Checks: `pnpm --filter @mimt/webphone typecheck`, `test`, `build`. The end-to-end journey against the real API (in-memory) lives in `e2e/` (`pnpm --filter @mimt/e2e e2e`).

## Déploiement

- Build: `pnpm --filter @mimt/webphone build` writes `apps/webphone/dist/` (static files).
- Build variables (`.env.example`, none are secrets): `VITE_API_URL` (https://api.mimt.ca), `VITE_TAKATAK_ISSUER`, `VITE_TAKATAK_CLIENT_ID`. `VITE_MOCK_API` must stay unset or `0` in production.
- Release: GitHub → Actions → **Deploy** → Run workflow, scope `webphone` (or `all`). It uploads `dist/` by FTPS to the separate app.mimt.ca FTP account (`MOCHAHOST_APP_FTP_*` secrets) and then checks the live page.
- `public/.htaccess` sends deep links (for example `/affaires/…`) to `index.html` on Apache; CI checks it is in the build.
- `public/sw.js` caches the app shell only (never API calls or sign-in) and is registered in production builds only (`src/pwa.ts`). Bump `CACHE` in `sw.js` if the shell file list changes.
