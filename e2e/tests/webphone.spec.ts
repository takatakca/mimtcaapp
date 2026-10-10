// app.mimt.ca against the real API (in-memory data, fake Twilio). One signed-in journey:
// sign in by SMS code → messages → voicemail → MIMT Affaires (create an extension) → services catalog.
// Every API call the page makes is recorded; any 5xx, or a 404 on a route the app expects, fails the test,
// so a path or shape disagreement between apps/webphone and apps/api shows up here.
import { expect, test, type Page, type Response } from "@playwright/test";
import {
  E2E_BUSINESS_NAME,
  E2E_OFFER_NAME_FR,
  E2E_OTP_CODE,
  E2E_PEER,
  E2E_PHONE_TYPED,
  E2E_SMS_BODY,
  E2E_VOICEMAIL_FROM,
  E2E_VOICEMAIL_TRANSCRIPT,
} from "../../apps/api/e2e/fixtures.js";

const API_ORIGIN = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 18181}`;

/** "+14385550199" → "438 555-0199" (same display as apps/webphone/src/lib/dial.ts formatPhone). */
const display = (e164: string) => {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}`;
};

interface ApiCall {
  method: string;
  path: string;
  status: number;
}

/** Statuses that are part of normal flows, not contract problems. */
const EXPECTED_NON_2XX: Array<{ method: string; path: RegExp; status: number }> = [
  // No 9-1-1 address registered yet for the e2e user: the account page and softphone ask, the API says 404.
  { method: "GET", path: /^\/v1\/e911\/address$/, status: 404 },
];

function recordApi(page: Page): ApiCall[] {
  const calls: ApiCall[] = [];
  page.on("response", (res: Response) => {
    const url = new URL(res.url());
    if (url.origin !== API_ORIGIN) return;
    if (res.request().method() === "OPTIONS") return;
    calls.push({ method: res.request().method(), path: url.pathname, status: res.status() });
  });
  return calls;
}

function unexpected(calls: ApiCall[]): ApiCall[] {
  return calls.filter(
    (c) => c.status >= 400 && !EXPECTED_NON_2XX.some((e) => e.method === c.method && e.path.test(c.path) && e.status === c.status),
  );
}

test("sign in by SMS code, read messages and voicemail, add an extension, browse offers", async ({ page }) => {
  const calls = recordApi(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // --- Sign in (OTP; the e2e server's fake Twilio Verify accepts only the fixture code) -------------
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByRole("link", { name: "Recevoir un code par texto" }).click();
  await page.getByLabel("Votre numéro de cellulaire").fill(E2E_PHONE_TYPED);
  await page.getByRole("button", { name: "Envoyer le code" }).click();
  await page.getByLabel("Code reçu par texto").fill(E2E_OTP_CODE);
  await page.getByRole("button", { name: "Valider le code" }).click();
  await expect(page).toHaveURL(/\/messages$/);

  // --- Messages: the inbound SMS seeded through the signed Twilio webhook --------------------------
  const peer = display(E2E_PEER);
  const main = page.locator("main");
  await expect(main.getByText(peer).first()).toBeVisible();
  await expect(main.getByText(E2E_SMS_BODY).first()).toBeVisible();
  await main.getByText(peer).first().click();
  await expect(page).toHaveURL(new RegExp(`/messages/${encodeURIComponent(E2E_PEER).replace(/[+]/g, "\\+")}$|/messages/%2B`));
  await expect(page.getByRole("heading", { name: peer })).toBeVisible();
  await expect(main.getByText(E2E_SMS_BODY).last()).toBeVisible();

  // --- Voicemail ------------------------------------------------------------------------------------
  await page.goto("/messagerie");
  await expect(page.getByRole("heading", { name: "Messagerie vocale" })).toBeVisible();
  await expect(main.getByText(display(E2E_VOICEMAIL_FROM)).first()).toBeVisible();
  await main.getByText("Transcription").first().click();
  await expect(main.getByText(E2E_VOICEMAIL_TRANSCRIPT)).toBeVisible();

  // --- MIMT Affaires: create an extension -------------------------------------------------------------
  await page.getByRole("link", { name: "MIMT Affaires" }).first().click();
  await expect(page).toHaveURL(/\/affaires\/[^/]+$/);
  await expect(main.getByText(E2E_BUSINESS_NAME).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Sections de l'entreprise" }).getByRole("link", { name: "Postes" }).click();
  await expect(page).toHaveURL(/\/affaires\/[^/]+\/postes$/);
  await page.getByRole("button", { name: "Ajouter un poste" }).click();
  const form = page.getByRole("form", { name: "Ajouter un poste" });
  await form.getByLabel("Poste", { exact: true }).fill("201");
  await form.getByLabel("Nom affiché").fill("Réception");
  await form.getByRole("button", { name: "Enregistrer" }).click();
  const row = main.getByRole("row").filter({ hasText: "Réception" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("201");
  // Persisted on the API, not only in the page state.
  await page.reload();
  await expect(main.getByRole("row").filter({ hasText: "Réception" })).toBeVisible();
  expect(calls).toContainEqual(expect.objectContaining({ method: "POST", path: expect.stringMatching(/^\/v1\/business\/[^/]+\/extensions$/), status: 201 }));

  // --- Services: catalog offers ------------------------------------------------------------------------
  await page.goto("/services/offres");
  await expect(page.getByRole("heading", { name: "Forfaits Internet et mobile" })).toBeVisible();
  await expect(main.getByText(E2E_OFFER_NAME_FR)).toBeVisible();
  await page.getByLabel("Code postal").fill("H2X 1Y4");
  await page.getByRole("button", { name: "Voir les forfaits" }).click();
  await expect(page).toHaveURL(/cp=/);
  await expect(main.getByText(E2E_OFFER_NAME_FR)).toBeVisible();
  expect(calls).toContainEqual(expect.objectContaining({ method: "GET", path: "/v1/catalog/offers", status: 200 }));

  // --- Contract check over the whole journey ----------------------------------------------------------
  expect(unexpected(calls), `API calls that failed:\n${JSON.stringify(unexpected(calls), null, 2)}`).toEqual([]);
  expect(pageErrors, "uncaught errors in the page").toEqual([]);
});
