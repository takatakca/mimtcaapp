# MIMT production incident — 2026-10-10

## Observed evidence (do not confuse upload success with a successful website release)

- Repository: `takatakca/mimtcaapp`, `main` at `3b85b01c2ab050ea42cb2171be786d96e57f7d33` when investigated.
- Latest failed production workflow: https://github.com/takatakca/mimtcaapp/actions/runs/38047716111
- FTP **succeeded** for the public marketing site, logging a target of `/home/bolonca/mimt.ca/`.
- FTP **succeeded** for the webphone, logging a target of `/home/bolonca/app.mimt.ca/`.
- Public `https://mimt.ca/` still served Fongo labels, a Fongo Waterloo paragraph and Fongo Works Pro copy. The repository's own French homepage is different: "Votre numéro canadien, partout."
- Coolify deployment request via `POST /api/v1/deploy` was accepted, but public `https://api.mimt.ca/healthz` and `/readyz` did not pass the release verification after 40 attempts.
- `https://app.mimt.ca/` was not independently confirmed reachable.
- The six GitHub secret *values* were not read or disclosed; successful FTP/Coolify actions demonstrate working authentication at the time of the run, **not** correct domain routing, runtime configuration or application readiness.

## Critical cPanel action — remove potentially infringing public copy

1. Determine the **actual document root** served for `mimt.ca` in cPanel → Domains → Manage. Compare with the FTP action's `WEB_FTP_DIR` target, mindful that `server-dir` is FTP-relative and FTP may be chrooted. Do not assume `/home/bolonca/mimt.ca/` is served simply because that upload succeeded.
2. Back up the current served directory, safely preserving unrelated files, then replace the obsolete Fongo-derived content with an original MIMT page, ideally the generated contents of `apps/web/out/`.
3. Verify `https://mimt.ca/` directly returns the French MIMT homepage and contains no Fongo navigation, Waterloo claim, or Fongo Works Pro copy (including footer / mobile navigation and other routes).
4. Inspect the root for stale `index.php`, `index.html`, rewrite rules / `.htaccess`, cached HTML, CDN caches and PHP routing. If multiple index files exist, confirm which one Apache actually serves. Do not bulk-delete other sites or overwrite a different document root.
5. Check `app.mimt.ca` has its own cPanel document root and valid TLS certificate; verify the Vite application `MIMT Web` at the correct public URL.
6. Confirm the DNS authority of `mimt.ca`: DNS changes made in cPanel have no public effect when another service owns authoritative nameservers.

## Critical Coolify action — make API actually healthy

1. Select the **specific MIMT API application** in Coolify and inspect its most recent **deployment** and **runtime/container logs**. A `POST` deployment response indicates only acceptance of the request.
2. Confirm source repository/branch: `takatakca/mimtcaapp` / `main`. Build context: repository root; Dockerfile path: `apps/api/Dockerfile`; application container port `8080`.
3. Ensure `api.mimt.ca` resolves to the **actual Coolify proxy/server**, is configured as the application's HTTPS domain and proxies to container port 8080. Verify TLS issuance.
4. Confirm all production environment variables specified in `apps/api/README.md` and validated by `apps/api/src/config.ts`. At a minimum: `DATABASE_URL`, Twilio SIDs/keys/auth token/TwiML app, TAKATAK issuer/client ID/webhook URL/webhook secret, MIMT signing/encryption keys, Stripe keys, `PUBLIC_BASE_URL=https://api.mimt.ca`, and `MIMT_API_KEY` or its SHA256 alternative. **Do not paste any secret into an issue, commit, screenshot, or chat**.
5. Apply Supabase/PostgreSQL schema migrations in order **before** readiness checks; ensure `DATABASE_URL` connects to the intended production database and has appropriate permissions.
6. Verify `GET https://api.mimt.ca/healthz` returns JSON with `ok=true`; `GET https://api.mimt.ca/readyz` returns JSON with `ok=true` and `db="up"`. Capture only non-sensitive status codes/errors in the issue.
7. Do not open voice/SMS or accept real subscribers before mandatory regulatory, emergency-call and payment readiness is separately approved.

## Release controls added here

- Production release is **manual-only** via Actions → Deploy → Run workflow. Agent PR merges no longer auto-publish.
- Check job fails if **any** of the six required GitHub secret names is unset.
- Website and webphone jobs verify the **publicly served** pages after FTP. A successful FTP upload with the wrong document root no longer counts as a successful release.
- Existing API job continues to enforce public `/healthz` and `/readyz` readiness.

## What requires owner/admin access

- cPanel domains/docroots, files and authoritative DNS; Coolify application, container logs, env vars; GitHub repository protection rules and repository visibility.
- Browser connector access was unavailable during this investigation. Never guess passwords, hosting paths, server IPs or runtime secrets.
