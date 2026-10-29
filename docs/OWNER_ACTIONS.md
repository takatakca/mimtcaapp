# Owner actions — mimt.ca · app.mimt.ca · api.mimt.ca

Updated 2026-10-29. Hands-on checklist for the hosting move (MochaHost → Coolify). The main file for all sites is in Google Drive › 00 — Opérations TAKATAK: “2026-10-29 — TAKATAK hosting (MochaHost → Coolify) — MAIN FILE — OWNER and CLAUDE actions”. Item numbers are the same everywhere. This repository is public: no secret values and no hosting-account details are written here, only key names, settings and steps; account-level steps are in the private Drive main file.

**Labels**

- 🔧 OWNER — you do it by hand (accounts, keys, payments, approvals, merges, WHM)
- 🤖 CLAUDE — the agent does it; usually waits for an OWNER item
- ✅ DONE — finished and verified

## Where this site runs

- mimt.ca, www and app.mimt.ca — Coolify vps1 (apps `mimt-web`, `mimt-app`), auto-deploy from `main`; the website workflow confirms the live commit via /mimt-release.json
- api.mimt.ca — Coolify vps1, auto-deploy **off** on purpose (O-14 / C-11)
- DNS zone mimt.ca is in the main MochaHost account; mail stays at MochaHost

## 🔧 OWNER — manual work

### O-01 · 🔧 OWNER · ⬜ TO DO — Merge the open pull requests
- ocarinaspa #3 (removes Lovable; it also contains #2, so #2 closes by itself)
- The notes/fix PRs opened on 2026-10-29: revers-canada-hope (header fix + notes), droneair (revision + health check + notes), mimtcaapp (notes), r2neet (notes)
- mimtcaapp #77 (from another agent: removes the old FTP uploads from the Deploy workflow)

### O-13 · 🔧 OWNER · ⬜ TO DO — Retire the old MochaHost account of this domain
- Only after this site works on Coolify; first download that account's backup
- The exact account, backup file and WHM steps are in the private Drive main file (item O-13)
- *Waits on:* each site working (O-02…O-11)

### O-14 · 🔧 OWNER · ⬜ TO DO — api.mimt.ca: approve publishing and give a valid Resend key
- The API's auto-deploy is off on purpose; say “publish the API” when ready (C-11)
- Enter a valid Resend key as EMAIL_API_KEY in the MIMT API app in Coolify

### O-15 · 🔧 OWNER · ⬜ TO DO — Plan the Next.js 16.4.0 security upgrade
- The build printed a security notice for Next.js 16.4.0

## 🤖 CLAUDE — agent work

### C-08 · 🤖 CLAUDE · ⏳ WAITING — Test each site end to end after its keys are in
- Restart/redeploy, then forms, emails, Stripe test payment, /readyz; update the GitHub notes and this main file
- *Waits on:* O-02…O-11

### C-10 · 🤖 CLAUDE · ⏳ WAITING — After the old account is retired, check that DNS and mail are served by the main MochaHost account
- Compare the served zone with the prepared copy, re-save it if needed, then check the website and mail
- *Waits on:* O-13

### C-11 · 🤖 CLAUDE · ⏳ WAITING — Deploy and verify the API
- *Waits on:* O-14

### C-12 · 🤖 CLAUDE · 🔁 ONGOING — Keep the notes current
- docs/OWNER_ACTIONS.md in each repo and this main file

When you finish an OWNER item, tell the agent its number (for example “O-02 done”); the agent then does the CLAUDE items waiting on it and updates this file.
