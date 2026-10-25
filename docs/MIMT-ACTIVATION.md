# MIMT activation: six workstreams and verified evidence

Owner request: complete AI activation, real-phone testing, store setup, the 9-1-1 filing, measurement/ads, and backups.
Review date: 2026-10-24. Repository: `takatakca/mimtcaapp`. Baseline inspected: `25a0520db3568397c5d50e3950f9aac6cd4e9424`.
This document records observations, required access and completion tests. It is not a launch certificate.

## Update — 2026-10-25

Coolify access recovered; MIMT has no `ANTHROPIC_API_KEY` environment variable. Daily local backups are now enabled at **07:00 UTC**, with **3** local copies retained. Both the manual backup and the first scheduled run succeeded. A real archive was restored in an isolated, network-disabled, temporary PostgreSQL container: all 17 migrations and four core tables passed checks. See [current backup evidence](MIMT-BACKUPS.md).

The missing-backup threshold is 2 days, but no notification channel exists. No S3 destination is configured; Cloudflare authentication was not completed, so R2 and the remote restore drill remain blocked. GitHub's browser session is signed out, so the webphone deployment was not dispatched. Public API readiness is healthy; the AI demo remains unavailable. No AI key was entered, no number was purchased, and no store or CRTC submission was made.

## Observed on 2026-10-24

| Check | Result |
| --- | --- |
| `https://api.mimt.ca/healthz` | HTTP 200, `ok:true` |
| `https://api.mimt.ca/readyz` | HTTP 200, `db:up`, `schema:current`, `twilio:true`, `stripe:true` |
| `https://api.mimt.ca/v1/public/ai-demo/status` | HTTP 200, `available:false` |
| Public number search, area code 514 | HTTP 200, 12 numbers returned; no number purchased or reserved |
| `https://mimt.ca/mimt-release.json` | `25a0520db3568397c5d50e3950f9aac6cd4e9424` at the latest HTTP check |
| `https://app.mimt.ca/mimt-release.json` | `612284efba406d3bf708f2a4e0c574000fde5fed`; older than the inspected baseline |
| SMS login in a real browser | The UI reported a verification text sent; the submitted code was rejected as invalid or expired. No authenticated session verified. |
| Public homepage tracking | AdSense publisher present; no GA4 measurement ID or Google Ads tag ID found in the served HTML |
| Android Actions run `40080169700` | Failed before build: all four `ANDROID_UPLOAD_*` signing secrets absent |
| Backup checks | `bash scripts/db/test-backup-mimt.sh` passed; backup/restore scripts passed `bash -n`. These use mocks/syntax checks, not a production restore. |

The readiness route pings the database and checks migrations; `twilio` and `stripe` indicate configured adapters,
not successful carrier calls, SMS delivery or payment transactions. The AI status route indicates the demo switch
and gateway presence; it does not test provider authentication. Values and releases can change after this review.

## 1. AI: Coolify and Anthropic

Access needed: Coolify dashboard URL and authenticated access to the MIMT API resource; an Anthropic API key with
available API billing. Store its value directly in the server secret field. Do not send it through chat or commits.

- Set `ANTHROPIC_API_KEY` on the MIMT API runtime. Check `AI_DEMO` is not `off`.
- Existing defaults: `ANTHROPIC_MODEL=claude-opus-5-5`, `AI_DEMO_DAILY_TURNS=1500`. The model identifier was checked
  against [Anthropic's current model list](https://platform.claude.com/docs/en/models/overview). Keep existing cost caps.
- Redeploy the current approved MIMT API revision, check health/readiness, then require demo status `available:true`.
- Run one short, fictional French demo conversation and confirm an actual AI reply. Test summaries/help on an
  authorized test account with the required plan, budget and `ai_processing` consent. Test the business receptionist
  separately with owner acceptance and the WebSocket route reachable. A key alone does not satisfy these checks.

## 2. Real phone acceptance test

Continue the existing browser login at `https://app.mimt.ca/connexion/texto` through secure authentication; never
record the mobile number, OTP, session token or message content in this public repository.

| Step | Completion evidence |
| --- | --- |
| SMS login | Fresh verification succeeds and the account screen is visibly signed in |
| Paid number | Confirm plan, displayed recurring price/taxes and a spending limit before checkout; number appears active after provisioning |
| Outbound and inbound voice | One controlled call each way with two-way audio; matching carrier/app outcomes |
| Outbound and inbound SMS | One harmless test message each way, visibly received at both endpoints |
| Free `@name` service | Two test accounts exchange a message and a call without purchasing a number; retain the free-plan call cap |

No emergency test calls. Keep existing Twilio numbers untouched. Log pass/fail and provider error codes without
personal data. The owner must participate on the physical phone and confirm audio/message receipt.

## 3. Store setup

Use the existing workflows and guides, not replacement build pipelines:
[Android](store/android-build.md), [iOS](store/ios-build.md), [App Store/IAP](store/app-store.md), [Play](store/google-play.md).

| Destination | Exact secret names |
| --- | --- |
| GitHub Actions, Android signing | `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` |
| GitHub Actions, Android notifications/upload | `GOOGLE_SERVICES_JSON_BASE64`, `PLAY_SERVICE_ACCOUNT_JSON` |
| GitHub Actions, iOS | `EXPO_TOKEN`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, `ASC_API_KEY_P8` |
| Coolify API, purchase verification | `APPLE_ROOT_CA_PEM`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_RTDN_TOKEN` |

Public build variables: `EAS_PROJECT_ID`, `APPLE_TEAM_ID`, `ASC_APP_ID`, `TAKATAK_ISSUER`,
`TAKATAK_MOBILE_CLIENT_ID`, and the AdMob variables below. API package identifiers: `APPLE_BUNDLE_ID=ca.mimt.app`,
`GOOGLE_PLAY_PACKAGE_NAME=ca.mimt.app`. `PLAY_SERVICE_ACCOUNT_JSON` uploads builds; the separately named
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` verifies purchases server-side. Scope each account to its actual job.

Create these six auto-renewing products in both stores:

| Product ID | Duration |
| --- | --- |
| `ca.mimt.app.lock.monthly` | Monthly |
| `ca.mimt.app.lock.yearly` | Yearly |
| `ca.mimt.app.premium.monthly` | Monthly |
| `ca.mimt.app.premium.yearly` | Yearly |
| `ca.mimt.app.noads.monthly` | Monthly |
| `ca.mimt.app.noads.yearly` | Yearly |

Resolve the price conflict before saving products: the store guide's 12.99 CAD Essentiel suggestion conflicts with
the approved maximum 70% carrier-cost rule after store commission. Use the existing margin model and actual store
commission to select compliant monthly and annual prices; document the owner's final choice.

Configure App Store notifications V2 at `https://api.mimt.ca/webhooks/appstore` and Google Play RTDN using the
existing guide. Do not put the RTDN tokenized URL in logs or chat. Verify signed builds, TestFlight/internal testing,
sandbox purchase/restore/renewal/expiry, real-device incoming calls and review accounts before store submission.
Do not replace an existing upload key; create one only if no production key exists and store it durably in the
owner's secret manager and repository secret settings. Accepting developer agreements requires the owner.

## 4. 9-1-1: counsel and CRTC

Prepared [filing draft and evidence gaps](MIMT-CRTC-DRAFT.md). The code's draft French/English notice is
`apps/api/src/e911/notice.ts`; the default version remains `2026-10-fr-draft-1` until approved wording is available.
Obtain the lawyer's contact, legal entity details, existing registration and provider evidence privately. Have counsel
approve the notices and filing facts, then submit through the authorized CRTC account and retain its receipt privately.
No lawyer contacted, filing submitted or emergency service certified in this session.

## 5. Measurement and advertising

Account access needed: GA4, Google Ads, AdSense and AdMob. No advertising campaign or ad spend is authorized by
configuring these identifiers. See [measurement guide](MIMT-ADS-TRACKING.md).

| Destination | Exact public variable names |
| --- | --- |
| GitHub Actions variables | `GA4_ID`, `GADS_ID`, `GADS_HOLD_LABEL`, `ADSENSE_SLOT_BANNER`, `ADSENSE_SLOT_SIDEBAR` |
| Mobile build variables | `ADMOB_IOS_APP_ID`, `ADMOB_ANDROID_APP_ID`, `ADMOB_IOS_BANNER_UNIT_ID`, `ADMOB_IOS_REWARDED_UNIT_ID`, `ADMOB_ANDROID_BANNER_UNIT_ID`, `ADMOB_ANDROID_REWARDED_UNIT_ID` |

After setting real account IDs, rebuild/deploy website and webphone; rebuild mobile for AdMob. Verify consent
defaults, acceptance/withdrawal, the number-reserved event in GA4/Ads diagnostics, and test-device AdMob delivery.
The current documented conversion is a number reservation, not a completed purchase; do not report purchase
attribution until a verified purchase event or server-side conversion integration exists.

## 6. Backups and recovery

Access needed: Cloudflare R2 and Coolify MIMT PostgreSQL settings, plus GitHub secret settings. Follow
[backup guide](MIMT-BACKUPS.md); preserve the private `mimt_production`/TAKATAK separation.

- Private bucket `mimt-backups`; a bucket-scoped writer for Coolify and a separate read-only credential for restore.
- Configure and validate Coolify S3 storage; schedule a daily backup, local retention 3, remote retention 14.
  Confirm the scheduler timezone: `0 7 * * *` means 07:00 in that timezone, not permanently 03:00 Montreal.
- Run Backup Now, inspect successful upload, then configure `MIMT_BACKUP_S3_ENDPOINT`, `MIMT_BACKUP_S3_BUCKET`,
  `MIMT_BACKUP_S3_PREFIX`, `MIMT_BACKUP_S3_READONLY_KEY_ID`, `MIMT_BACKUP_S3_READONLY_SECRET` in GitHub.
  For the age-encrypted path, retain the decryption key separately and configure the documented drill identity.
- Run `Backup restore drill` on a disposable database. Require the **real backup** step to restore successfully;
  a green synthetic self-test or a warning that credentials are absent is insufficient.
- Confirm alerts and the next scheduled backup. Do not restore over production. Do not expose the R2 bucket publicly.

## Next action

Enter the Anthropic key directly in the prepared MIMT Coolify field, then redeploy and verify a real response. Obtain Cloudflare access for R2 and a notification channel. Resume phone sign-in
with a fresh code through the secure browser flow. Store, Google and legal account access can follow independently.
Record each real completion with its release/run/receipt evidence; keep blocked work explicitly blocked.
