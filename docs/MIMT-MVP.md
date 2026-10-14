# MIMT: architecture and MVP plan

> **Document de planification historique daté du 9 octobre 2026.** Les passages ci-dessous qui indiquent « aucun code / aucun repository », ou qui prescrivent un projet Supabase payant, sont **dépassés**. Le code est dans `takatakca/mimtcaapp` et l'API utilise désormais le PostgreSQL 17 privé MIMT sur Coolify. Lire `docs/PROJECT_STATUS.md`, `docs/MIMT-LAUNCH.md` et `docs/MIMT-SELFHOSTED-POSTGRES-RECOVERY.md` pour l'état actuel; ne pas exécuter les anciennes instructions de provisioning.

Prepared: 2026-10-09 by the MIMT agent (agent 2). Status: **plan only. No code, no repository, no purchases yet.**
Companion docs: [MIMT.md](MIMT.md) (scope), [MIMT-REGULATORY.md](MIMT-REGULATORY.md) (rules), [MIMT-STACK.md](MIMT-STACK.md) (costs).

Scope reminder (from `MIMT.md`): TAKATAK owns identity, Business Registry, workspaces, verification and activation. MIMT owns telecom accounts, numbers, voice, SMS/MMS, voicemail, telecom billing and every Twilio-facing operation. This plan does not touch the TAKATAK V1 AI panel, Social or homepage.

## 0. What exists today (verified 2026-10-09)

| Item | Finding | Evidence |
| --- | --- | --- |
| MIMT code repository | **None.** No `mimt` repo in the `takatakca` account. | Repository list, 2026-10-09 |
| `mimt.ca` | Domain held, status `UNKNOWN_NEEDS_AUDIT` | `registry/portfolio-registry-2026-10-06.json` |
| Twilio in TAKATAK code | Used for **Verify (OTP)** and outbound **SMS** only (`takatakbackend/utils/sendOtpToPhone.js`, `takatak-v1/src/lib/auth/otp/*`, `takatak-v1/src/lib/hockey/delivery/twilio-sms.ts`). Variables are commented out in `.env.example`. TAKATAK's own deploy doc says phone login now goes through Supabase Phone Auth and the Twilio variables are "legacy". | Code read 2026-10-09 |
| Twilio voice, numbers, Voice SDK | **No code anywhere.** | Same |
| Live Twilio account | **Not verifiable from here**: no Twilio credentials in this environment (correct: secrets must not be pasted in chat). | Environment check |
| TAKATAK ↔ MIMT hook | `takatak-v1/src/lib/voip/voip-status.ts` waits for `MIMT_API_URL` + `MIMT_API_KEY` and can never report "connected" until a real MIMT API exists ("Gate 3"). | Code read |

**Conclusion: "Twilio is connected" is true only for OTP/SMS in TAKATAK, and even that is unconfirmed live. For MIMT, nothing is connected.** To confirm the account, the owner logs into console.twilio.com and checks: account is upgraded (not trial), Canadian regulatory bundle/address status, numbers owned, and Voice geo-permissions. Then the keys go into the cloud environment's secrets, never in chat.

## 1. Product shape

One app, two audiences, one backend.

- **MIMT Mobile** (consumer, TextNow/Fongo-style): a Canadian number in an app, calls and SMS over Wi-Fi/data, voicemail, ads in the free tier.
- **MIMT Affaires** (business VoIP, Rogers Unison-style): per-line monthly fee, extensions, auto-attendant, ring groups, call recording, admin portal, mobile + desktop softphone.
- **Later:** internet and cellular resale (phase 3, after a signed Vidéotron or other wholesale agreement).

French first everywhere (UI, store listings, contracts, support), English second. See `MIMT-REGULATORY.md` › Quebec language.

## 2. App technology: React Native (Expo, development builds)

**Choice: React Native + Expo with a custom dev client (prebuild), TypeScript.**

| Criterion | React Native / Expo | Flutter |
| --- | --- | --- |
| Twilio Voice SDK | **Official** `@twilio/voice-react-native-sdk` (Twilio-maintained; wraps CallKit on iOS and ConnectionService/Telecom on Android) | No official Twilio Voice SDK; community plugins only. Risky for the core feature. |
| Code reuse with TAKATAK | TAKATAK V1 is TypeScript/React (Next.js). Same language, shared types for the API contract, same people can review it. | Dart: a second language and toolchain. |
| Desktop softphone (business) | Same React code in an Electron or web app with the Twilio Voice **JS** SDK | Flutter desktop exists but no Twilio SDK |
| Builds | Expo EAS free tier is enough at the start; local builds possible | Free local builds |
| Limit | Expo Go cannot run native VoIP modules: a development build is required (normal for VoIP apps) | n/a |

The deciding fact: the calling engine is the product, and only React Native has an officially supported Twilio Voice SDK. Flutter would mean betting the core on a community plugin.

## 3. System architecture

```
 iOS / Android app (RN)           Desktop softphone (Electron/web, phase 2)
        │  HTTPS (JWT)  ▲ VoIP push (PushKit / FCM)
        ▼               │
 ┌──────────────── MIMT API (Node.js + TypeScript, Fastify) ────────────────┐
 │ auth/handoff · accounts · numbers · calls · messages · voicemail          │
 │ billing (Stripe) · entitlements · fraud/limits · admin · webhooks         │
 └───────┬──────────────┬─────────────────┬───────────────┬─────────────────┘
         │              │                 │               │
   Supabase Postgres   Twilio           Stripe        TAKATAK V1
   (own MIMT project)  (Voice, SMS,     (subs,        (identity IdP,
   + Storage (VM       Numbers, SDK,    invoices,     Business Registry,
   audio, RLS)         9-1-1 partner)   tax)          dashboard overview)
```

- **Hosting:** the MIMT API runs as a container on the owner's existing **Coolify** server (or MochaHost if Coolify is not available). Webhooks need a public HTTPS hostname: `api.mimt.ca`.
- **Database:** a **separate Supabase project for MIMT**, not TAKATAK's. Telecom records (CDRs, consent, 9-1-1 addresses) have their own retention and transfer rules (`docs/05-IDENTITY-AND-MULTISITE.md`: MIMT must keep its own transferable records). Region: Canada (`ca-central-1`) to simplify Law 25.
- **Twilio layout:** one parent account, **one subaccount per environment** (staging, production) and, in phase 2, **one subaccount per business customer** (isolates usage, spend caps, and makes a customer transfer possible).
- **Webhooks:** every Twilio webhook is checked with the `X-Twilio-Signature` header; every Stripe webhook with its signing secret. Idempotency keys on all writes.
- **Secrets:** Twilio auth tokens are never used by the app. The app gets a short-lived **Twilio Access Token** (Voice grant, 1 h TTL, identity = MIMT user id) from the API. Server uses an API Key/Secret, not the master auth token.

## 4. Identity handoff with TAKATAK (no passwords in URLs)

TAKATAK is the identity provider; MIMT is a relying party that also keeps its own fallback login (required by doc 05 so a customer can leave TAKATAK management).

**Flow A — sign in to the MIMT app ("Continuer avec TAKATAK"):** OAuth 2.0 Authorization Code + **PKCE** (RFC 7636) against TAKATAK. The redirect carries only a one-time, 60-second, single-use `code` and `state`; never a password, token or API key. MIMT's API exchanges the code server-to-server and receives an ID token signed by TAKATAK (asymmetric key, ES256; MIMT verifies with TAKATAK's published JWKS). Claims used: `sub` = `global_user_id`, `workspace_id`, `business_id` (if any), `email_verified`, `phone_verified`, `aud=mimt`, `exp` ≤ 5 min, `jti` (replay-checked).

**Flow B — activation from the TAKATAK dashboard ("Activer la téléphonie"):** TAKATAK's server calls `POST https://api.mimt.ca/v1/handoff/activations` with a JWT it signs (ES256, `aud=mimt`, `exp` 60 s, `jti`), body = `{global_user_id, workspace_id, business_id, plan_hint, locale}`. MIMT answers with an opaque `handoff_id`. The browser is sent to `https://app.mimt.ca/activate?h=<handoff_id>`; that id is single-use, expires in 2 min, is bound to the TAKATAK session, and only works after the user signs in by Flow A. It grants nothing on its own.

**Flow C — status back to TAKATAK:** MIMT sends signed webhooks (`entitlement.updated`, `telecom_account.status_changed`, `phone_number.assigned`) to TAKATAK. TAKATAK's dashboard reads an authorized overview through `MIMT_API_URL` + `MIMT_API_KEY` (server-side only), which turns on the existing "Gate 3" in `voip-status.ts`.

Shared identifiers (from doc 05): `global_user_id`, `workspace_id`, `business_id`, `telecom_account_id`, `service_subscription_id`, `phone_number_id`. MIMT never stores TAKATAK passwords and TAKATAK never stores Twilio credentials.

## 5. Data model (Postgres, phase 1 + phase 2 hooks)

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id`, `global_user_id` (unique, nullable for fallback-only users), `locale` (`fr-CA` default), `phone_verified_at`, `status` | RLS: user sees own rows |
| `telecom_accounts` | `id`, `owner_user_id`, `business_id` (nullable), `kind` (`consumer`/`business`), `twilio_subaccount_sid`, `status` (`ACTIVE_MANAGED`… from doc 05), `risk_tier` | One per person or business |
| `service_subscriptions` | `id`, `telecom_account_id`, `plan_code`, `stripe_subscription_id`, `status`, `current_period_end` | Source of entitlements |
| `entitlements` | `telecom_account_id`, `feature` (`no_ads`, `vm_transcription`, `intl_calling`, `number_lock`, `extra_number`, `recording`…), `limit`, `source` | Computed from subscriptions; checked server-side |
| `phone_numbers` | `id`, `e164`, `twilio_sid`, `telecom_account_id`, `kind` (`local`/`toll_free`), `state` (`active`/`locked`/`grace`/`quarantine`/`released`/`porting_in`/`porting_out`), `last_activity_at`, `quarantine_until` | Lifecycle drives recycling rules (§7) |
| `e911_addresses` | `id`, `telecom_account_id`, `phone_number_id`, civic address fields, `validated_at`, `provider_ref` | Required before outbound PSTN calling is enabled |
| `e911_acknowledgements` | `user_id`, `notice_version`, `accepted_at`, `ip`, `app_version` | Proof of 9-1-1 limitations notice (see regulatory doc) |
| `calls` | `id`, `twilio_call_sid`, `direction`, `from`, `to`, `started_at`, `duration_s`, `price`, `rated_cad`, `recording_id` | CDRs; retention per regulatory doc |
| `messages` | `id`, `twilio_sid`, `direction`, `from`, `to`, `body_encrypted`, `status`, `segments`, `price` | Bodies encrypted at rest; user can delete |
| `voicemails` | `id`, `phone_number_id`, `audio_path`, `transcript`, `transcript_lang` | Audio in private Supabase Storage bucket |
| `consents` | `user_id`, `kind` (`casl_marketing`, `ads_personalised`, `call_recording_notice`, `privacy_policy`, `terms`), `granted`, `version`, `at`, `source` | CASL + Law 25 proof |
| `usage_ledger` | `telecom_account_id`, `period`, `minutes_out`, `sms_out`, `intl_spend_cad`, `credits_cad` | Hard caps read this before each call/SMS |
| `fraud_events` | `telecom_account_id`, `rule`, `score`, `action`, `at` | Audit of blocks |
| *phase 2* `extensions`, `ring_groups`, `ivr_menus`, `business_hours`, `call_recordings`, `devices` | per business account | PBX objects |

## 6. Plans and pricing (proposal, to validate with the owner)

Prices in CAD, before GST/QST. Numbers below come from the cost model in `MIMT-STACK.md`; they are starting points, not commitments.

| Plan | Price | What you get | Cost guardrails |
| --- | --- | --- | --- |
| **Gratuit** (free, ads) | 0 $ | 1 Canadian number, unlimited app-to-app calls and texts, voicemail (no transcription), **30 outbound minutes and 50 SMS/month** to Canada/US, more minutes earned by watching rewarded ads. 9-1-1 included. | Costs about C$6/user/month on Twilio (see `MIMT-STACK.md` §2), so it stays a limited tier until ad revenue per user is measured. Number reclaimed after 30 days without activity (warnings at day 20 and 27). Hard daily caps. No international. |
| **Verrouillage du numéro** (number lock) | 4,99 $/mo or 39,99 $/yr | Keeps the number even with no activity. Ads stay. | Covers the number + 9-1-1 cost (C$2.64) with margin. |
| **Premium** | 19,99 $/mo | No ads, number lock included, **500 outbound min + 500 SMS** Canada/US, unlimited app-to-app, 1 000 inbound min, voicemail transcription, call forwarding, MMS. | Typical cost about C$16/month on Twilio; about C$45 at full caps. Overage packs; usage alerts at 80%. |
| **Add-ons** | Extra number 4,99 $/mo · International credits (prepaid, from 5 $) · Extra 250 min 7,99 $ | Second number; pay-as-you-go international at carrier cost + margin. | International is **prepaid only**. Cuba needs a second carrier (not on Twilio). |
| **Affaires** (business, per line) | 34,99 $/line/mo; **Affaires Pro** 44,99 $ with recording + transcription | Extension, DID, 1 000 pooled outbound min per line, voicemail-to-email, auto-attendant, ring groups, business hours, mobile + desktop apps, admin portal. | Per-business Twilio subaccount and spend cap. |

The Quebec 9-1-1 municipal tax (C$0.55/number/month in 2026) and GST/QST are added on the bill.

Notes:
- Selling through Apple/Google: in-app digital subscriptions must use their billing (15% fee under the small-business programs). Telecom service sold to businesses and international credits that are consumed outside the app may qualify for external payment; **confirm with each store's current rules before launch**. Business plans are sold on the web (Stripe) from the TAKATAK dashboard to avoid store fees.
- Free-tier economics only work with tight caps; see the break-even in `MIMT-STACK.md`.

## 7. Abuse and fraud controls

Toll fraud and SMS pumping are the main ways a small telecom loses money overnight. Controls ship in phase 1, before public launch.

**Signup and identity**
- Phone verification (Twilio Verify or Supabase phone auth already used by TAKATAK) + device attestation (Apple App Attest, Google Play Integrity). One free number per verified device and per verified phone.
- Disposable email and VoIP-number blocklist for signup (Twilio Lookup line-type check).
- New accounts start in `risk_tier=new`: lower caps for 14 days.

**Toll fraud (voice)**
- Twilio **Voice Geographic Permissions**: only Canada + US enabled at the account level; international destinations opened one by one for prepaid users; high-risk ranges (premium-rate, satellite, known IRSF countries) never enabled.
- International calling is **prepaid credit only**; the API checks the balance and the per-call maximum before dialing (`<Dial timeLimit>`).
- Per-account hourly/daily minute caps and simultaneous-call limit (free: 1; premium: 2; business: per line).
- Phase 2 PBX: no open SIP registration on the internet; softphones use the Voice SDK with short-lived tokens. If SIP desk phones are added: strong generated credentials, IP ACLs, and Twilio SIP Domain limits.
- Twilio account-level **usage triggers** that email/SMS the owner and auto-suspend a subaccount when daily spend exceeds a threshold.

**SMS pumping and spam**
- Twilio **Messaging Geographic Permissions**: Canada + US only.
- Rate limits per sender (per minute/hour/day) and per new recipient; spikes to many new recipients or to number ranges trigger a hold.
- Block sending OTP-shaped or bulk-identical texts from free accounts; MIMT is person-to-person, not a bulk SMS gateway (also keeps CASL exposure low).
- STOP/ARRET/UNSUBSCRIBE handling on any business messaging; Twilio Advanced Opt-Out.
- Verify Fraud Guard / geo-permissions on MIMT's own OTP flow.

**Number recycling**
- Lifecycle: `active` → (30 days no activity, free tier) `grace` (7 days, reclaim warnings) → `quarantine` (**90 days**, no inbound routed to a new user, auto-reply "number not in service") → `released` to the pool or to Twilio.
- On release: delete messages, voicemails and caller-ID name tied to the old user; never hand a number to a new user before quarantine ends. Confirm the minimum aging period with the numbering partner and counsel.
- Locked or paid numbers never enter the recycling path while paid; on non-payment they go to `grace` first.
- Port-out protection: account PIN required for port-out; notify the user on every port request.

**Monitoring**
- Daily cost report per subaccount; anomaly alert if spend > 3× trailing 7-day average.
- `fraud_events` table + admin view; manual review queue.

## 8. Phased roadmap

### Phase 0: decisions and paperwork (2–4 weeks, low cost)
1. Owner confirms the Twilio account status in the console (see §0).
2. Telecom lawyer review of `MIMT-REGULATORY.md`; CRTC reseller registration; CCTS participation; 9-1-1 provider chosen.
3. Owner approves the repo name (**proposal: `takatakca/mimt`, private**) and the phase-1 budget in `MIMT-STACK.md`.
4. Apple Developer + Google Play accounts opened under the company name (needed for VoIP push certificates and testing).

### Phase 1: app-to-PSTN calling + SMS + numbers (≈ 10–14 weeks for one developer + agent help)
- MIMT API, Supabase schema, Twilio subaccount, signed TAKATAK handoff (Flows A–C).
- App: onboarding (French first), 9-1-1 address + limitations acknowledgement, pick a number by area code, calls in/out with CallKit/ConnectionService and VoIP push, SMS/MMS threads, voicemail, contacts.
- Plans: free with ads (AdMob + consent), number lock, premium via store subscriptions; web billing for add-ons via Stripe.
- Fraud controls of §7, monitoring, admin console (minimal).
- Exit criteria: closed beta of 50–100 users in Quebec, 9-1-1 test calls passed with the provider, no fraud incident in 30 days, lawyer sign-off on terms, privacy policy and 9-1-1 notice.

### Phase 2: business VoIP (≈ 10–12 weeks after phase 1)
- Built on Twilio Programmable Voice (TwiML/Studio for IVR, `<Dial>` with ring groups, Conference for transfers, Recording + transcription), unless the white-label PBX route in `MIMT-STACK.md` is chosen to reach market faster.
- Admin portal in the TAKATAK dashboard area that MIMT owns (via API), desktop softphone, porting-in of existing business numbers, per-line Stripe billing, Business Registry link.
- Exit criteria: 3 pilot businesses, porting completed, recording consent prompts in French/English.

### Phase 3: internet and cellular resale (planning only)
- Requires a signed wholesale agreement (Vidéotron or other), the Internet Code and Wireless Code compliance, retail credit/collections, and installation/logistics. See `MIMT-REGULATORY.md` › Vidéotron.
- Prepare now only what is free: keep the data model product-agnostic (`service_subscriptions.plan_code`, `telecom_accounts.kind`), and keep billing in Stripe so new products are just new prices.
- Do not build until the agreement is signed and its technical interface (provisioning API, SIM/eSIM logistics) is known.

## 9. Open decisions for the owner

1. Repo name and visibility (proposal: `takatakca/mimt`, private).
2. Build the business PBX on Twilio vs white-label (see `MIMT-STACK.md`).
3. Final prices (§6).
4. Who signs as the CRTC/CCTS contact and as the Law 25 privacy officer.
