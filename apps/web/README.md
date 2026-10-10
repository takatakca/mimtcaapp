# @mimt/web — site public mimt.ca

**Français d'abord · [English below](#english)**

Site vitrine statique de MIMT (Next.js 16, App Router, TypeScript, `output: "export"`). Le français (fr-CA) est à `/`, l'anglais (en-CA) sous `/en/`. Les prix viennent de `@mimt/shared` (`PLANS`, `ADD_ONS`, `formatCad`) : une seule source de vérité.

## Développement

```bash
# depuis la racine du dépôt
pnpm install
pnpm --filter @mimt/shared build   # le site importe le paquet compilé (dist/)
pnpm --filter @mimt/web dev        # http://localhost:3000
pnpm --filter @mimt/web typecheck
```

## Compilation

```bash
pnpm --filter @mimt/web build      # compile aussi @mimt/shared, puis exporte vers apps/web/out/
```

`out/` contient des fichiers HTML/CSS/JS ordinaires (un dossier par page, `trailingSlash: true`), plus `sitemap.xml`, `robots.txt`, `llms.txt`, `404.html`, `og.png`. La compilation se termine par `scripts/verify-out.mjs`, qui échoue si une page n'a pas son titre, sa description, son URL canonique, ses liens hreflang fr-CA/en-CA, un seul `<h1>` ou un JSON-LD valide.

## Pages (fr / en)

Accueil `/` · `/en/` — Forfaits `/forfaits/` · `/en/plans/` — Affaires `/affaires/` · `/en/business/` — IA `/ia/` · `/en/ai/` — App Web `/app-web/` · `/en/web-app/` — Comparer `/comparer/` · `/en/compare/` — Bientôt `/bientot/` · `/en/coming-soon/` — Aide et FAQ `/aide/` · `/en/help/` — Contact `/contact/` · `/en/contact/` — 9-1-1 `/9-1-1/` · `/en/9-1-1/` — Confidentialité `/confidentialite/` · `/en/privacy/` — Conditions `/conditions/` · `/en/terms/` — Plaintes `/plaintes/` · `/en/complaints/` — Accessibilité `/accessibilite/` · `/en/accessibility/`.

Référencement : titres et descriptions dans `lib/meta.ts`; JSON-LD (Organization, WebSite, WebPage, BreadcrumbList, Service avec offres tirées de `PLANS`, FAQPage) dans `lib/seo.ts`; FAQ dans `lib/faq.ts`; `llms.txt` (résumé pour les assistants IA) dans `lib/llms.ts`. Pas de `LocalBusiness` : aucune adresse civique de MIMT n'existe dans le dépôt.

Tests : `pnpm --filter @mimt/web test` (Node `--test`, sans dépendance).

## Variables d'environnement (lues à la compilation)

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | URL canonique, hreflang, sitemap, Open Graph | `https://mimt.ca` |
| `NEXT_PUBLIC_FORMS_ENDPOINT` | URL où les formulaires (liste d'attente, démo, contact) envoient un `POST` JSON (l'API MIMT plus tard) | vide → le formulaire ouvre le courriel du visiteur vers `info@mimt.ca` (`mailto:`) |

Voir `.env.example`. Aucun secret : ces valeurs sont publiques et intégrées au JavaScript.

Corps JSON envoyé : `{ form: "waitlist" | "demo" | "contact", locale, fields: {...}, consents: { marketing: boolean, marketingText }, page, submittedAt }`. La case de consentement marketing (LCAP) est facultative, décochée par défaut et distincte de la demande. L'API doit accepter CORS depuis `https://mimt.ca`.

## Déploiement

**MochaHost (cPanel)** : `pnpm --filter @mimt/web build`, puis téléverser **le contenu** de `apps/web/out/` dans `public_html/` (FTP ou Gestionnaire de fichiers; compresser en .zip puis « Extraire » est plus rapide). Ajouter `ErrorDocument 404 /404.html` au `.htaccess` si la page 404 n'apparaît pas.

**Coolify** : nouvelle ressource « Static » (ou Nixpacks avec site statique) sur ce dépôt; commande de build `pnpm install --frozen-lockfile && pnpm --filter @mimt/web build`; répertoire publié `apps/web/out`. Définir les variables ci-dessus dans Coolify.

## À faire avant le lancement

- Chercher `[À confirmer par MIMT]` dans `out/` : responsable de la protection des renseignements personnels (nom, titre, adresse dédiée), raison sociale, durées de conservation, conservation chez le fournisseur d'IA, annulation et remboursement, responsabilité, centre d'appels 9-1-1 partenaire, version de l'avis 9-1-1, dates de mise à jour.

- Les textes 9-1-1, Plaintes, Confidentialité et Conditions contiennent un commentaire HTML `à valider par l'avocat` (voir `components/LegalReview.tsx`; `grep -r "valider par l'avocat" out/`).
- Remplacer les espaces réservés : responsable de la protection des renseignements personnels, raison sociale, durées de conservation, date de mise à jour.
- Les prix sont des propositions (docs/MIMT-MVP.md §6) et sont affichés comme tels.
- Polices : Montserrat et Inter via `next/font/google`, auto-hébergées à la compilation (la compilation a besoin d'Internet; sinon remplacer par les polices système dans `lib/fonts.ts`).

---

<a id="english"></a>

# @mimt/web — mimt.ca public website (English)

Static marketing site for MIMT (Next.js 16, App Router, TypeScript, `output: "export"`). French (fr-CA) is at `/`, English (en-CA) under `/en/`. Prices come from `@mimt/shared` (`PLANS`, `ADD_ONS`, `formatCad`), a single source of truth.

## Develop

```bash
pnpm install
pnpm --filter @mimt/shared build
pnpm --filter @mimt/web dev        # http://localhost:3000
pnpm --filter @mimt/web typecheck
```

## Build

```bash
pnpm --filter @mimt/web build      # also builds @mimt/shared, then exports to apps/web/out/
```

## Environment variables (read at build time)

- `NEXT_PUBLIC_SITE_URL` — canonical URL, hreflang, sitemap, Open Graph. Default `https://mimt.ca`.
- `NEXT_PUBLIC_FORMS_ENDPOINT` — where the waitlist, demo and contact forms `POST` JSON (the MIMT API later). Empty: forms open the visitor's email app to `info@mimt.ca`.

No secrets: these values are public. The CASL marketing checkbox is optional, unchecked by default and separate from the request.

## Deploy

- **MochaHost:** build, then upload the **contents** of `apps/web/out/` to `public_html/` (FTP or File Manager; upload a .zip and Extract is fastest). Add `ErrorDocument 404 /404.html` to `.htaccess` if needed.
- **Coolify:** Static resource on this repo; build command `pnpm install --frozen-lockfile && pnpm --filter @mimt/web build`; publish directory `apps/web/out`; set the variables above.

## Before launch

Legal texts (9-1-1, complaints, privacy, terms) carry an HTML comment `à valider par l'avocat` and visible `[À confirmer par MIMT]` / `[To be confirmed by MIMT]` placeholders to fill (privacy officer, legal name, retention periods, AI provider retention, refunds, liability, 9-1-1 partner call centre, notice version). Prices are proposals and are labelled as such.

SEO: per-page metadata in `lib/meta.ts`, JSON-LD in `lib/seo.ts`, FAQ in `lib/faq.ts`, `/llms.txt` from `lib/llms.ts`; `scripts/verify-out.mjs` checks the export after every build; `pnpm --filter @mimt/web test` runs the unit tests.
