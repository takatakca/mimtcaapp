# MIMT: competitive parity (TextNow, Fongo, Fizz, business UCaaS)

Research date: **2026-10-10**. All sources below were accessed on 2026-10-10. Competitor wording is summarised, not copied.
Prices are as published on the source. When a page shows a bare `$`, the currency is noted as "CAD (assumed)" for Canadian companies.
MIMT prices are **CAD before taxes** (source of truth: `packages/shared/src/plans.ts`).

Legend for "MIMT today": ✅ built (code path exists end to end) · 🟡 partial (flag, types or backend only, or phase-2 work in progress on `claude/mimt-platform-phase2`) · ❌ missing.

---

## 1. Sources

| # | Source | What it supports | Reliability |
|---|---|---|---|
| T1 | https://www.textnow.com/blog/flexible-add-ons-from-textnow-explained (Feb 2025) | Lock In Number USD 1.99 / CAD 2.49 per week; Ad-Free+ USD 6.99 / CAD 8.99 per week; points redeemable for VM transcription, "See Who It Is", lock | Official, 20 months old |
| T2 | https://apps.apple.com/us/app/textnow-texting-calling-app/id314716233 | US App Store IAP list (USD): lock 1 wk 1.99, lock 1 yr 4.99, Ad Free+ 6.99 / 9.99 with trial, Plus 4.99, premium number 1 mo / 1 yr 4.99, intl credit 4.99, premium sub 2.99; feature list (second line, eSIM, MMS to US/CA, VM-to-text, conference calling, caller ID, passcode, widget, web texting) | Official |
| T3 | https://www.textnow.com/blog/textnow-new-data-plans (Aug 2025) | Free / Plus (1.99 day, 4.99 wk, 18.99 mo) / Unlimited (2.99 day, 8.99 wk, 35.99 mo) USD; free eSIM; physical SIM free with pass or 3.99; free port-in | Official, US |
| T4 | https://www.textnow.com/blog/textnow-rewards (Jan 2026) | Rewards points from calls/texts/reactions, quests, streaks, watching ads; redeem for SIM, lock, AdFree+, See Who It Is, VM transcription, app icons; points expire after 6 months | Official |
| T5 | https://help.textnow.com/hc/en-us/articles/360043012013-Call-Internationally ; https://supportfree.textnow.com/hc/en-us/articles/204920915 | Buy international credit; earn credits by videos/offers when promotions run | Official |
| T6 | https://supportfree.textnow.com/hc/en-us/articles/204253309 | Recycling: **no fixed day count**; warning before revocation; a new number unused in first 24 h expires; daily use or Ad Free+ keeps it | Official |
| T7 | https://www.textnow.com/blog/textnow-101-in-app-purchases | Premium (easy-to-remember) numbers, ~USD 4.99 / CAD 6.99 per year, chosen from area-code list | Official, older |
| T8 | https://supportfree.textnow.com/hc/en-us/articles/360020704851 | Web calling/texting over WebRTC in major browsers; Windows/Mac apps | Official |
| T9 | https://help.textnow.com/hc/en-us/articles/360042569534 | Block/unblock calls and texts (in app, web, #STOP) | Official |
| T10 | https://www.textnow.com/legal/referral-program (eff. 2024-06-15) | Invite-only referral program, rewards vary | Official |
| T11 | https://cansumer.ca/free-canadian-phone-number/ ; https://mobilesyrup.com/2020/04/14/waterloo-based-textnow-offering-free-talk-and-text-cellular-service/ | Free Canadian numbers over Wi-Fi; SIM/wireless effectively US-only (Canadians needed a US address in 2020) | Third party, dated |
| F1 | https://www.fongo.com/ | Product list: Mobile free; Home Phone 4.95/mo; Works free / Pro from 10/mo; Internet from 40/mo (ON+QC only) | Official |
| F2 | https://www.fongo.com/services/fongo-mobile/ | Free features (number choice, unlimited Canada calling, Fongo-to-Fongo + group messaging, visual VM, caller ID, call waiting, forwarding, conference, fax receive, transfer); paid add-ons list | Official |
| F3 | https://www.fongo.com/services/fongo-mobile/texting-add-ons/ | Canada Texting 2.79/5.49/9.99/17.99 (1/3/6/12 mo); Global Texting 3.99/8.49/14.99/27.99. CAD (assumed) | Official |
| F4 | https://fongo.com/services/fongo-mobile/fongo-plus | Fongo Plus 9.99/24.99/44.99/84.99 (1/3/6/12 mo): US calling+texting, CNAM change/hide, VM-to-email, 20 MB VM, sequential + simultaneous forwarding (4 numbers), fewer ads, protects number from inactivity deletion | Official |
| F5 | https://support.fongo.com/hc/en-us/articles/212435006 ; search snippets of https://www.fongo.com/services/fongo-mobile/fongo-ultimate-bundle/ | Remove Ads 2.79/3.99/6.99/11.99; Ultimate (Plus + Global Texting + no ads) 12.99/29.99/54.99/99.99 | Official |
| F6 | https://www.fongo.com/services/fongo-mobile/fongo-world-edition/ | World Edition: CAD 4.99 one-time app for users outside Canada; no 9-1-1; no port in/out | Official |
| F7 | https://www.fongo.com/services/fongo-mobile/earn-world-calling-credits/ ; https://www.fongo.com/services/fongo-mobile/convert-world-calling-credits/ ; https://support.fongo.com/hc/en-us/articles/212435886 | Earn credits (Tapjoy offers, surveys, videos); convert credits into any add-on; credits kept if one outbound call per 30 days | Official |
| F8 | https://www.fongo.com/blog/fongo-mobile-refer-friends/ | Referral: both get CAD 0.50 credits on credit purchase, or 1 free month of the add-on bought | Official, older |
| F9 | https://support.fongo.com/hc/en-us/articles/212435426 | Dormant deletion at **120 days** (ported numbers 5 years); only answered outbound calls count; credits delay deletion; recovery within 10 days | Official |
| F10 | https://www.fongo.com/services/fongo-home-phone/ ; .../premium-features/ ; https://www.fongo.com/about/frequently-asked-questions/ | Home Phone 4.95/mo yearly or 5.95 monthly; ATA 59 (promo 25); S&H 14.95 (promo 9.95); port 25 (5.95 at signup); VM, caller ID, forwarding, waiting, conference, text-to-email, fax included; FAQ: no 9-1-1 fee | Official |
| F11 | https://www.fongo.com/services/fongo-works/ ; https://support.fongo.com/hc/en-us/articles/115002318743 ; https://www.fongo.com/services/fongo-works/features/additional-phone-numbers/ ; https://fongo.com/bring-your-own-device | Works Free (auto receptionist, up to 6 ext., mobile app, VM, forward, IVR keys, MOH, conference) and Pro 10/mo per account (15+ ext., hunt groups, texting, US calling, custom greetings/schedules, custom caller ID, call logs, fax, desktop app, no ads); Pro device 5/mo; extra local number 2.50/mo; toll-free 2.50/mo + 2¢/min; HT801/GHP611 55 | Official |
| F12 | https://www.fongo.com/services/fongo-internet/ | Internet 30/5 40, 100/30 45, 50/10 DSL 50, 500/30 75; modem rental 8 (promo 5) or BYO; no contract; ON+QC | Official |
| F13 | https://www.fongo.com/wireless ; https://forum.fongo.com/viewtopic.php?p=77177 | Wireless: data-only LTE nano-SIM 300 MB/2/5/10 GB, no number on SIM (calls/texts via app), no overage (capped), 1 GB top-up 10; prices not shown publicly (student page: 9.95/19.95/34.95/59.95) | Official + partner page |
| F14 | https://forum.fongo.com/viewtopic.php?p=81737 | 1.95/mo 9-1-1 fee applies to **FreePhoneLine** VoIP unlock key users since 2024-10-01 (not Fongo) | Official forum |
| Z1 | https://www.whistleout.ca/CellPhones/Carriers/Fizz/Personal/Fizz-Unlimited-Canada-Minutes-Plan | Fizz custom plans (example ON 14/mo, QC 17/mo, no data), data up to 100 GB, rollover, gifting in 500 MB blocks, BYOD, SIM 5–15, referral (40+40, promo ended 2026-07-07), loyalty levels | Third party aggregator |
| Z2 | https://mobilesyrup.com/2025/06/16/fizz-now-supports-esims/ | Fizz eSIM since June 2025, free eSIM, online only, physical-to-eSIM swap | Press |
| Z3 | https://www.plangenius.ca/?p=22235 ; https://esim.holafly.com/reviews/fizz-esim-canada/ | Fizz eSIM no activation fee; choose last 4 digits for 1 one-time fee | Third party |
| R1 | https://betakit.com/unison-is-phase-one-of-rogers-plan-to-make-canadian-small-businesses-a-priority/ ; https://www.rogers.com/business/support/unison/applications ; https://www.rogers.com/business/phone-and-collaboration/advantage-voice | Rogers Unison: mobile-integrated UC, auto attendant, hunt groups, local numbers, VM-to-email, team VM, desktop + mobile apps, Teams plug-in; historic 15/user/mo on top of Share Everything; Advantage Voice 28.95–39.95/seat (3 yr) | Official + press, partly dated |
| B1 | https://business.bell.ca/Shop/small-business/phone/packages/total-connect ; https://business.bell.ca/web/SHOP/PDF/Bell_Total_Connect_packages.pdf | Bell Total Connect: tiers Talk/Call, Collaborate, Go, Teams Meetings; find-me/follow-me, hoteling, shared call appearance; team messaging integrations (Jira, Asana, Box, Drive, OneDrive); add-ons Virtual Phone System from 34.95, Call Dashboard from 9.95, Call Manager 19.95 + 9.95/agent | Official (page 500 at fetch, data from search snippets) |
| B2 | https://www.telus.com/en/business/small/phone/cloud-phone-plans | TELUS Business Connect: Voice Plus 25 / Enhanced 30 / Complete 35 per seat (3 yr, bundled; +5 unbundled); desktop+mobile app; auto-attendant + multi-level IVR; e-fax; on-demand (Voice Plus) / automatic (Enhanced+) recording; video 100 / 200 participants; business SMS; Salesforce + Zendesk | Official |

Not found in official sources on 2026-10-10: TextNow per-country international rates (rate shown in-app), TextNow DND and custom greeting pages, TextNow device shop and protection plans (no current official page found; treat as unconfirmed), Fongo voicemail transcription (not offered on any page), Fongo three-way calling as a named feature (covered by "conference calling"), Fongo Wireless public prices, current Rogers Unison per-user price.

### Availability and currency notes

- **TextNow** prices are **USD** unless the T1 CAD figures are quoted. The free app number works for Canadians (Canadian numbers over Wi-Fi), but **TextNow Wireless (SIM, eSIM, data passes) is US-only** in practice (T3, T11). App Store prices vary by storefront.
- **Fongo** is Canadian; prices are **CAD (assumed, `$` only)**. Fongo Internet is ON + QC only. World Edition is for users outside Canada.
- **Fizz**: CAD, available in QC, ON, AB, BC, MB. Runs on Vidéotron's (Quebecor) network.
- **Rogers / Bell / TELUS**: CAD, business only, usually 3-year terms and bundles.

---

## 2. Feature matrix

| Feature | TextNow | Fongo | Fizz / Unison / Total Connect / Business Connect | Their price | MIMT today | MIMT plan (what to build, proposed CAD) |
|---|---|---|---|---|---|---|
| Free ad-supported number + app | Yes, US and CA numbers (T2) | Fongo Mobile, Canadian numbers (F2) | n/a | Free | ✅ `free` plan, AdMob banner (`apps/mobile/src/components/Ads.tsx`), 30 out / 60 in min, 50 SMS | Keep. Consider raising free SMS to 100 once fraud data is in |
| Choose area code | Yes (T7) | Yes (F2) | Fizz: pick last 4 digits for $1 (Z3) | Free | ✅ `GET /v1/numbers/available?areaCode=` with QC default list (`apps/api/src/routes/numbers.ts`) | Add digit-pattern search ("contains 2024") |
| Premium / vanity number | Yes, diamond numbers ~USD 4.99/mo or yr, CAD 6.99/yr (T2, T7) | No | Fizz last-4 choice $1 one-time | USD 4.99 | ❌ | P2: "Numéro facile" add-on 2,99 $/mo (includes lock); score numbers by pattern at search time |
| Lock number against recycling | Lock In Number USD 1.99 / CAD 2.49 per week, 4.99/yr IAP (T1, T2) | Any paid add-on, e.g. Fongo Plus, protects number (F4); credits delay deletion (F9) | n/a | CAD 2.49/wk | ✅ `lock` plan 4,99 $/mo or 39,99 $/yr | Keep; price is clearly better than TextNow CAD 2.49/week (~10.78/mo). Allow rewards points to buy 1 week of lock |
| Inactivity rule | No fixed days; warning first; new number expires if unused 24 h (T6) | 120 days; only answered outbound calls count; recovery within 10 days (F9) | n/a | – | ✅ 30 days on free, warnings day 20 and 27, 90-day quarantine (`packages/shared/src/numbers.ts`, `apps/api/src/jobs/numberLifecycle.ts`) | Publish the exact rule (our advantage: transparency). Consider 45–60 days to beat TextNow perception; keep "inbound + outbound + SMS all count" as stated policy |
| Remove ads | Ad-Free+ USD 6.99 / CAD 8.99 per week, includes VM transcription, forwarding, media storage, lock (T1) | Remove Ads 2.79/1 mo … 11.99/12 mo (F5) | n/a | CAD 2.79–8.99 | ✅ via `premium` (19,99 $/mo) | P1: add a standalone "Sans pub" 3,99 $/mo or 29,99 $/yr so the step from free to paid is small |
| Premium bundle | Ad-Free+ (above); Plus/Unlimited data plans remove ads (T3) | Fongo Plus 9.99/mo; Ultimate 12.99/mo (F4, F5) | n/a | CAD 9.99–12.99 | ✅ `premium` 19,99 $/mo (500 min, 500 SMS, VM transcription, MMS, forwarding, AI) | Price is 50–100% above Fongo Plus; P0 decision: drop to 9,99–12,99 $/mo or add yearly 99 $ |
| Unlimited Canada calling | Free over Wi-Fi (T2, T11) | Free unlimited Canada calling (F2) | Fizz unlimited Canada minutes on plans | Free | 🟡 capped (free 30 out, premium 500 out) | P0 parity risk: free tier is far below "unlimited". Plan: fair-use "illimité" on paid tiers; free keeps a cap but show it clearly |
| Unlimited US calling | Free (T2) | Fongo Plus (F4) | Unison/Business Connect: Canada+US typical | Free / CAD 9.99 | 🟡 Canada/US share the same cap | Include US in paid tiers |
| SMS to any Canadian number | Free (T2) | Canada Texting add-on 2.79/mo (F3); Fongo-to-Fongo free | Fizz included | Free / CAD 2.79 | ✅ capped (50 free, 500 premium), fraud controls | Keep caps; add "SMS illimités" add-on 2,99 $/mo for free tier |
| International SMS | Free international texts on wireless plans (T3) | Global Texting 3.99/mo (F3) | – | CAD 3.99 | ❌ (destinations blocked) | P2 |
| MMS (photos/video) | Yes, US/CA (T2) | Picture MMS with Fongo Plus + texting (F4) | Fizz included | Free / CAD 9.99 | 🟡 API accepts `mediaUrls` (Premium only, `routes/messages.ts`); mobile picker in `app/thread/[id].tsx`; no media upload/storage endpoint | P0: signed upload URL endpoint + storage + inbound media proxy; consider MMS receive on free |
| Group messaging | Yes (T9 FAQ results) | Fongo group messaging (F2) | – | Free | ❌ (`to` is a single number) | P1: group MMS via Twilio Conversations or fan-out with shared thread id |
| GIFs / stickers / reactions | Reactions count for rewards (T4); GIFs in app | – | – | Free | ❌ | P2: GIF picker (Tenor/Giphy) sent as MMS; reactions as text fallback |
| Voicemail | Yes | Visual VM 10 MB (F2) | All business | Free | ✅ record, list, play, delete (`routes/voicemails.ts`, `app/(tabs)/voicemail.tsx`) | Keep |
| Voicemail transcription | Ad-Free+ or points (T1, T4) | Not offered | TELUS/Bell business | In bundle | ✅ Premium+ (Twilio transcribe in `twilioVoice.ts`); 🟡 AI summary/insight (`apps/api/src/ai`) | Make transcription French-accurate (Twilio's built-in is weak in fr-CA): move to Claude/STT pipeline. Sell 1-time via rewards |
| Custom voicemail greeting | Third-party listings only | Disable VM, 20 MB with Plus (F4) | Works Pro custom greetings (F11) | – | 🟡 business extension greeting type only (`packages/shared/src/business.ts`) | P1: record/upload greeting endpoint + mobile screen, all plans |
| Voicemail to email | No | Fongo Plus; Home Phone included (F4, F10) | Unison, Total Connect | CAD 9.99 / incl. | ❌ | P1: email with MP3 + transcript via outbox (`services/outbox.ts`) |
| Call forwarding | Ad-Free+ (T1) | Free to 1 number; Plus: sequential/simultaneous up to 4 (F4) | All business | Free / CAD 9.99 | 🟡 `call_forwarding` flag in plans; PBX `forwardToMobile` for extensions; no consumer forwarding rule in inbound TwiML | P0: forwarding rule on `/v1/me` + inbound TwiML `<Dial>` to target, minutes billed |
| Caller ID (outbound number) | Yes (T2) | Yes; Plus can change/hide CNAM name (F4) | Works Pro custom caller ID (F11) | Free / CAD 9.99 | ✅ calls present the user's number (`twilioVoice.ts`) | P2: CNAM name registration (business) |
| Unknown-caller lookup / spam | "See Who It Is" via points (T1, T4) | – | – | Points | 🟡 AI `SpamVerdict` types (`apps/api/src/ai`) | P1: spam label on inbound calls/SMS for all; CNAM lookup as premium |
| Call blocking | Yes, app, web, #STOP (T9) | Not documented | Business: yes | Free | ❌ (only fraud blocking of the sender) | P0: user block list (API + mobile + webphone), applied in inbound voice/SMS webhooks; legally expected for harassment cases |
| Do not disturb / schedules | Third-party listings only | – | Works Pro greeting schedules (F11); business hours | Free | 🟡 business hours types only | P1: DND toggle + quiet hours for consumers, send to VM |
| Call waiting / hold / transfer | Yes | Free (F2) | All business | Free | 🟡 one concurrent call on free; transfer only in PBX types | P1 |
| Conference / 3-way calling | Conference calling (T2) | Free conference calling (F2, F10) | All business | Free | ❌ | P1: Twilio `<Conference>` with merge button |
| Fax | No | Receive fax free (F2); Home Phone fax (F10); Works Pro fax (F11) | TELUS e-fax (B2) | Free / Pro | ❌ | P2: inbound fax-to-email for business only |
| Web app / desktop | Web (WebRTC) + Windows/Mac apps (T8) | Desktop app (F2 links), Works desktop app Pro (F11) | All business: desktop apps | Free | 🟡 `apps/webphone` (Vite, auth + API client; phone UI in progress on phase-2 branch) | P0: finish webphone calls + SMS + VM; package as PWA rather than native desktop |
| Multi-device same number | Yes (T8) | Yes | Business yes | Free | 🟡 Twilio client identity per user; webphone pending | Ring all registered devices |
| Wi-Fi + cellular hybrid calling | Via TextNow Wireless SIM (US) (T3) | Fongo Wireless data SIM + app (F13) | Fizz native | Plan price | ❌ (Wi-Fi/data only) | Needs Vidéotron (section 4) |
| Second line | Marketed as a second line (T2) | Additional numbers on Works 2.50/mo (F11) | – | Free / CAD 2.50 | ✅ add-on `extra_number` 4,99 $/mo (`ADD_ONS`) | Lower to 2,99 $/mo to match Fongo Works; multi-number UI switch in app |
| Number transfer (port-in) | Free port-in to wireless (T3) | Home Phone 25 (5.95 at signup) (F10); not on World Edition (F6) | Fizz free port | Free – CAD 25 | 🟡 provider types mention mobile port-in (`apps/api/src/catalog/providers/types.ts`); no VoIP port-in flow | P0 for business, P1 for consumer: port-in request form + LOA + Twilio Porting API; fee 0 $ with yearly plan, else 14,99 $ |
| International calling credits | Buy credit; earn via videos/offers (T2, T5) | World Calling Credits, earnable (F7) | – | USD 4.99 packs | ✅ prepaid credit min 5 $ via `/v1/billing/checkout` (paid plans only), destination controls (`fraud/destinations.ts`) | P1: allow credit purchase on free plan with stricter fraud limits; show per-country rate before dialing |
| Earn credits: rewarded ads / offer wall | Rewards points, quests, streaks, ads (T4) | Tapjoy offers, surveys, videos (F7) | Fizz loyalty levels (Z1) | Free | 🟡 `/v1/rewards/claim` returns 501; AdMob SSV TODO (`routes/rewards.ts`) | P1: AdMob SSV webhook → bonus minutes; later points ledger redeemable for lock week, no-ads week, transcription |
| Referral program | Invite-only, variable rewards (T10) | 0.50 credits or 1 free month (F8) | Fizz 40 + 40 (promo ended 2026-07-07) (Z1) | – | ❌ | P1: referral code; both get 1 free month of Premium after referee's first paid month |
| Passcode / app lock | Yes (T2) | – | – | Free | ❌ | P2: biometric lock (expo-local-authentication) |
| Widgets, custom tones | Yes (T2) | – | – | Free | ❌ | P2 |
| 9-1-1 | Wireless only in US | Fongo Mobile/Home in Canada, no fee (F10); none on World Edition (F6) | All carriers | Fongo 0; FreePhoneLine 1.95/mo (F14) | ✅ address capture, notice, acknowledgement, routing (`routes/e911.ts`, `twilioVoice.ts`) | Keep; Quebec municipal 9-1-1 tax on the bill (already in plan comments) |
| Home phone (ATA) | No | 4.95–5.95/mo + ATA 59 (promo 25) + S&H (F10) | Bell/Rogers home phone | CAD 4.95+ | 🟡 `home_phone` product line in `catalog.ts`, no device flow | P2: "Ligne maison" 6,99 $/mo + Grandstream HT801 at cost (~55 $), SIP credentials per account |
| Free business phone (ads) | No | Fongo Works Free, 6 ext., auto receptionist (F11) | – | Free | ❌ (business plans start at 34,99 $/line) | P1 decision: "Affaires Essentiel" free or 9,99 $/account with ads, 1 number, auto-attendant |
| Business PBX: extensions, auto-attendant/IVR, ring/hunt groups, hours | – | Works Pro 10/mo per account, 15+ ext. (F11) | TELUS 25–35/seat, Bell add-ons 34.95+, Rogers historic 15/user | CAD 10/account to 35/seat | 🟡 types + migration `0003_business_pbx.sql` + repo (`pbxPostgres.ts`); routes and admin UI in progress (phase 2) | P0 for business launch: finish routes + webphone admin pages. Re-price: 34,99 $/line is far above Fongo (10 $/account) and near TELUS (25–35 $/seat with video). Proposal: 14,99 $/account + 7,99 $/extra user |
| Desk phones / devices | Device shop: unconfirmed | Pro device 5/mo; HT801/GHP611 55 (F11) | All business | CAD 5/mo + hardware | ❌ | P2: SIP device provisioning (Twilio SIP Domain), 4,99 $/device/mo |
| Toll-free number | – | 2.50/mo + 2¢/min (F11) | All business | CAD 2.50 + usage | ❌ | P2: 4,99 $/mo + 3¢/min |
| Call recording | – | Not listed | TELUS on-demand (Voice Plus) / automatic (Enhanced) (B2) | In seat price | 🟡 `CallRecordingPolicy` types with consent prompt (`business.ts`), `business_pro` flag | P1: recording with bilingual consent message (Quebec Law 25), retention settings |
| Video meetings | – | – | TELUS 100–200 participants (B2); Bell Teams Meetings tier (B1) | In seat / add-on | 🟡 code ready (2026-10-16, owner decision to build): Réunions MIMT on LiveKit, Premium 4 / Affaires 25 / Affaires Pro 100 participants, 4 h, guest links, waiting room, screen share, chat (`routes/meetings.ts`, `docs/MIMT-VIDEO.md`) | Owner: deploy LiveKit (`rtc.mimt.ca`), set `LIVEKIT_*`, apply 0010 (VID-01) |
| Team messaging | – | – | Bell team messaging (B1); Unison | In seat | ❌ | Out of scope for launch |
| CRM integrations | – | – | TELUS Complete: Salesforce, Zendesk (B2); Bell: Jira, Asana, Box, Drive (B1); Unison: Outlook contacts, Teams (R1) | In seat | ❌ | P2: webhook + Zapier-style events first; HubSpot later |
| Call logs / analytics | Call history | Works Pro call logs (F11) | Bell Call Dashboard 9.95+ (B1) | – | ✅ call history `/v1/calls`; ❌ business analytics | P2 dashboard |
| AI receptionist / smart replies | – | – | – | – | 🟡 `apps/api/src/ai` (Claude gateway, prompts, store) on phase-2 branch | Differentiator; ship after core parity |
| Mobile wireless plan (SIM) | US only: Free (essential data), Plus 18.99, Unlimited 35.99/mo USD (T3) | Fongo Wireless data-only SIM, 300 MB–10 GB (F13) | Fizz custom plans from ~14–17/mo, up to 100 GB (Z1) | CAD ~14–60 | 🟡 `mobile` product line + provider adapter (`catalog/providers`, sandbox) | Needs Vidéotron (section 4) |
| eSIM | Free (T3) | Not mentioned | Fizz free eSIM (Z2) | Free | ❌ | Needs Vidéotron |
| Data passes / gifting / rollover | Day/week/month passes (T3) | 1 GB top-up 10 (F13) | Fizz rollover + gifting 500 MB (Z1) | – | ❌ | Needs Vidéotron |
| Home internet | – | 40–75/mo, ON+QC (F12) | Fizz home internet (Vidéotron) | CAD 40–75 | 🟡 `internet_residential` line in `catalog.ts` | Needs Vidéotron wholesale / TPIA |
| Device shop, protection plans | Unconfirmed in official sources | HT801 etc. (F11) | Fizz phones (Z1) | – | ❌ | P2, only with wireless |

---

## 3. Prioritised gap list

### P0: launch-critical parity

1. **Pricing reset for Premium and Business.** Our 19,99 $ Premium is about twice Fongo Plus (9.99) and our 34,99 $/line Business is 3.5× Fongo Works Pro (10 $/account). *Implementation:* change `PLANS` in `packages/shared/src/plans.ts` (proposal: Premium 9,99 $/mo or 99 $/yr; Business 14,99 $/account + 7,99 $/extra user; Business Pro 24,99 $/account), add `yearlyPriceCents` everywhere, update Stripe prices and the `forfaits` / `affaires` pages in `apps/web`. Owner decision.
2. **Call blocking.** *API:* `blocked_numbers` table, `GET/POST/DELETE /v1/blocks`; check in `twilioVoice.ts` inbound (reject or send to VM) and `twilioSms.ts` inbound (drop, don't notify). *Mobile:* "Bloquer" in thread and call log menus, list in settings. *Webphone:* same list.
3. **Consumer call forwarding.** Flag exists, behaviour does not. *API:* `forwarding` field on `PATCH /v1/me` (target E.164, mode always/no-answer), inbound TwiML dials the target with the user's number as caller ID, counts inbound+outbound minutes. *Mobile/webphone:* settings screen.
4. **MMS end to end.** *API:* `POST /v1/media/uploads` returning a signed Supabase Storage URL; proxy inbound Twilio media to our storage (Twilio media URLs need auth), size/type limits, retention. *Mobile:* image picker exists in `thread/[id].tsx`, wire to upload. Decide whether free users can *receive* MMS (TextNow allows; recommended).
5. **Webphone finished (calls, SMS, voicemail) for web/desktop parity.** TextNow and every UCaaS player have it. *Webphone:* Twilio Voice JS SDK using `/v1/voice/token`, conversations and VM views reusing the API; installable PWA.
6. **Business PBX routes + admin UI** (for the business launch): extensions, IVR, ring groups, hours, per-extension VM using the existing types and `0003_business_pbx.sql`. *API:* CRUD routes + inbound routing engine. *Webphone:* `pages/business` admin.
7. **Number port-in (business first).** *API:* port request model, LOA PDF + e-signature, Twilio Porting API, status webhooks; keep temporary number until FOC date. *Web:* port form. Fee proposal 0 $ on yearly plans, else 14,99 $. *Done (2026-10-10):* `/v1/port-ins`, migration `0009_port_in.sql`, bilingual LOA (printable HTML) with typed-name e-signature, `/webhooks/twilio/porting`, webphone page `/services/transfert`. Fee is `PORT_IN_FEE_CENTS`, 0 until the owner approves one.
8. **Clear "unlimited Canada" story on paid tiers.** Both TextNow and Fongo advertise unlimited Canada calling for free. Keep the free cap (fraud), but make paid tiers fair-use unlimited Canada+US and say so on the plans page. *Shared:* add `fairUse: true` caps; *API:* soft cap alerts instead of hard stop.

### P1: needed soon after launch

1. **Standalone "Sans pub" add-on** 3,99 $/mo or 29,99 $/yr (Fongo 2.79, TextNow CAD 8.99/week). Plans + Stripe + IAP SKU; `adsEnabledFor` reads the add-on.
2. **Rewarded ads and earn credits.** AdMob SSV webhook (`/webhooks/admob/ssv`, ECDSA check, `useOnce` on transaction id) crediting bonus minutes; later a points ledger redeemable for 1 week lock, 1 week no ads, 1 transcription (TextNow and Fongo both let earned credits buy add-ons).
3. **Referral program.** `referral_codes` + `referrals` tables, `/v1/referrals`, reward = 1 free month of Premium for both after first paid month; anti-fraud (same device/payment).
4. **Custom voicemail greeting + voicemail to email** for all paid plans. Greeting upload/record endpoint, store in Storage, play in inbound `<Play>`; email via outbox with MP3 + transcript.
5. **Group messaging.** Twilio Conversations group MMS or fan-out with a shared thread id; mobile multi-recipient composer.
6. **Conference / 3-way calling, call waiting, hold, transfer.** Twilio `<Conference>`; raise free `concurrentCalls` handling for call waiting.
7. **Do not disturb / quiet hours** for consumers (send to VM), reusing `BusinessHours` shapes.
8. **Spam labelling and unknown-caller lookup** (AI `SpamVerdict` + optional CNAM lookup as a Premium feature, like TextNow "See Who It Is").
9. **International credit on the free plan** with stricter limits (TextNow and Fongo both allow), plus rate shown before dialling.
10. **Call recording with consent** for Business Pro (types exist), retention and download.
11. **Free/cheap business entry tier** to answer Fongo Works Free (auto receptionist, a few extensions, with ads or at 9,99 $).
12. **Lower extra number price** to 2,99 $/mo (Fongo Works 2.50) and a number switcher in the app.
13. **French-quality transcription** via an STT provider tuned for fr-CA instead of Twilio's built-in transcription.

### P2: nice to have / differentiators

- Easy-to-remember numbers (2,99 $/mo, includes lock), digit-pattern search.
- International SMS add-on; GIFs/stickers; reactions; passcode/biometric lock; widgets and custom tones.
- Fax-to-email (business), toll-free numbers (4,99 $/mo + usage), SIP desk phones and ATA "Ligne maison" (6,99 $/mo, HT801 at cost), CNAM registration.
- Business analytics dashboard, CRM webhooks/integrations, Teams/Meet links for video (superseded 2026-10-16: video is built on LiveKit, see docs/MIMT-VIDEO.md).
- AI receptionist and smart replies (phase-2 code) as the paid differentiator once parity is done.

---

## 4. Vidéotron-dependent vs pure software

**Needs the Vidéotron agreement (MVNO/wholesale or reseller):**

| Feature | Why | Competitor reference |
|---|---|---|
| Physical SIM and eSIM ordering, activation, swap | Needs IMSI/ICCID inventory, HLR/HSS provisioning, eSIM SM-DP+ profiles | Fizz free eSIM (Z2), TextNow free eSIM US (T3) |
| Mobile voice/text/data plans, data passes, top-ups, rollover, gifting | Rating and usage from the network | Fizz (Z1), TextNow passes (T3), Fongo 1 GB top-up (F13) |
| Wi-Fi + cellular hybrid with the same number (native dialer) | Number must live on the mobile core, or a data-only SIM + our app (Fongo model) | Fongo Wireless (F13), TextNow Wireless (T3) |
| Mobile number port-in/port-out to the SIM | Wireless number portability through the host carrier | Fizz, TextNow |
| Device shop, financing, protection plans | Only makes sense with wireless | Fizz phones (Z1) |
| Home internet | Vidéotron wholesale (or TPIA) | Fongo Internet (F12) |
| Wireless Code obligations (CRTC) | Contract summary, unlock, bill-shock caps | `consumerCodeFor("mobile")` in `catalog.ts` |

The catalog (`packages/shared/src/catalog.ts`) and provider adapter (`apps/api/src/catalog/providers`, sandbox only) already model these; the real adapter needs the agreement and Vidéotron's API spec.

**Pure software (Twilio + our code, no Vidéotron needed):** everything else in the matrix: blocking, forwarding, MMS, group messaging, voicemail greeting/email/transcription, conference, DND, webphone, ads/rewards/referrals, international credit, extra and easy numbers, VoIP port-in (Twilio), PBX features, recording, fax, toll-free, SIP devices and ATA home phone, AI features. A low-risk interim option that copies Fongo: keep MIMT numbers on Twilio and later sell a **data-only** Vidéotron SIM that runs the MIMT app, which avoids moving numbers into the mobile core.

## Owner decision (2026-10-10)

- **Prices:** keep the cost-based prices from `packages/shared/src/plans.ts`: Premium 19,99 $ (500 min + 500 SMS), Affaires 34,99 $ per line, Affaires Pro 44,99 $. Lower them once wholesale costs drop (cheaper carrier or the Vidéotron agreement).
- **Free tier:** stays capped at 30 outbound min/month, with minutes earned through rewarded ads. No unlimited calling on free. Inbound calls and app-to-app calls are free.
- P0 item 1 (price reset) and P0 item 8 (unlimited calling) are therefore **declined for now**. Every other gap goes ahead.
