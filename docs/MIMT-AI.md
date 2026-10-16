# MIMT: AI features (Claude)

Prepared: **2026-10-10** by the MIMT agent. Contract: `packages/shared/src/ai.ts`. Code: `apps/api/src/ai/*`, `apps/api/src/routes/ai.ts`, `apps/api/src/routes/twilioAi.ts`. Schema: `supabase/migrations/0004_ai.sql`. Tests: `apps/api/test/ai.test.ts` (fake gateway only; no test calls the real API).

Companion docs: [MIMT-REGULATORY.md](MIMT-REGULATORY.md) · [MIMT-MVP.md](MIMT-MVP.md)

## 1. What it does

| Feature | Where | Who | Sends personal data to the AI provider? |
| --- | --- | --- | --- |
| **Voicemail summary** (summary, intent, urgency, callback, spam likelihood) | Runs when Twilio posts a transcript; also `POST /v1/voicemails/:id/summary`. Shown as `ai` on `GET /v1/voicemails` and in the push text. | Plans with `vm_transcription` (Premium, Affaires) | Yes: the transcript. Needs `ai_processing` consent. |
| **Smart SMS replies** (up to 3, never sent automatically) | `GET /v1/conversations/:peer/suggestions` | Any plan with an AI budget | Yes: the last 10 messages of the thread. Needs consent. |
| **Spam labels** (« Spam probable » / “Likely spam”, calls and texts; « Fraude probable » / “Likely scam” for scams) | `spamLabel` on `GET /v1/calls` and `GET /v1/conversations/:peer/messages` | Everyone | Calls: never (local rules only). SMS: only ambiguous texts, only with consent; OTP codes never. |
| **AI receptionist** (MIMT Affaires) | DID or IVR target `{ "type": "ai_receptionist" }`; config `GET/PUT /v1/business/:id/ai-receptionist` | Affaires / Affaires Pro | Yes: the caller's speech (transcribed by Twilio). Covered by the business owner's acceptance of the receptionist terms. |
| **Budget/status** | `GET /v1/ai/status` | Everyone | No |

Labels never block anything. 9-1-1 is never affected: emergency numbers and callbacks within an hour of a 9-1-1 call are never labelled, and the receptionist never dials on its own (it only transfers to configured Canada/US targets or PBX objects, and tells callers with an emergency to hang up and dial 9-1-1).

## 2. Order of checks (every feature that sends data)

1. **`ANTHROPIC_API_KEY` set** → else **503 `not_configured`**. The rest of MIMT works without it; spam labels fall back to local rules; the receptionist falls back to the business voicemail.
2. **Law 25 consent** `ai_processing` (latest `POST /v1/consents` for that kind is a grant) → else **403 `ai_consent_required`**, and nothing is sent. Withdrawal takes effect immediately.
3. **Monthly AI budget** of the account (`AI_MONTHLY_BUDGET_CAD_CENTS`: free 0, lock 0, premium 2 $, business 10 $, business_pro 25 $) → else **429 `ai_budget_exhausted`**. Calls, SMS and voicemail keep working.

Voicemail summary also needs the `vm_transcription` feature (403 `plan_required`). A model refusal or unusable output is never shown as an AI result: suggestions come back empty with `reason`, voicemails keep their plain transcript (on-demand: 422 `ai_unavailable`).

## 3. Cost control

- Every call records token usage (`ai_usage`, per account, month, feature, model). The estimate uses `AI_PRICING_USD_PER_MTOK` in `ai.ts` and `USD_TO_CAD`. **[VERIFY]** these list prices against Anthropic's pricing page before launch.
- Receptionist limits (`AI_LIMITS`): 300 s per call, 4,000 output tokens per turn, 30,000 per call, 4 model round trips per caller utterance. At a limit the caller is offered voicemail.
- Default model: `claude-opus-5-5` (`ANTHROPIC_MODEL` overrides). Server-side fallback on refusal is enabled; prompts are cached.
- All AI work triggered by webhooks runs in the background (`AiServices.background`), so Twilio never waits on the model.

## 4. AI receptionist call flow

1. The PBX reaches `{ type: "ai_receptionist" }` → `<Redirect>` to `POST /webhooks/twilio/ai/receptionist?b=<business>&n=<number>` (signed like every Twilio webhook).
2. If AI is configured, the config is **enabled**, the owner accepted `AI_RECEPTIONIST_TERMS_VERSION`, the plan has `ai_assist` and the budget allows it, the answer is `<Connect action=…/handoff><ConversationRelay url="wss://…/ws/ai/receptionist">` with the AI disclosure **first, in French** as the welcome greeting (English offered when configured) and a per-call token (2 min, bound to business + call SID) in `<Parameter name="token">`. Otherwise: the business's general voicemail.
3. The WebSocket accepts nothing until the `setup` message carries a valid token for that call; otherwise it ends the session (voicemail) and closes. Card numbers spoken by the caller are masked before the model sees them.
4. Tools: `lookup_business_info`, `transfer_call` (only configured keys), `take_message` (stored in `ai_receptionist_messages`; owner/admins are notified with ids only), `end_call`.
5. When the session ends, Twilio posts `HandoffData` to `/webhooks/twilio/ai/receptionist/handoff`: transfer → the extension / ring group / Canada-US number of that key; anything else → voicemail; no data (caller hung up) → hang up.

Config rules: admins edit; only the **owner** accepts the terms (`accept: true`); `enabled: true` without accepted terms → 409 `terms_not_accepted`; `fr-CA` is always in `languages`; transfer numbers must be Canada/US non-premium; extensions must belong to the business.

## 5. Owner setup

- Secrets (Coolify): `ANTHROPIC_API_KEY`. Optional: `ANTHROPIC_MODEL`, `AI_RECEPTIONIST_WS_URL` (default: `PUBLIC_BASE_URL` with `wss://` + `/ws/ai/receptionist`). The reverse proxy must allow WebSocket upgrades on that path.
- Twilio: ConversationRelay must be enabled on the account (it uses Twilio's speech recognition and TTS, billed by Twilio per minute **[VERIFY]**). Accept the AI/ML features addendum in the Twilio console if asked.
- Apply `supabase/migrations/0004_ai.sql`.
- Privacy policy: name Anthropic (outside Quebec) as a processor for consented AI features; the consent screen text is in the apps.
