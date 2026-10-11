import {
  aggregatePortInStatus,
  generateLoaText,
  loaCanonicalText,
  PORT_IN_OPEN_NUMBER_STATUSES,
  QUARANTINE_DAYS,
  type NumberPortIn,
  type PortInNumberStatus,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { mapTwilioNumberStatus, type PortInSnapshot } from "../gateways/twilioPorting.js";
import { sha256Hex } from "../lib/crypto.js";
import { addDays } from "../lib/time.js";
import type { PortInRow, PortInWithNumbers } from "../repo/portIn.js";

// Number port-in: LOA, submission to Twilio, status updates and the routing switch on completion.
// Routes: src/routes/portIns.ts. Contract: packages/shared/src/portIn.ts.

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

const isOpen = (s: PortInNumberStatus) => (PORT_IN_OPEN_NUMBER_STATUSES as readonly string[]).includes(s);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Wire DTO. The encrypted account number and PIN, the signer IP and user agent never leave the API. */
export function portInDto({ request: r, numbers }: PortInWithNumbers): NumberPortIn {
  const focDates = numbers.map((n) => n.focDate).filter((d): d is string => Boolean(d)).sort();
  return {
    id: r.id,
    kind: r.kind,
    businessId: r.businessId,
    status: r.status,
    numbers: numbers.map((n) => ({ e164: n.e164, status: n.status, focDate: n.focDate, rejectionReason: n.rejectionReason, completedAt: iso(n.completedAt) })),
    currentCarrier: r.currentCarrier,
    customerType: r.customerType,
    customerName: r.customerName,
    authorizedName: r.authorizedName,
    authorizedEmail: r.authorizedEmail,
    serviceAddress: r.serviceAddress,
    hasPin: r.pinEncrypted !== null,
    temporaryNumber: r.temporaryNumber,
    keepTemporaryNumber: r.keepTemporaryNumber,
    desiredDate: r.desiredDate,
    focDate: focDates[0] ?? null,
    feeCents: r.feeCents,
    loa:
      r.loaSignedAt && r.loaSignedName && r.loaVersion && r.loaSha256
        ? { version: r.loaVersion, signedName: r.loaSignedName, signedAt: r.loaSignedAt.toISOString(), documentSha256: r.loaSha256 }
        : null,
    statusReason: r.statusReason,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: iso(r.completedAt),
    canceledAt: iso(r.canceledAt),
  };
}

/** The LOA of a request and the SHA-256 of its canonical text (what the signature covers). */
export function loaFor({ request: r, numbers }: PortInWithNumbers) {
  const loa = generateLoaText({
    customerName: r.customerName,
    customerType: r.customerType,
    authorizedName: r.authorizedName,
    currentCarrier: r.currentCarrier,
    numbers: numbers.map((n) => n.e164),
    serviceAddress: r.serviceAddress,
  });
  return { loa, sha256: sha256Hex(loaCanonicalText(loa)) };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Printable bilingual LOA (French first). Self-contained HTML, no script, no external resource. */
export function loaHtml(p: PortInWithNumbers): string {
  const { loa, sha256 } = loaFor(p);
  const r = p.request;
  const signed = r.loaSignedAt && r.loaSignedName;
  const section = (lang: "fr" | "en") => {
    const t = loa[lang];
    const sig = signed
      ? lang === "fr"
        ? `Signé électroniquement par <strong>${esc(r.loaSignedName!)}</strong> le ${esc(r.loaSignedAt!.toISOString())} (adresse IP enregistrée).`
        : `Electronically signed by <strong>${esc(r.loaSignedName!)}</strong> on ${esc(r.loaSignedAt!.toISOString())} (IP address recorded).`
      : lang === "fr"
        ? "Non signé."
        : "Not signed.";
    return `<section lang="${lang === "fr" ? "fr-CA" : "en-CA"}"><h1>${esc(t.title)}</h1>${t.paragraphs.map((x) => `<p>${esc(x)}</p>`).join("")}<p class="sig">${sig}</p></section>`;
  };
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MIMT LOA</title>
<style>body{font-family:Inter,Montserrat,system-ui,sans-serif;color:#060D1F;background:#F5F8FC;max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:1.3rem;color:#1565D8}section{background:#fff;border:1px solid #B8C4D3;border-radius:8px;padding:16px 20px;margin-bottom:16px}.sig{border-top:1px solid #B8C4D3;padding-top:12px}footer{font-size:.8rem;color:#45556c;word-break:break-all}</style></head>
<body>${section("fr")}${section("en")}<footer>MIMT · GROUPE TAKATAK · ${esc(loa.version)} · SHA-256 ${sha256}</footer></body></html>`;
}

/**
 * Sends a signed request to Twilio. Without the gateway (porting disabled) or on failure the
 * request stays "signed" with a reason; ops can retry through POST /v1/port-ins/:id/submit.
 */
export async function submitPortIn(deps: AppDeps, p: PortInWithNumbers, log: Log): Promise<PortInWithNumbers> {
  const { portIns } = deps.repo;
  const r = p.request;
  if (!deps.porting) {
    await portIns.update(r.id, { status: "signed", statusReason: "awaiting_manual_submission" });
    return (await portIns.get(r.id))!;
  }
  try {
    const pin = r.pinEncrypted ? deps.cipher.decrypt(r.pinEncrypted) : undefined;
    const { sid } = await deps.porting.createPortIn({
      numbers: p.numbers.map((n) => ({ e164: n.e164, ...(pin ? { pin } : {}) })),
      customerType: r.customerType,
      customerName: r.customerName,
      accountNumber: deps.cipher.decrypt(r.accountNumberEncrypted),
      accountTelephoneNumber: p.numbers[0]!.e164,
      authorizedName: r.authorizedName,
      authorizedEmail: r.authorizedEmail,
      serviceAddress: r.serviceAddress,
      ...(r.desiredDate ? { targetDate: r.desiredDate } : {}),
      notificationEmails: [r.authorizedEmail, ...(deps.config.PORT_IN_NOTIFICATION_EMAIL ? [deps.config.PORT_IN_NOTIFICATION_EMAIL] : [])],
      documentSids: [],
    });
    await portIns.update(r.id, { status: "submitted", carrierRef: sid, statusReason: null });
    for (const n of p.numbers) if (n.status === "pending") await portIns.updateNumber(n.id, { status: "submitted" });
  } catch (err) {
    // The error message never carries the account number or PIN (see TwilioRestPortingGateway.call).
    log.error({ portInId: r.id, err: err instanceof Error ? err.message : "error" }, "port-in submission to Twilio failed");
    await portIns.update(r.id, { status: "signed", statusReason: "submission_failed" });
  }
  return (await portIns.get(r.id))!;
}

/** A porting_in number that will not port: free it for anyone (no Twilio number exists yet). */
async function releaseHeld(deps: AppDeps, r: PortInRow, e164: string) {
  const n = await deps.repo.getNumberByE164(e164);
  if (n && n.state === "porting_in" && n.telecomAccountId === r.telecomAccountId) {
    await deps.repo.updateNumber(n.id, { state: "released", telecomAccountId: null, stateChangedAt: deps.now() });
  }
}

/** Marks the account's numbers as porting_in once the LOA is signed (they count against the plan). */
export async function holdNumbers(deps: AppDeps, p: PortInWithNumbers) {
  const now = deps.now();
  for (const n of p.numbers) {
    const existing = await deps.repo.getNumberByE164(n.e164);
    const fields = { telecomAccountId: p.request.telecomAccountId, state: "porting_in" as const, stateChangedAt: now, lastActivityAt: now };
    if (existing) await deps.repo.updateNumber(existing.id, { ...fields, twilioSid: null, quarantineUntil: null, warningsSent: [] });
    else await deps.repo.createNumber({ e164: n.e164, twilioSid: null, kind: "local", ...fields });
  }
}

/**
 * The number now belongs to MIMT's Twilio account: point it at our webhooks with the 9-1-1
 * address, make it active on the account and, for MIMT Affaires, route it like the temporary
 * number (or by schedule) and make it the main number when the temporary one was.
 */
async function activate(deps: AppDeps, r: PortInRow, e164: string, log: Log) {
  const { repo } = deps;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const address = await repo.getE911Address(r.telecomAccountId);
  const { sid } = await deps.porting!.configurePortedNumber({
    e164,
    voiceUrl: `${base}/webhooks/twilio/voice/inbound`,
    smsUrl: `${base}/webhooks/twilio/sms/inbound`,
    statusCallback: `${base}/webhooks/twilio/voice/status`,
    ...(address?.providerRef ? { emergencyAddressSid: address.providerRef } : {}),
  });
  const now = deps.now();
  const fields = {
    twilioSid: sid,
    telecomAccountId: r.telecomAccountId,
    kind: "local" as const,
    state: "active" as const,
    lastActivityAt: now,
    stateChangedAt: now,
    quarantineUntil: null,
    warningsSent: [],
  };
  const existing = await repo.getNumberByE164(e164);
  const number = existing ? await repo.updateNumber(existing.id, fields) : await repo.createNumber({ e164, ...fields });

  if (r.businessId) {
    const business = await repo.pbx.getBusiness(r.businessId);
    if (business && business.telecomAccountId === r.telecomAccountId) {
      const tempRoute = r.temporaryNumber ? await repo.pbx.getDidRouteByE164(r.temporaryNumber) : null;
      const target = tempRoute && tempRoute.businessId === business.id ? tempRoute.target : { type: "schedule" as const };
      await repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: number.id, e164, target });
      if (!business.mainNumber || business.mainNumber === r.temporaryNumber) await repo.pbx.updateBusiness(business.id, { mainNumber: e164 });
    }
  }

  const [account, user] = await Promise.all([repo.getAccount(r.telecomAccountId), repo.getUser(r.userId)]);
  await repo.enqueueOutbox("phone_number.assigned", {
    phone_number_id: number.id,
    e164,
    telecom_account_id: r.telecomAccountId,
    global_user_id: user?.globalUserId ?? null,
    workspace_id: account?.workspaceId ?? null,
  });
  await repo.audit({ actorUserId: null, action: "port_in.number_activated", targetType: "phone_number", targetId: number.id, meta: { portInId: r.id, e164 } });
  log.info({ portInId: r.id }, "ported number activated");
}

/**
 * After the FOC date (port completed), the temporary number is no longer needed unless the customer
 * asked to keep it: it enters the normal quarantine → release cycle and loses its business route.
 */
async function retireTemporary(deps: AppDeps, r: PortInRow) {
  if (!r.temporaryNumber || r.keepTemporaryNumber) return;
  const { repo } = deps;
  const n = await repo.getNumberByE164(r.temporaryNumber);
  if (!n || n.telecomAccountId !== r.telecomAccountId || n.state !== "active") return;
  const now = deps.now();
  await repo.updateNumber(n.id, { state: "quarantine", stateChangedAt: now, quarantineUntil: addDays(now, QUARANTINE_DAYS) });
  if (r.businessId) {
    const route = await repo.pbx.getDidRouteByE164(n.e164);
    if (route && route.businessId === r.businessId) await repo.pbx.deleteDidRoute(route.id);
  }
  await repo.audit({ actorUserId: null, action: "port_in.temporary_number_retired", targetType: "phone_number", targetId: n.id, meta: { portInId: r.id } });
}

/** Recomputes the request status from its numbers; on completion retires the temporary number. */
export async function settle(deps: AppDeps, id: string): Promise<PortInWithNumbers> {
  const { portIns } = deps.repo;
  const p = (await portIns.get(id))!;
  const r = p.request;
  if (r.status === "pending_signature" || r.status === "signed") return p;
  const status = aggregatePortInStatus(p.numbers);
  const reason = p.numbers.find((n) => n.status === status && n.rejectionReason)?.rejectionReason ?? null;
  const now = deps.now();
  const patch: Parameters<typeof portIns.update>[1] = {
    status,
    statusReason: status === "action_required" || status === "rejected" ? (reason ?? status) : null,
  };
  if (status === "completed" && !r.completedAt) patch.completedAt = now;
  if (status === "canceled" && !r.canceledAt) patch.canceledAt = now;
  await portIns.update(id, patch);
  if (status === "completed" && r.status !== "completed") await retireTemporary(deps, r);
  return (await portIns.get(id))!;
}

/** Applies Twilio's view of a request (fetched on each webhook). Idempotent: settled numbers are skipped. */
export async function applySnapshot(deps: AppDeps, p: PortInWithNumbers, snap: PortInSnapshot, log: Log): Promise<PortInWithNumbers> {
  const { portIns } = deps.repo;
  const today = deps.now().toISOString().slice(0, 10);
  for (const n of p.numbers) {
    if (!isOpen(n.status)) continue;
    const s = snap.numbers.find((x) => x.e164 === n.e164);
    if (!s) continue;
    const next = mapTwilioNumberStatus(s.status, s.portDate);
    if (next === "completed") {
      // Activation first: if Twilio does not have the number yet the webhook fails and is retried.
      await activate(deps, p.request, n.e164, log);
      await portIns.updateNumber(n.id, { status: "completed", completedAt: deps.now(), focDate: s.portDate ?? n.focDate ?? today });
    } else if (next === "rejected" || next === "canceled") {
      await releaseHeld(deps, p.request, n.e164);
      await portIns.updateNumber(n.id, { status: next, rejectionReason: s.rejectionReason });
    } else if (next !== n.status || s.portDate !== n.focDate || s.rejectionReason !== n.rejectionReason) {
      await portIns.updateNumber(n.id, { status: next, focDate: s.portDate ?? n.focDate, rejectionReason: s.rejectionReason });
    }
  }
  return settle(deps, p.request.id);
}

/** Customer cancellation: cancels at Twilio first (when submitted), then frees the open numbers. */
export async function cancelOpenNumbers(deps: AppDeps, p: PortInWithNumbers) {
  for (const n of p.numbers) {
    if (!isOpen(n.status)) continue;
    await releaseHeld(deps, p.request, n.e164);
    await deps.repo.portIns.updateNumber(n.id, { status: "canceled" });
  }
}
