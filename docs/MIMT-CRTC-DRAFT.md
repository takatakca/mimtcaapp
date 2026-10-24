# MIMT CRTC filing draft — private facts and counsel review required

Prepared 2026-10-24. **Unsent draft.** Bracketed fields are unresolved. Do not submit this template or assert that
service is compliant merely because code or health checks exist. Store contracts, contacts and completed filings
privately; this repository is public.

Official instructions checked:
- [Local VoIP 9-1-1 obligations and attachments](https://crtc.gc.ca/eng/phone/911/VoIP.htm)
- [Telecommunications provider registration](https://crtc.gc.ca/eng/comm/telecom/registr4.htm)

## Proposed cover letter for counsel

[DATE]

To the Secretary General, Canadian Radio-television and Telecommunications Commission

Re: [LEGAL ENTITY TRADING AS MIMT] — proposed local VoIP service, registration and 9-1-1 customer notices;
CRTC file 8663-C12-201015470

[Before filing, replace the subject above with the exact subject required on the official VoIP instructions page,
using the confirmed legal company name.]

We write on behalf of [LEGAL ENTITY], operating under the MIMT brand, regarding [PROPOSED SERVICE AND TERRITORY].
The organization's registration status is [NEW / EXISTING REGISTRATION DETAILS]. Its response manager is
[AUTHORIZED NAME, TITLE AND PRIVATE CONTACT DETAILS].

Attachment 1 sets out our service model, provider arrangements and evidence for each applicable 9-1-1 and
registration requirement. Where implementation is incomplete, it identifies the remaining work and proposed dates.
Attachment 2 contains the proposed customer notices and related materials for review.

We request consideration of the attached materials and guidance on any further information needed. No statement
in this draft represents a certification of unverified service or an existing approval.

[AUTHORIZED SIGNATORY AND TITLE]

## Attachment 1 — evidence to complete before counsel signs

| Item | Required private evidence / unresolved fact |
| --- | --- |
| Organization | Legal name, registration number/jurisdiction, structure, business and response-manager contacts |
| Service | Proposed services/areas, facilities ownership, registration category/status and international-service licensing status |
| Emergency delivery | Answering/routing provider, every intermediary, contracts or attestations, provider contacts; verified status or implementation timetable |
| Network | Number/network supplier and contacts; active-line counts and fixed/nomadic breakdown if already operating |
| Customer process | Express-consent method, notice version/evidence, and online address updates |
| Existing obligations | Applicable registration/licence filings and their current status |

Do not infer the emergency answering bureau from the Twilio brand or from `twilio:true` in `/readyz`. Obtain the
actual provider chain and contractual evidence. Counsel must reconcile the proposed service description with that evidence.

## Attachment 2 — proposed notice package

Supply the French and English draft in `apps/api/src/e911/notice.ts`, proposed liability wording, website mockups
and links, and warning-label wording. Show signup/activation, marketing and terms placement. Counsel must approve
the complete package and identify any changes before publication; bump `E911_NOTICE_VERSION` when wording changes.

## Completion and submission

Counsel reviews unresolved facts and the final text. The authorized representative submits through My CRTC Account
using the Telecom Cover Page. Save the exact submitted versions, attachments, legal approval and receipt privately.
Track the Commission's response and implement any required changes. This draft has not been sent to counsel or the CRTC.
