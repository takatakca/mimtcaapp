# Pilote MIMT: the AI command bar

Prepared: **2026-10-28** by the MIMT agent (pilote). Owner request: « L'IA doit prendre le contrôle, exécuter des commandes, montrer le système. »

Contract: `packages/shared/src/pilot.ts` (types, tool list, local parser). Server: `apps/api/src/routes/aiPilot.ts`, `apps/api/src/ai/pilot/{tools,plan,execute}.ts`, `ClaudeGateway.planCommand` in `apps/api/src/ai/claude.ts`. Web app: `apps/webphone/src/pilot/*` (bar, paths, dictation), `src/styles/pilot.css`, demo mode `src/api/mock.pilot.ts`. Migration: `supabase/migrations/0020_ai_pilot.sql` (adds `pilot_command` to the `ai_usage` feature list). Tests: `packages/shared/src/pilot.test.ts`, `apps/api/test/aiPilot.test.ts`, `apps/webphone/src/pilot/PilotBar.test.tsx`.

Companion docs: [MIMT-AI.md](MIMT-AI.md) (consent, budgets, gateway).

## 1. What the user sees

On every signed-in page of app.mimt.ca:

- **Open**: Ctrl+K (⌘K on a Mac), the « / » key when the cursor is not in a text field, or the glowing button next to the phone button. Esc closes.
- **Say it**: type, or press the microphone and speak (Web Speech API in Chrome, Edge and Safari; French (Canada) by default, English when the app is in English). The browser's speech service turns the audio into text; MIMT receives only the text.
- **Watch it**: a console prints each system step as it happens:
  - « ◢ Commande reçue : … »
  - « ◢ Mode local : … » or « ◢ Moteur : Claude (IA) »
  - « ◢ Compréhension : renvoyer les appels vers 514 555-0123 »
  - « ◢ Vérification : forfait Premium ✓ »
  - « ◢ Action proposée : activer le renvoi vers 514 555-0123 »
- **Confirm**: anything that changes the account shows a confirmation card (what will change, countdown). Nothing changes before « Confirmer ». « Annuler » discards the plan.
- **Result**: the console shows « Résultat : … », the app navigates to the page concerned (the page reloads its data) and the changed element pulses briefly (cyan outline). Read-only requests run immediately and navigate.

## 2. Commands

Each command maps to one whitelisted tool. "Local" = understood by the deterministic French/English parser (works without the API key); Claude understands free phrasing of all of them.

| Tool | Examples (local parser) | Confirmation | Runs through |
| --- | --- | --- | --- |
| `navigate` | « va dans mes paramètres d'appel », « réunions », “open help” | no | client navigation |
| `search_calls` | « montre-moi mes appels manqués », “show my missed calls”, « mes appels reçus » | no | `GET /v1/calls` → `/appels?filtre=missed` |
| `open_voicemail` | « ouvre le message vocal de Julie », « ouvre la messagerie » | no | `GET /v1/voicemails` (a name is searched in transcripts/summaries, locally) |
| `open_conversation` | « ouvre la conversation avec @julie » / « … avec 514 555-0123 » | no | client navigation |
| `usage_summary` | « combien de minutes il me reste? », “how many minutes do I have left” | no | `GET /v1/me` |
| `missions_status` | « où en sont mes missions » | no | `GET /v1/missions` |
| `send_text` | « écris au 514 555-0123 : j'arrive », “text 514 555 0123 saying I'm late” | **yes** | `POST /v1/messages` |
| `call_number` | « appelle le 418 555-0100 » | **yes** | the browser dials (Twilio Voice SDK); the server never places the call |
| `set_forwarding` | « renvoie mes appels vers 514 555-0123 (si je ne réponds pas) », « désactive le renvoi » | **yes** | `PATCH /v1/me` (forwarding) |
| `set_dnd` | « active / désactive ne pas déranger » | **yes** | `PATCH /v1/me` (dnd) |
| `set_voicemail_greeting` | « remets mon message d'accueil par défaut », « enregistrer un nouveau message d'accueil » | **yes** | `DELETE /v1/voicemail/greeting` or `POST /v1/voicemail/greeting/call` (MIMT calls the app to record) |
| `block_number` / `unblock_number` | « bloque le 514 555-0177 », « débloque … » | **yes** | `POST /v1/blocks`, `DELETE /v1/blocks?number=` |
| `set_handle` | « choisis l'identifiant @marie.lune » | **yes** | `PUT /v1/me/handle` |
| `start_meeting` | « démarre une réunion sur le budget » | **yes** | `POST /v1/meetings` |
| `set_business_hours` (owner only) | « heures d'ouverture de 9 h à 17 h du lundi au vendredi », “business hours 9am to 5pm weekdays” | **yes** | `GET` + `PUT /v1/business/:id/hours` (other days, holidays and targets kept) |
| `set_business_greeting` (owner only) | « change l'accueil de l'entreprise : Bienvenue chez Comète » | **yes** | `PUT /v1/business/:id/ai-receptionist` (`greeting`, said after the AI disclosure) |

Not built (no existing route or service): setting a personal greeting from dictated text (a greeting is an audio file; the Pilote offers « record by phone » or « default »), searching calls by contact name (MIMT stores numbers, not contact names), business IVR greeting text (the Pilote sets the AI receptionist greeting instead).

## 3. Safety model

1. **Never-list, before any model call.** Payments, refunds, plan changes, account deletion, 9-1-1 / emergency addresses, calls to 9-1-1 and other users' data are refused by the local parser with a short explanation of where to do it by hand. They are not tools, so the model cannot propose them either.
2. **The model only proposes.** Claude receives the command text (as data inside `<command>`) and non-personal context (plan name, page, "has a number", "owns a business"). It returns tool calls; nothing runs inside the model call. Message and voicemail content is never sent to the model, so content in a text or voicemail cannot instruct it (prompt-injection safety).
3. **Whitelist and strict schemas.** Every proposal, from Claude or the parser, goes through the same gate (`ai/pilot/plan.ts`): known tool, strict zod arguments (unknown fields refused), then permission checks: plan features (`call_forwarding`, `vm_greeting`, `video_meetings`), owner role for business tools, 9-1-1 never blocked or dialled, handle rules, forwarding destination rules (same `checkForwardTarget` as the settings page). At most 4 actions per command.
4. **Confirmation with a short TTL.** Read-only tools run at once. Mutating tools are stored as a plan (id, user, normalized arguments) for **120 s** (`PILOT_PLAN_TTL_S`), **single use**, **bound to the user** (another user's id reads as unknown), one pending plan per user (a new command replaces it). `POST /v1/ai/command/confirm` re-loads the user's context and **re-validates** each action (a plan lost in between, a role change… make it fail with `revalidation_failed`), then runs it.
5. **Existing routes do the work.** Confirmed actions run through the same API routes as the app's own buttons (in-process `inject` with the user's own bearer token), so every route keeps its own checks (plan, role, fraud and quota rules, SMS rules) and its own audit entry. The Pilote can never do more than the user could do by hand. Execution stops at the first failure.
6. **Audit without content.** `ai.pilot_command` (per command: engine, tool names, counts, refusal kind) and `ai.pilot_executed` (per action: plan id, tool, ok, error code). Never the command text, message bodies or phone numbers.
7. **Rate limits.** 30 commands per minute per IP (route), 40 per 10 minutes per user (`PILOT_RULE`). Commands are limited to 500 characters.

Known limit: pending plans live in the API process memory. MIMT runs one API instance; with several, use sticky sessions or move plans to Postgres/Redis.

## 4. Consent and costs

- **Claude is used only when all of these hold**: `AI_COMMANDS=on`, `ANTHROPIC_API_KEY` set, the user's latest `ai_processing` consent is a grant (Law 25), and the account's monthly AI budget is not used up (`AI_MONTHLY_BUDGET_CAD_CENTS`: free 0, lock 0, premium 2 $, business 10 $, business_pro 25 $). Otherwise the local parser plans the command and the console says why (« Mode local : consentement IA non donné », « … budget IA du mois atteint »…). The bar therefore works for every plan, including Gratuit, at no AI cost.
- If Claude proposes nothing (refusal, unclear request), the local parser is tried.
- Usage is recorded in `ai_usage` under `pilot_command` (migration 0020). One command is one short call (effort "low", 1,500 output tokens max, cached system prompt and tools): typically a few hundred input tokens and well under a cent.

## 5. Switches and setup

| Variable | Values | Effect |
| --- | --- | --- |
| `AI_COMMANDS` | `on` (default) | Claude when configured + consent + budget; local parser otherwise |
| | `rules` | local parser only, never Claude (zero AI cost) |
| | `off` | `POST /v1/ai/command` and `/confirm` answer 503 `pilot_disabled`; the bar shows « Le Pilote MIMT est désactivé » |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | see MIMT-AI.md | shared with the other AI features |

Apply `supabase/migrations/0020_ai_pilot.sql` before enabling Claude for the Pilote (without it, recording `pilot_command` usage fails the Postgres check constraint).

## 6. API

- `POST /v1/ai/command` `{ text, page? }` → `{ planId, expiresAt, source: "ai" | "rules", understood, steps[], pending[], navigate }`. Errors: 400, 401, 429 `rate_limited`, 503 `pilot_disabled`.
- `POST /v1/ai/command/confirm` `{ planId }` → `{ steps[], results[{ tool, ok, code? }], navigate, clientAction }` (`clientAction: { type: "dial", number }` for calls). Errors: 404 `plan_not_found` (unknown, used or someone else's), 410 `plan_expired`.
- `POST /v1/ai/command/cancel` `{ planId }` → 204.

`navigate` = `{ page, param?, query?, highlight? }`; the web app maps pages to its French URLs (`pilot/paths.ts`) and highlights `[data-pilot=…]` or a known section (forwarding, do not disturb, blocks, greeting, usage, handle).
