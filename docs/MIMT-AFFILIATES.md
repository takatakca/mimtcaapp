# MIMT: programme d'agents affiliés / affiliate agent program

Owner request (2026-10-28): « On va créer des contrats légaux… un formulaire rempli en ligne, puis ils deviennent des agents affiliés », with commission percentages, signed electronically (DocuSign).

> The contract is a **draft**: « Brouillon — à faire réviser par un avocat avant usage ». Tax points are « à valider par le comptable ». Nothing was created in the owner's DocuSign account.

## Where things are

| Piece | Path |
| --- | --- |
| Public page + form | `apps/web/components/pages/AffiliatesPage.tsx`, `apps/web/components/AffiliateForm.tsx` — mimt.ca/affilies/ (en: /en/affiliates/) |
| Link capture on mimt.ca | `apps/web/lib/affiliate-link.ts` (SiteEffects keeps `?aff=`; the number picker sends it with the hold; app links get `?aff=`) |
| API | `apps/api/src/routes/affiliates.ts`, `apps/api/src/services/affiliates.ts`, `apps/api/src/repo/affiliates*.ts` |
| Database | `supabase/migrations/0019_affiliates.sql` (in `MIGRATION_ORDER`) |
| Stripe hooks | `apps/api/src/routes/billing.ts` (`invoice.paid`, `charge.refunded`, `charge.dispute.created`, checkout `affiliate` field) |
| DocuSign | `apps/api/src/gateways/docusign.ts` |
| Contract | `docs/legal/contrat-affilie.md` (French authoritative, English translation), copied word for word in `apps/api/src/affiliates/contractTemplate.ts` (a test checks it) |
| Dashboard | webphone `/affilie` — `apps/webphone/src/pages/Affiliate.tsx`; link capture `apps/webphone/src/lib/affiliate.ts` |
| Shared constants and types | `packages/shared/src/affiliates.ts` |

## Flow and statuses

```
applied ──approve──▶ approved ──send contract──▶ contract_sent ──signed (DocuSign Connect or manual)──▶ active
   │                    │                              │  └─ envelope declined/voided ─▶ approved            │  ▲
   └──reject──▶ rejected◀┘                              └─ terms changed ─▶ approved            suspend ▼  │ reactivate
                (deleted 90 days after the decision)                                                    suspended
                                                                   active / suspended / contract_sent / approved ─▶ terminated
```

1. **Application** (mimt.ca form → `POST /v1/public/affiliates/applications`): legal name, business name (optional), email, phone (Canadian, 10 digits), province, promotion channels, audience size, GST/QST numbers (optional), Law 25 notice consent (required), CASL marketing consent (optional, separate, unchecked), 18+ attestation (required). Answer is always `202 {received:true}` (no enumeration of who applied).
2. **Approve** (admin): an 8-character code (no 0/O/1/I) and the terms (defaults below).
3. **Send contract**: with DocuSign configured, an envelope is created from the template with the terms as locked text tabs; without it, the endpoint answers `mode: "manual"` with the filled contract text (French; the English translation follows for an English-speaking affiliate) to send by email or another e-signature tool.
4. **Signed**: DocuSign Connect `envelope-completed` (HMAC-verified) or the admin's « mark signed » → `active`. The affiliate link works from then on.
5. **Dashboard**: the affiliate signs in to app.mimt.ca with the phone number from the application (SMS sign-in): `GET /v1/affiliates/me` binds that user once (keyed phone hash match) and shows link, code, counts, ledger and payout progress. Customers' identities are never shown.

## Attribution

- Link: `https://app.mimt.ca/?aff=CODE` (also works as `https://mimt.ca/?aff=CODE`: the site keeps it and passes it on). Code typed by hand works too (`POST /v1/affiliates/attribution`).
- **First touch**: the browser keeps the first code with the click time; the server keeps the first attribution per account (`affiliate_referrals`, primary key = account) and never overwrites it.
- Recorded server-side: right after sign-in (`POST /v1/affiliates/attribution`, source `signup`), with every Stripe Checkout (`affiliate` field, source `checkout`), and with a live-picker number hold made on mimt.ca (`affiliate_hold_touches`, source `hold`, used when that hold is paid).
- **60-day window**: the click must be at most 60 days old when recorded, and the customer's first paid invoice must come before `touched_at + 60 days` (`expires_at`).
- Only **new customers** (no paid plan before, any channel) and only **active** affiliates.
- **No self-referral**: refused (and logged in `fraud_events` as `affiliate_self_referral`) when the customer is the affiliate's bound user, has the affiliate's phone or email (keyed hashes), or pays with a card already seen on the affiliate's own account.

## Commission math

- **Base**: each paid Stripe **subscription invoice** of an attributed account (`invoice.paid`, `amount_paid > 0`). Net revenue = amount paid, minus the TPS/GST, TVQ/QST and 9-1-1 tax lines (MIMT bills them as separate lines while Stripe Tax is off), in proportion when a balance credit paid part of it. Without line details, taxes are taken out at 14.975 %. Not counted (said in the contract and on the page): App Store / Google Play purchases, one-time purchases (minute packs, international credit).
- `commission = floor(net × commission_bps / 10 000)` — per invoice, rounded down to the cent.
- **Duration**: invoices paid within `duration_months` of the customer's first commissionable invoice.
- **Idempotent**: one ledger row per invoice (`source_ref = invoice:<id>`, unique) — Stripe retries or duplicate events write nothing more.
- **Hold**: `pending` for 30 days (`payable_at = paid_at + 30 days`), then `payable` (daily job and on every dashboard / export read).
- **Reversals**: `charge.refunded` → reversed in proportion of the refunded amount; `charge.dispute.created` → reversed entirely. On a pending/payable row, `reversed_cents` goes up (status `reversed` when fully reversed). On a **paid** row, a negative `clawback` row (`payable`) is added and deducted from the next payout. (The charge → invoice link uses Stripe's invoice payments API.)
- **Payout**: monthly, when the payable balance (clawbacks included) is at least the threshold; terminated affiliates are paid any positive balance even below the threshold (contract 11.4); suspended affiliates are withheld.

**Defaults** (`AFFILIATE_DEFAULTS`, per affiliate in the admin): **20 %** of net revenue (`commission_bps` 2000; allowed 1–50 %), **12 months** per referred customer (1–36), **payout threshold 50 $** (0–1 000 $). Hold 30 days, attribution window 60 days.

Example: Premium at 29,99 $/month → 5,99 $ per paid month → 71,88 $ over 12 months.

## API

Public:

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/public/affiliates/applications` | 202 always on success. Spam: honeypot `website`, `elapsedMs` < 3 s ignored, 5/hour per IP (route limit), 10/day per IP and 200/day overall (`rateLimiter`). Body never logged; personal fields encrypted at rest (one AES-GCM blob), email/phone as keyed hashes. |

Signed-in (Bearer):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/affiliates/attribution` | `{code, touchedAt?}` → `{attributed}`. 10/hour. |
| GET | `/v1/affiliates/me` | Dashboard; 404 `not_affiliate` otherwise. |
| POST | `/v1/billing/checkout` | new optional field `affiliate: {code, touchedAt?}`; never blocks the checkout. |
| POST | `/v1/public/numbers/holds` | new optional fields `affiliateCode`, `affiliateTouchedAt`. |

Admin (same rule as `routes/adminCosts.ts`: signed-in user id in `CATALOG_ADMIN_USER_IDS`):

| Method | Path | Body |
| --- | --- | --- |
| GET | `/v1/admin/affiliates?status=&limit=` | list (personal fields decrypted for staff) |
| GET | `/v1/admin/affiliates/:id` | one |
| POST | `/v1/admin/affiliates/:id/approve` | optional `{commissionBps, durationMonths, payoutThresholdCents}` |
| POST | `/v1/admin/affiliates/:id/reject` | optional `{reason}` |
| PUT | `/v1/admin/affiliates/:id/terms` | `{commissionBps, durationMonths, payoutThresholdCents}` (before signature; after « contract sent » it goes back to approved: void the old envelope) |
| POST | `/v1/admin/affiliates/:id/contract` | → `{mode:"docusign", envelopeId}` or `{mode:"manual", contractText}` |
| POST | `/v1/admin/affiliates/:id/signed` | optional `{signedAt}` — manual signature |
| POST | `/v1/admin/affiliates/:id/status` | `{status: "active" \| "suspended" \| "terminated", reason?}` |
| GET | `/v1/admin/affiliate-commissions/payable.csv` | one line per payable row of affiliates due a payout (name, email, GST/QST, totals); text cells protected against spreadsheet formulas |
| POST | `/v1/admin/affiliate-commissions/mark-paid` | `{affiliateId, payoutRef, ids?}` |

Webhook: `POST /webhooks/docusign` (DocuSign Connect, JSON, HMAC in `X-DocuSign-Signature-1`; 503 without the key).

Everything is in the audit log (`affiliate.*`) without personal data.

## Environment variables (API)

| Variable | Meaning |
| --- | --- |
| `DOCUSIGN_ACCOUNT_ID` | API account id (GUID) |
| `DOCUSIGN_INTEGRATION_KEY` | integration key (client id) of the app |
| `DOCUSIGN_USER_ID` | user GUID the JWT impersonates (the owner or a service user) |
| `DOCUSIGN_PRIVATE_KEY` | RSA private key of the integration key (PEM; `\n` accepted) |
| `DOCUSIGN_BASE_URL` | REST base, e.g. `https://demo.docusign.net/restapi` (sandbox) or `https://ca.docusign.net/restapi` — must be https. The OAuth host follows it (`account-d` for demo). |
| `DOCUSIGN_TEMPLATE_ID` | the affiliate agreement template |
| `DOCUSIGN_TEMPLATE_ROLE` | signer role name in the template (default `Affilie`) |
| `DOCUSIGN_CONNECT_HMAC_KEY` | HMAC key of the Connect configuration |

All of the first six are needed for DocuSign mode; otherwise contracts go out in manual mode. Existing `CATALOG_ADMIN_USER_IDS` lists the admins.

## DocuSign template (owner to create)

- Document: the French text of `docs/legal/contrat-affilie.md` (between the `contract:fr` markers), after the lawyer's review.
- One signer role named **`Affilie`** (or set `DOCUSIGN_TEMPLATE_ROLE`); MIMT's own signature can be a second role or a pre-signed block.
- Text tabs with exactly these **tab labels** (filled and locked by the API): `affiliate_legal_name`, `commission_pct`, `duration_months`, `payout_threshold`, `effective_date`.
- Values sent: `commission_pct` « 20 » (« 12,5 » for 1250 bps), `duration_months` « 12 », `payout_threshold` « 50,00 » (the template writes the « $ »), `effective_date` « 2026-11-01 » (Montréal date of sending).
- Connect: a configuration for « Envelope Completed, Declined, Voided », JSON (SIM) format, HMAC on, URL `https://<api>/webhooks/docusign`.
- Integration key with JWT grant (RSA key pair), consent granted once by the impersonated user (scope `signature impersonation`).

## Owner to-dos

1. **Lawyer review** of `docs/legal/contrat-affilie.md` (and confirm the legal entity name, address and NEQ that replace « [Raison sociale de l'exploitant de MIMT — à confirmer] »), plus the application page wording and the privacy notice on the form.
2. **Accountant** (« à valider par le comptable »): reporting of fees paid to affiliates — e.g. **T4A, box 048 (fees for services), for fees over 500 $ in a calendar year**, any Québec slip; collecting the affiliate's SIN or business number at the first payout; GST/QST on commissions paid to registered affiliates; whether commissions count against GST/QST input tax credits.
3. **DocuSign**: create the template above, the integration key (JWT) and the Connect configuration; set the `DOCUSIGN_*` variables in Coolify. Until then, use manual mode.
4. **Payout process** (monthly): download `payable.csv`, pay each affiliate by bank transfer / Interac by the 15th (add GST/QST for registered affiliates against their invoice), then `mark-paid` with the transfer reference. Keep the CSV and proofs with the accounting records.
5. Deploy: migration **0019** (one-shot migrator), API, webphone, site. Add the admin user ids to `CATALOG_ADMIN_USER_IDS` if needed.
6. Decide later whether App Store / Google Play and one-time purchases should earn commissions (needs store revenue reports; the contract already says « tant que MIMT n'en avise pas l'Affilié par écrit »).

## Tests

- `apps/api/test/affiliates.test.ts` — form (encryption, honeypot, timing, consents, per-IP limit), admin workflow, manual and DocuSign contract (gateway mocked), Connect HMAC, attribution rules, commission math, refunds/chargebacks/clawbacks, self-referral by phone and card, dashboard, CSV export and mark-paid, contract text = docs file.
- `apps/api/test/affiliates.repo.contract.test.ts` — memory and Postgres repositories behave the same (runs on Postgres with `TEST_DATABASE_URL`, `scripts/db/test-postgres.sh`).
- `apps/web/test/affiliates.test.ts`, `apps/webphone/src/pages/Affiliate.test.tsx`, `apps/webphone/src/lib/affiliate.test.ts`, `packages/shared/src/affiliates.test.ts`.
