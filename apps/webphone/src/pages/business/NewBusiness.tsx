// /affaires/nouvelle — « MIMT Affaires en 5 minutes ». For an account on a business plan with no
// business yet: name and type → hours → bilingual greeting → AI receptionist → main number, then one
// « Mettre en ligne » runs the setup on the existing /v1/business API (lib/bizSetup.ts) and the
// session reloads the businesses. Nothing is created before that last button.
import { AI_RECEPTIONIST_TERMS_VERSION, formatNanp, planHas, WEEKDAYS, type BilingualText, type Weekday } from "@mimt/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { useSession } from "../../auth/SessionProvider";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import {
  BUSINESS_TYPES,
  greetingFor,
  HOURS_PRESETS,
  hoursText,
  runSetup,
  SETUP_STEPS,
  TYPE_PRESETS,
  weeklyFor,
  type BusinessType,
  type HoursPreset,
  type SetupProgress,
  type SetupStep,
} from "../../lib/bizSetup";
import { clearPendingBusiness, pendingBusiness } from "../../lib/numberHold";

const SITE = "https://mimt.ca";
const HELD = new Set(["active", "locked", "grace", "porting_in"]);
const STEPS: TKey[] = ["biz.new.step.name", "biz.new.step.hours", "biz.new.step.greeting", "biz.new.step.ai", "biz.new.step.number"];
const TERMS: TKey[] = ["ai.rec.terms.p1", "ai.rec.terms.p2", "ai.rec.terms.p3", "ai.rec.terms.p4"];

const TYPE_LABEL: Record<BusinessType, [TKey, TKey]> = {
  restaurant: ["biz.new.type.restaurant", "biz.new.type.restaurantHint"],
  retail: ["biz.new.type.retail", "biz.new.type.retailHint"],
  professional: ["biz.new.type.professional", "biz.new.type.professionalHint"],
  health: ["biz.new.type.health", "biz.new.type.healthHint"],
  other: ["biz.new.type.other", "biz.new.type.otherHint"],
};
const PRESET_LABEL: Record<HoursPreset, TKey> = {
  weekdays: "biz.new.hours.weekdays",
  monSat: "biz.new.hours.monSat",
  daily: "biz.new.hours.daily",
  custom: "biz.new.hours.custom",
};
const RUN_LABEL: Record<SetupStep, TKey> = {
  business: "biz.new.run.business",
  extension: "biz.new.run.extension",
  ai: "biz.new.run.ai",
  menu: "biz.new.run.menu",
  hours: "biz.new.run.hours",
  number: "biz.new.run.number",
};
const DAY_KEY: Record<Weekday, TKey> = { mon: "day.mon", tue: "day.tue", wed: "day.wed", thu: "day.thu", fri: "day.fri", sat: "day.sat", sun: "day.sun" };

/** Reads the greeting aloud: French (fr-CA) first, then English (en-CA). */
function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const synth = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null;
  useEffect(() => () => synth?.cancel(), [synth]);
  const speak = (text: BilingualText) => {
    if (!synth) return;
    synth.cancel();
    const voices = synth.getVoices();
    const pick = (lang: string) =>
      voices.find((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) ?? null;
    const parts: Array<[string, string]> = [
      ["fr-CA", text.fr],
      ["en-CA", text.en],
    ];
    parts.forEach(([lang, words], i) => {
      const u = new SpeechSynthesisUtterance(words);
      u.lang = lang;
      u.voice = pick(lang);
      u.rate = 1;
      if (i === parts.length - 1) u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    });
    setSpeaking(true);
  };
  const stop = () => {
    synth?.cancel();
    setSpeaking(false);
  };
  return { supported: Boolean(synth), speaking, speak, stop };
}

export function NewBusiness() {
  const { t, lang } = useI18n();
  const { me, businesses } = useSession();
  // Decided once: the session gains the new business at the end of the run, the finish screen stays.
  const [existing] = useState(() => businesses.find((b) => b.role === "owner")?.business.id ?? businesses[0]?.business.id ?? null);
  if (existing) return <Navigate to={`/affaires/${encodeURIComponent(existing)}`} replace />;
  const plan = me?.account.plan;
  if (!me || (plan !== "business" && plan !== "business_pro")) {
    return (
      <div className="page wiz">
        <section className="card wiz-card">
          <h1 className="wiz-title">{t("biz.new.title")}</h1>
          <p>{t("biz.new.planRequired")}</p>
          <a className="btn btn--primary" href={`${SITE}/${lang === "fr" ? "affaires" : "en/business"}/`}>
            {t("biz.new.seePlans")}
          </a>
        </section>
      </div>
    );
  }
  return <Wizard />;
}

function Wizard() {
  const { t, lang, locale } = useI18n();
  const { me, refreshMe } = useSession();
  const handoff = useMemo(() => pendingBusiness(), []);
  const plan = me!.account.plan;
  const aiAllowed = planHas(plan, "ai_assist") && planHas(plan, "auto_attendant");
  const numbers = me!.numbers.filter((n) => HELD.has(n.state));

  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [name, setName] = useState(handoff?.name ?? "");
  const [type, setType] = useState<BusinessType>(handoff?.type ?? "restaurant");
  const [preset, setPreset] = useState<HoursPreset>(TYPE_PRESETS[handoff?.type ?? "restaurant"].hours);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [custom, setCustom] = useState<{ days: Weekday[]; open: string; close: string }>({ days: ["mon", "tue", "wed", "thu", "fri"], open: "09:00", close: "17:00" });
  const [holidays, setHolidays] = useState(true);
  const [aiOn, setAiOn] = useState(aiAllowed);
  const [greeting, setGreeting] = useState<BilingualText>(() => greetingFor(handoff?.name ?? "", handoff?.type ?? "restaurant", aiAllowed));
  const [greetingEdited, setGreetingEdited] = useState(false);
  const [address, setAddress] = useState("");
  const [offer, setOffer] = useState("");
  const [prices, setPrices] = useState("");
  const [english, setEnglish] = useState(true);
  const [agree, setAgree] = useState(false);
  const [mainNumber, setMainNumber] = useState<string | null>(numbers[0]?.e164 ?? null);
  const speech = useSpeech();

  const [phase, setPhase] = useState<"form" | "run" | "done">("form");
  const [current, setCurrent] = useState<SetupStep | null>(null);
  const [runError, setRunError] = useState<TKey | null>(null);
  const progress = useRef<SetupProgress>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The generated greeting follows the name, the type and the AI choice until the owner edits it.
  useEffect(() => {
    if (!greetingEdited) setGreeting(greetingFor(name, type, aiAllowed && aiOn));
  }, [name, type, aiOn, aiAllowed, greetingEdited]);

  // Each step starts at the top, with focus on its heading (screen readers hear the new step).
  useEffect(() => {
    const el = headingRef.current;
    el?.focus({ preventScroll: true });
    document.scrollingElement?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [step, phase]);

  const weekly = weeklyFor(preset, custom);
  const hoursOk = preset !== "custom" || (custom.days.length > 0 && custom.open < custom.close);
  const valid = [name.trim().length > 0, hoursOk, greeting.fr.trim().length > 0 && greeting.en.trim().length > 0, !(aiAllowed && aiOn) || agree, true];

  const next = () => {
    setTried(true);
    if (!valid[step]) return;
    setTried(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => {
    setTried(false);
    setStep((s) => Math.max(0, s - 1));
  };

  const pickType = (v: BusinessType) => {
    setType(v);
    if (!hoursTouched) setPreset(TYPE_PRESETS[v].hours);
  };

  const launch = async () => {
    setPhase("run");
    setRunError(null);
    try {
      await runSetup(
        api,
        {
          name,
          type,
          locale,
          ownerUserId: me!.user.id,
          ownerName: me!.user.displayName ?? "",
          weekly,
          quebecHolidays: holidays,
          greeting,
          ai: aiAllowed && aiOn ? { address, offer, prices, english } : null,
          mainNumber,
        },
        progress.current,
        setCurrent,
      );
      clearPendingBusiness();
      speech.stop();
      await refreshMe().catch(() => undefined);
      setPhase("done");
    } catch (e) {
      setRunError(toErrorKey(e));
      // A business may exist now: the menu and the sidebar should know it.
      if (progress.current.businessId) await refreshMe().catch(() => undefined);
    }
  };

  const fmt = (e164: string) => formatNanp(e164, lang);
  const hoursSummary = `${hoursText(weekly, lang)}${holidays ? ` ${t("biz.new.hours.holidays")}.` : ""}`;

  if (phase === "done") {
    const id = progress.current.businessId!;
    const base = `/affaires/${encodeURIComponent(id)}`;
    const links: Array<[string, TKey]> = [
      [`${base}/accueil`, "biz.nav.ivr"],
      [`${base}/heures`, "biz.nav.hours"],
      [`${base}/postes`, "biz.nav.extensions"],
      [`${base}/numeros`, "biz.nav.numbers"],
      [`${base}/receptionniste-ia`, "biz.nav.ai"],
      [`${base}/membres`, "biz.nav.members"],
    ];
    return (
      <div className="page wiz">
        <section className="card wiz-card wiz-done" aria-live="polite">
          <div className="wiz-done__burst" aria-hidden="true" />
          <h1 className="wiz-title" tabIndex={-1} ref={headingRef}>
            {mainNumber ? t("biz.new.done.title") : t("biz.new.done.ready")}
          </h1>
          {mainNumber ? (
            <>
              <div className="hold-card__chip wiz-done__chip">
                <div>
                  <p className="hold-card__eyebrow">{name.trim()}</p>
                  <p className="hold-card__number">{fmt(mainNumber)}</p>
                </div>
                <span className="wiz-live" aria-hidden="true" />
              </div>
              <p>{t("biz.new.done.test")}</p>
            </>
          ) : (
            <p>{t("biz.new.done.noNumber")}</p>
          )}
          {progress.current.aiFailed ? <p className="note note--warn">{t("biz.new.run.aiFailed")}</p> : null}
          <div className="row row--wrap">
            <Link className="btn btn--primary btn--lg" to={base}>
              {t("biz.new.done.open")}
            </Link>
            {!mainNumber ? (
              <a className="btn btn--ghost btn--lg" href={`${SITE}/${lang === "fr" ? "affaires" : "en/business"}/#numero-affaires`}>
                {t("biz.new.done.addNumber")}
              </a>
            ) : null}
          </div>
          <h2 className="wiz-sub">{t("biz.new.done.settings")}</h2>
          <ul className="wiz-links">
            {links.map(([to, k]) => (
              <li key={to}>
                <Link to={to}>{t(k)}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  if (phase === "run") {
    const shown = SETUP_STEPS.filter((s) => (s === "ai" ? aiAllowed && aiOn : s === "number" ? Boolean(mainNumber) : true));
    const at = current ? shown.indexOf(current) : 0;
    return (
      <div className="page wiz">
        <section className="card wiz-card" aria-live="polite">
          <h1 className="wiz-title" tabIndex={-1} ref={headingRef}>
            {t("biz.new.run.title")}
          </h1>
          <ol className="wiz-run">
            {shown.map((s, i) => {
              const state = runError && i === at ? "is-failed" : i < at ? "is-done" : i === at ? "is-now" : "";
              return (
                <li key={s} className={state}>
                  <span className="wiz-run__dot" aria-hidden="true">
                    {state === "is-done" ? "✓" : state === "is-failed" ? "!" : ""}
                  </span>
                  {t(RUN_LABEL[s])}
                </li>
              );
            })}
          </ol>
          {runError ? (
            <>
              <p className="note note--error" role="alert">
                {t("biz.new.run.failed")} ({t(runError)})
              </p>
              <button type="button" className="btn btn--primary" onClick={() => void launch()}>
                {t("biz.new.run.retry")}
              </button>
            </>
          ) : null}
        </section>
      </div>
    );
  }

  const error = (k: TKey) =>
    tried ? (
      <p className="field__error" role="alert">
        {t(k)}
      </p>
    ) : null;

  return (
    <div className="page wiz">
      <header className="wiz-head">
        <p className="wiz-eyebrow">MIMT Affaires</p>
        <h1 className="wiz-title">{t("biz.new.title")}</h1>
        <p className="muted">{t("biz.new.lead")}</p>
      </header>
      <ol className="checkout-steps wiz-steps" aria-label={t("biz.new.steps")}>
        {STEPS.map((k, i) => (
          <li key={k} className={i < step ? "is-done" : i === step ? "is-now" : ""} aria-current={i === step ? "step" : undefined}>
            <span className="checkout-steps__dot" aria-hidden="true">
              {i < step ? "✓" : i + 1}
            </span>
            <span className="checkout-steps__label">{t(k)}</span>
          </li>
        ))}
      </ol>

      <section className="card wiz-card" aria-labelledby="wiz-h">
        <div className="wiz-panel" key={step}>
          <p className="wiz-count">{t("biz.new.stepOf", { n: step + 1, total: STEPS.length })}</p>

          {step === 0 ? (
            <>
              <h2 id="wiz-h" className="wiz-sub" tabIndex={-1} ref={headingRef}>
                {t("biz.new.name.title")}
              </h2>
              <div className={`field${tried && !valid[0] ? " field--error" : ""}`}>
                <label htmlFor="wiz-name">{t("biz.new.name.label")}</label>
                <input
                  id="wiz-name"
                  className="input input--lg"
                  maxLength={120}
                  autoComplete="organization"
                  placeholder={t("biz.new.name.placeholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && next()}
                />
                {!valid[0] ? error("biz.new.name.required") : null}
              </div>
              <fieldset className="choice-grid">
                <legend>{t("biz.new.type.label")}</legend>
                {BUSINESS_TYPES.map((v) => (
                  <label key={v} className={`choice${type === v ? " is-on" : ""}`}>
                    <input type="radio" name="wiz-type" value={v} checked={type === v} onChange={() => pickType(v)} />
                    <span className="choice__name">{t(TYPE_LABEL[v][0])}</span>
                    <span className="choice__hint">{t(TYPE_LABEL[v][1])}</span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 id="wiz-h" className="wiz-sub" tabIndex={-1} ref={headingRef}>
                {t("biz.new.hours.title")}
              </h2>
              <p className="muted small">{t("biz.new.hours.lead")}</p>
              <fieldset className="choice-grid choice-grid--2">
                <legend className="sr-only">{t("biz.new.hours.title")}</legend>
                {HOURS_PRESETS.map((p) => (
                  <label key={p} className={`choice${preset === p ? " is-on" : ""}`}>
                    <input
                      type="radio"
                      name="wiz-hours"
                      value={p}
                      checked={preset === p}
                      onChange={() => {
                        setPreset(p);
                        setHoursTouched(true);
                      }}
                    />
                    <span className="choice__name">{t(PRESET_LABEL[p])}</span>
                    {p === "daily" ? <span className="choice__hint">{t("biz.new.hours.dailyHint")}</span> : null}
                  </label>
                ))}
              </fieldset>
              {preset === "custom" ? (
                <div className="wiz-custom">
                  <fieldset className="checks">
                    <legend>{t("biz.new.hours.days")}</legend>
                    {WEEKDAYS.map((d) => (
                      <label key={d} className="check">
                        <input
                          type="checkbox"
                          checked={custom.days.includes(d)}
                          onChange={(e) => setCustom({ ...custom, days: e.target.checked ? WEEKDAYS.filter((x) => x === d || custom.days.includes(x)) : custom.days.filter((x) => x !== d) })}
                        />
                        <span>{t(DAY_KEY[d])}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="row row--wrap">
                    <div className="field">
                      <label htmlFor="wiz-open">{t("biz.new.hours.open")}</label>
                      <input id="wiz-open" type="time" className="input" value={custom.open} onChange={(e) => setCustom({ ...custom, open: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="wiz-close">{t("biz.new.hours.close")}</label>
                      <input id="wiz-close" type="time" className="input" value={custom.close} onChange={(e) => setCustom({ ...custom, close: e.target.value })} />
                    </div>
                  </div>
                  {!hoursOk ? error("biz.new.hours.invalid") : null}
                </div>
              ) : null}
              <label className="switch-row">
                <span>
                  <span className="switch-row__label">{t("biz.new.hours.holidays")}</span>
                  <span className="field__hint">{t("biz.new.hours.holidaysHint")}</span>
                </span>
                <input type="checkbox" role="switch" className="switch" checked={holidays} onChange={(e) => setHolidays(e.target.checked)} />
              </label>
              <p className="wiz-summary">
                <strong>{t("biz.new.hours.summary")} : </strong>
                {hoursSummary}
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 id="wiz-h" className="wiz-sub" tabIndex={-1} ref={headingRef}>
                {t("biz.new.greeting.title")}
              </h2>
              <p className="muted small">{t("biz.new.greeting.lead")}</p>
              <div className="field">
                <label htmlFor="wiz-gr-fr">{t("biz.new.greeting.fr")}</label>
                <textarea
                  id="wiz-gr-fr"
                  className="input"
                  rows={4}
                  maxLength={1000}
                  lang="fr-CA"
                  value={greeting.fr}
                  onChange={(e) => {
                    setGreetingEdited(true);
                    setGreeting({ ...greeting, fr: e.target.value });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="wiz-gr-en">{t("biz.new.greeting.en")}</label>
                <textarea
                  id="wiz-gr-en"
                  className="input"
                  rows={3}
                  maxLength={1000}
                  lang="en-CA"
                  value={greeting.en}
                  onChange={(e) => {
                    setGreetingEdited(true);
                    setGreeting({ ...greeting, en: e.target.value });
                  }}
                />
              </div>
              {!valid[2] ? error("biz.new.greeting.required") : null}
              <div className="row row--wrap">
                {speech.supported ? (
                  <button type="button" className={`btn btn--primary wiz-listen${speech.speaking ? " is-on" : ""}`} onClick={() => (speech.speaking ? speech.stop() : speech.speak(greeting))}>
                    <span className="wiz-wave" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    {speech.speaking ? t("biz.new.greeting.stop") : t("biz.new.greeting.listen")}
                  </button>
                ) : (
                  <p className="muted small">{t("biz.new.greeting.noVoice")}</p>
                )}
                {greetingEdited ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setGreetingEdited(false);
                      setGreeting(greetingFor(name, type, aiAllowed && aiOn));
                    }}
                  >
                    {t("biz.new.greeting.regenerate")}
                  </button>
                ) : null}
              </div>
              <div className="summary">
                <h4>{t("biz.new.greeting.keys")}</h4>
                <ul>
                  <li>{t("biz.new.greeting.key1")}</li>
                  {aiAllowed && aiOn ? <li>{t("biz.new.greeting.key2")}</li> : null}
                  <li>{t("biz.new.greeting.key0")}</li>
                </ul>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h2 id="wiz-h" className="wiz-sub" tabIndex={-1} ref={headingRef}>
                {t("biz.new.ai.title")}
              </h2>
              <p className="muted small">{t("biz.new.ai.lead")}</p>
              {!aiAllowed ? (
                <p className="note note--info">{t("biz.new.ai.notIncluded")}</p>
              ) : (
                <>
                  <label className="switch-row">
                    <span className="switch-row__label">{t("biz.new.ai.toggle")}</span>
                    <input type="checkbox" role="switch" className="switch" checked={aiOn} onChange={(e) => setAiOn(e.target.checked)} />
                  </label>
                  {aiOn ? (
                    <>
                      <div className="field">
                        <label htmlFor="wiz-addr">{t("biz.new.ai.address")}</label>
                        <input id="wiz-addr" className="input" maxLength={300} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                      </div>
                      <fieldset className="fieldset">
                        <legend>{t("biz.new.ai.answers")}</legend>
                        <p className="wiz-summary">
                          <strong>{t("biz.new.ai.answersHours")} : </strong>
                          {hoursSummary}
                        </p>
                        <div className="field">
                          <label htmlFor="wiz-offer">{type === "restaurant" ? t("biz.new.ai.offerRestaurant") : t("biz.new.ai.offerOther")}</label>
                          <textarea id="wiz-offer" className="input" rows={3} maxLength={3000} placeholder={t("biz.new.ai.offerPlaceholder")} value={offer} onChange={(e) => setOffer(e.target.value)} />
                        </div>
                        <div className="field">
                          <label htmlFor="wiz-prices">{t("biz.new.ai.prices")}</label>
                          <textarea id="wiz-prices" className="input" rows={2} maxLength={3000} placeholder={t("biz.new.ai.pricesPlaceholder")} value={prices} onChange={(e) => setPrices(e.target.value)} />
                        </div>
                        <label className="check">
                          <input type="checkbox" checked={english} onChange={(e) => setEnglish(e.target.checked)} />
                          <span>{t("biz.new.ai.english")}</span>
                        </label>
                      </fieldset>
                      <div className="summary" tabIndex={0} aria-label={t("ai.rec.terms.title")}>
                        <h4>{t("ai.rec.terms.title")}</h4>
                        {TERMS.map((k) => (
                          <p key={k}>{t(k)}</p>
                        ))}
                        <p className="muted small">{t("ai.rec.terms.version", { version: AI_RECEPTIONIST_TERMS_VERSION })}</p>
                      </div>
                      <label className={`check${tried && !agree ? " field--error" : ""}`}>
                        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                        <span>{t("biz.new.ai.agree")}</span>
                      </label>
                      {!valid[3] ? error("biz.new.ai.agreeRequired") : null}
                    </>
                  ) : (
                    <p className="muted small">{t("biz.new.ai.later")}</p>
                  )}
                </>
              )}
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h2 id="wiz-h" className="wiz-sub" tabIndex={-1} ref={headingRef}>
                {t("biz.new.number.title")}
              </h2>
              <p className="muted small">{t("biz.new.number.lead")}</p>
              {numbers.length ? (
                <fieldset className="choice-grid choice-grid--2">
                  <legend className="sr-only">{t("biz.new.number.title")}</legend>
                  {numbers.map((n) => (
                    <label key={n.id} className={`choice choice--number${mainNumber === n.e164 ? " is-on" : ""}`}>
                      <input type="radio" name="wiz-number" value={n.e164} checked={mainNumber === n.e164} onChange={() => setMainNumber(n.e164)} />
                      <span className="choice__name">{fmt(n.e164)}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <>
                  <p className="note note--info">{t("biz.new.number.none")}</p>
                  <a className="btn btn--ghost" href={`${SITE}/${lang === "fr" ? "affaires" : "en/business"}/#numero-affaires`}>
                    {t("biz.new.number.pick")}
                  </a>
                </>
              )}
              <div className="summary wiz-review">
                <h4>{t("biz.new.review")}</h4>
                <ul>
                  <li>
                    <strong>{name.trim()}</strong> · {t(TYPE_LABEL[type][0])}
                  </li>
                  <li>{hoursSummary}</li>
                  <li>{greeting.fr}</li>
                  <li>
                    {t("biz.new.ai.title")} : {aiAllowed && aiOn ? t("common.on") : t("common.off")}
                  </li>
                  {mainNumber ? <li>{fmt(mainNumber)}</li> : null}
                </ul>
              </div>
            </>
          ) : null}

          <div className="wiz-actions">
            {step > 0 ? (
              <button type="button" className="btn btn--ghost" onClick={back}>
                {t("biz.new.back")}
              </button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn--primary btn--lg" onClick={next}>
                {t("biz.new.next")}
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--lg wiz-launch" onClick={() => void launch()}>
                {t("biz.new.launch")}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
