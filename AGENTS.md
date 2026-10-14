# Agent instructions (MIMTCA)

## Work log rule (every agent: Claude, Codex, Cursor, people)

1. **Before you start:** read the top of `WORKLOG.md` and the titles of open pull requests. If the same work is `active` or has an open PR, continue it or pick other work.
2. **Claim it:** add one line at the top of the log with status `active`.
3. **Before you stop:** update your line (`done`, `PR #n`, `blocked: reason`) and the next step. Commit and push it with your work.
4. One line per piece of work, newest first.

Line format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`

## Canonical project handoff (mandatory)

Before any work, read `docs/AGENT_HANDOFF.md`, `docs/PROJECT_STATUS.md`, `docs/TASK_QUEUE.md`, `docs/DEPLOYMENT.md` and `docs/DECISIONS.md` after `AGENTS.md` and `WORKLOG.md`; verify the current GitHub `main` head and actual Actions state. These documents are handoff aids, not substitutes for live evidence.

After each meaningful change, keep the task queue, release evidence, active work-log line and handoff in sync. The handoff records: task completed, active/next task, files, most recent verified pushed commit, commands/checks, errors, actual deployment, required access names without values, and the precise next action.

Do not claim telecom readiness from an API healthcheck or static website publication. The marketing site can auto-deploy after CI, but phone/SMS/billing and emergency-call services remain gated by the owner, regulatory review and service-level tests. Never publish an older CI revision over the current main release.

## Scope

MIMT owns telecom: accounts, numbers, voice, SMS/MMS, voicemail, telecom billing and Twilio. TAKATAK owns identity and activation. Do not edit TAKATAK repositories from here. Coordinate TAKATAK-side changes (for example the dashboard's MIMT client) with the TAKATAK agent.

## Rules

- Follow `docs/BRAND.md`: electric blue on deep navy. Green is for status only.
- French first in all user-facing text.
- 9-1-1 is never blocked. Tests in `apps/api` enforce this; never weaken them.
- No secrets in code, logs, chat or URLs.
- Never skip or disable a test to get CI green.
