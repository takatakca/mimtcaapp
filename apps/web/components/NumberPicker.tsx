"use client";

import { useEffect, useRef, useState } from "react";
import { formatNanp, NUMBER_HOLD_MINUTES, type NumberHoldResponse, type PublicNumber, type PublicNumberSearchResponse } from "@mimt/shared";
import { API_URL, APP_URL, type Lang } from "@/lib/site";
import { trackNumberHeld } from "@/lib/tags";

const CHIPS = ["514", "438", "450", "418", "819", "Toronto"];

type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; data: PublicNumberSearchResponse }
  | { kind: "error"; message: string };

/** Where the app picks the hold up (apps/webphone /numero). The token travels in the fragment: never in server logs. */
export function appHandoffUrl(hold: Pick<NumberHoldResponse, "id" | "token">, plan: "lock" | "premium" | "business"): string {
  return `${APP_URL}/numero#hold=${encodeURIComponent(hold.id)}&t=${encodeURIComponent(hold.token ?? "")}&plan=${plan}`;
}

function errorText(code: string | undefined, fr: boolean): string {
  switch (code) {
    case "unknown_place":
      return fr ? "Entrez un indicatif canadien (ex. 514) ou une ville." : "Enter a Canadian area code (e.g. 514) or a city.";
    case "rate_limited":
      return fr ? "Trop de recherches d'un coup. Réessayez dans une minute." : "Too many searches at once. Try again in a minute.";
    case "not_configured":
      return fr ? "La recherche de numéros n'est pas encore ouverte. Revenez bientôt." : "Number search is not open yet. Check back soon.";
    case "number_held":
    case "number_unavailable":
      return fr ? "Ce numéro vient d'être pris. Choisissez-en un autre." : "That number was just taken. Pick another one.";
    default:
      return fr ? "Le service ne répond pas. Réessayez dans un instant." : "The service is not answering. Try again in a moment.";
  }
}

/**
 * Live number picker: type an area code or a city, see real numbers from the carrier, pick one and it is held
 * for NUMBER_HOLD_MINUTES (real countdown). Then sign up and pay in the app. Nothing here is invented: the count
 * is what the search returned, the timer is the server's expiry.
 */
export function NumberPicker({ lang, plan = "lock", id = "numero" }: { lang: Lang; plan?: "lock" | "premium" | "business"; id?: string }) {
  const fr = lang === "fr";
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [hold, setHold] = useState<NumberHoldResponse | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);

  async function search(query: string) {
    const term = query.trim();
    if (term.length < 2) return setState({ kind: "idle" });
    const mine = ++seq.current;
    setState({ kind: "searching" });
    try {
      const res = await fetch(`${API_URL}/v1/public/numbers/search?q=${encodeURIComponent(term)}`);
      const body = await res.json().catch(() => ({}));
      if (mine !== seq.current) return;
      setState(res.ok ? { kind: "results", data: body as PublicNumberSearchResponse } : { kind: "error", message: errorText(body.error, fr) });
    } catch {
      if (mine === seq.current) setState({ kind: "error", message: errorText(undefined, fr) });
    }
  }

  // Search as the visitor types (debounced), only for something that can be a place or an area code.
  useEffect(() => {
    const term = q.trim();
    if (!/^\(?\d{3}\)?$/.test(term) && term.replace(/\d/g, "").length < 3) return;
    const t = window.setTimeout(() => void search(term), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Real countdown to the server's expiry.
  useEffect(() => {
    if (!hold) return;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(hold.expiresAt) - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [hold]);

  async function pick(n: PublicNumber) {
    setBusy(n.e164);
    try {
      const res = await fetch(`${API_URL}/v1/public/numbers/holds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164: n.e164 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: errorText(body.error, fr) });
        return;
      }
      setHold(body as NumberHoldResponse);
      trackNumberHeld();
    } catch {
      setState({ kind: "error", message: errorText(undefined, fr) });
    } finally {
      setBusy(null);
    }
  }

  function release() {
    if (hold?.token) {
      void fetch(`${API_URL}/v1/public/numbers/holds/${hold.id}`, { method: "DELETE", headers: { "x-hold-token": hold.token } }).catch(() => {});
    }
    setHold(null);
  }

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  if (hold) {
    const expired = left <= 0;
    return (
      <div className="picker picker--held" id={id} aria-live="polite">
        {expired ? (
          <>
            <p className="picker__title">{fr ? "La réservation a expiré." : "The hold has expired."}</p>
            <button type="button" className="btn btn--outline-light" onClick={() => setHold(null)}>
              {fr ? "Choisir un numéro" : "Pick a number"}
            </button>
          </>
        ) : (
          <>
            <p className="picker__eyebrow">{fr ? "Réservé pour vous" : "Held for you"}</p>
            <p className="picker__number">{formatNanp(hold.e164, lang)}</p>
            <p className="picker__timer">
              {fr ? "Personne d'autre chez MIMT ne peut le prendre pendant " : "No one else at MIMT can take it for "}
              <strong>
                <time dateTime={`PT${mm}M${ss}S`}>
                  {mm}:{ss}
                </time>
              </strong>
              .
            </p>
            <a className="btn btn--primary btn--lg" href={appHandoffUrl(hold, plan)}>
              {fr ? "Créer mon compte et payer" : "Create my account and pay"}
            </a>
            <button type="button" className="link-button picker__release" onClick={release}>
              {fr ? "Choisir un autre numéro" : "Pick another number"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="picker" id={id}>
      <form
        className="picker__form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <label className="picker__label" htmlFor={`${id}-q`}>
          {fr ? "Choisissez votre numéro" : "Choose your number"}
        </label>
        <div className="picker__row">
          <input
            id={`${id}-q`}
            className="picker__input"
            inputMode="search"
            autoComplete="off"
            placeholder={fr ? "Indicatif ou ville : 514, Québec, Gatineau…" : "Area code or city: 514, Toronto, Ottawa…"}
            value={q}
            maxLength={60}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn--primary" type="submit">
            {fr ? "Chercher" : "Search"}
          </button>
        </div>
      </form>
      <ul className="picker__chips" aria-label={fr ? "Suggestions" : "Suggestions"}>
        {CHIPS.map((c) => (
          <li key={c}>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setQ(c);
                void search(c);
              }}
            >
              {c}
            </button>
          </li>
        ))}
      </ul>

      <div className="picker__results" aria-live="polite">
        {state.kind === "searching" ? <p className="picker__status">{fr ? "Recherche…" : "Searching…"}</p> : null}
        {state.kind === "error" ? <p className="picker__status picker__status--error">{state.message}</p> : null}
        {state.kind === "results" ? (
          state.data.numbers.length ? (
            <>
              <p className="picker__status">
                {fr
                  ? `${state.data.numbers.length} numéros libres maintenant · ${state.data.label.fr}`
                  : `${state.data.numbers.length} numbers free right now · ${state.data.label.en}`}
              </p>
              <ul className="picker__list">
                {state.data.numbers.map((n) => (
                  <li key={n.e164}>
                    <button type="button" className="picker__item" disabled={busy !== null} onClick={() => void pick(n)}>
                      <span className="picker__digits">{formatNanp(n.e164, lang)}</span>
                      <span className="picker__place">{n.locality ?? n.region ?? ""}</span>
                      <span className="picker__take">{busy === n.e164 ? "…" : fr ? "Réserver" : "Hold"}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="picker__fine">
                {fr
                  ? `Un clic le réserve ${NUMBER_HOLD_MINUTES} minutes. Le numéro est payé d'avance avec le forfait, puis activé tout de suite.`
                  : `One click holds it for ${NUMBER_HOLD_MINUTES} minutes. The number is paid up front with the plan, then activated right away.`}
              </p>
            </>
          ) : (
            <p className="picker__status">
              {fr ? "Aucun numéro libre pour l'instant à cet endroit. Essayez un indicatif voisin." : "No free number there right now. Try a nearby area code."}
            </p>
          )
        ) : null}
      </div>
      <noscript>
        <p className="picker__status">
          {fr ? "Activez JavaScript pour chercher un numéro, ou " : "Turn on JavaScript to search, or "}
          <a href={`${APP_URL}/numero`}>{fr ? "choisissez-le dans l'app" : "pick it in the app"}</a>.
        </p>
      </noscript>
    </div>
  );
}
