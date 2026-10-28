// « Pilote MIMT »: the AI command bar on every signed-in page (docs/MIMT-PILOTE.md).
// Open with Ctrl/⌘+K, "/" (outside text fields) or the floating button. Type or dictate; the console shows each
// system step; anything that changes the account waits on the confirmation card; the app then navigates to the
// page and pulses the element that changed.
import type { PilotActionView, PilotClientAction, PilotNavigate, PilotStep } from "@mimt/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "../api/client";
import { ApiClientError } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { usePhone } from "../phone/PhoneProvider";
import { highlight, pilotPath } from "./paths";
import { speechSupported, startDictation, type Dictation } from "./speech";

const STEP_MS = import.meta.env.MODE === "test" ? 0 : 260;

type Phase = "idle" | "thinking" | "awaiting" | "running" | "done";

interface Pending {
  planId: string;
  expiresAt: number;
  actions: PilotActionView[];
}

/** True when the key press happens in a place where "/" is text, not a shortcut. */
function typingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function PilotBar() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { businesses, refreshMe } = useSession();
  const { dial } = usePhone();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<PilotStep[]>([]);
  const [shown, setShown] = useState(0);
  const [source, setSource] = useState<"ai" | "rules" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dictation = useRef<Dictation | null>(null);
  const afterReveal = useRef<(() => void) | null>(null);
  const consoleRef = useRef<HTMLOListElement>(null);

  const close = useCallback(() => {
    dictation.current?.stop();
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  // Keyboard: Ctrl/⌘+K toggles, "/" opens outside text fields, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reveal the console one step at a time, then run what waits for the end of the reveal (navigation, card).
  useEffect(() => {
    if (shown < steps.length) {
      const id = window.setTimeout(() => setShown((s) => s + 1), STEP_MS);
      return () => window.clearTimeout(id);
    }
    const next = afterReveal.current;
    afterReveal.current = null;
    next?.();
    return undefined;
  }, [shown, steps.length]);

  useEffect(() => {
    consoleRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }, [shown]);

  // Confirmation countdown (the clock only ticks while a plan waits).
  useEffect(() => {
    if (!pending) return undefined;
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pending]);
  const left = pending ? Math.max(0, Math.round((pending.expiresAt - clock) / 1000)) : 0;

  const addSteps = (more: PilotStep[], then?: () => void) => {
    setSteps((s) => [...s, ...more]);
    afterReveal.current = then ?? null;
  };

  const go = (nav: PilotNavigate | null, run: number) => {
    if (!nav) return;
    const path = pilotPath(nav, businesses[0]?.business.id ?? null);
    addSteps([{ kind: "info", text: t("ai.pilot.navigate", { page: t(`ai.pilot.page.${nav.page}` as TKey) }) }], () => {
      // A new state key remounts the page (Shell), so it reloads what the Pilote just changed.
      navigate(path, { state: { pilotRun: run } });
      void highlight(nav.highlight);
    });
  };

  const clientAction = (a: PilotClientAction | null) => {
    if (a?.type === "dial") {
      dial(a.number);
      setSteps((s) => [...s, { kind: "result", text: t("ai.pilot.dial"), ok: true }]);
    }
  };

  const fail = (e: unknown) => {
    const code = e instanceof ApiClientError ? e.code : "";
    const key: TKey = code === "pilot_disabled" ? "ai.pilot.disabled" : code === "plan_expired" ? "ai.pilot.expired" : "ai.pilot.error";
    addSteps([{ kind: "refuse", text: t(key), ok: false }]);
    setPhase("done");
    setPending(null);
  };

  const run = async (command: string) => {
    const value = command.trim();
    if (!value || phase === "thinking" || phase === "running") return;
    if (pending) void api.pilotCancel({ planId: pending.planId }).catch(() => undefined);
    setPending(null);
    setSource(null);
    setSteps([{ kind: "understand", text: t("ai.pilot.received", { text: value.slice(0, 120) }) }]);
    setShown(0);
    afterReveal.current = null;
    setPhase("thinking");
    try {
      const res = await api.pilotCommand({ text: value, page: location.pathname });
      setSource(res.source);
      const runId = Date.now();
      addSteps(res.steps, () => {
        if (res.planId && res.pending.length > 0) {
          setClock(Date.now());
          setPending({ planId: res.planId, expiresAt: res.expiresAt ? Date.parse(res.expiresAt) : Date.now() + 120_000, actions: res.pending });
          setPhase("awaiting");
        } else {
          setPhase("done");
        }
        go(res.navigate, runId);
      });
      setText("");
    } catch (e) {
      fail(e);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const { planId } = pending;
    setPending(null);
    setPhase("running");
    try {
      const res = await api.pilotConfirm({ planId });
      const runId = Date.now();
      addSteps(res.steps, () => {
        setPhase("done");
        clientAction(res.clientAction);
        if (res.results.some((r) => r.ok)) void refreshMe().catch(() => undefined);
        go(res.navigate, runId);
      });
    } catch (e) {
      fail(e);
    }
  };

  const cancel = () => {
    if (!pending) return;
    void api.pilotCancel({ planId: pending.planId }).catch(() => undefined);
    setPending(null);
    setPhase("done");
    addSteps([{ kind: "info", text: t("ai.pilot.cancelled") }]);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(text);
  };

  const toggleMic = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    const d = startDictation(locale, {
      onText: (v) => setText(v),
      onDone: (v) => {
        setListening(false);
        dictation.current = null;
        if (v) void run(v);
      },
      onError: () => {
        setListening(false);
        addSteps([{ kind: "info", text: t("ai.pilot.micDenied") }]);
      },
    });
    if (d) {
      dictation.current = d;
      setListening(true);
    }
  };

  const visible = steps.slice(0, shown);
  const busy = phase === "thinking" || phase === "running";
  const examples: TKey[] = ["ai.pilot.ex1", "ai.pilot.ex2", "ai.pilot.ex3", "ai.pilot.ex4"];

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`pilot-launcher${open ? " pilot-launcher--open" : ""}`}
        aria-label={t("ai.pilot.open")}
        aria-expanded={open}
        aria-controls="pilot-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="sparkle" size={24} />
        <span className="pilot-launcher__kbd" aria-hidden="true">
          ⌘K
        </span>
      </button>
      {open ? (
        <section id="pilot-panel" className="pilot" role="dialog" aria-modal="false" aria-labelledby="pilot-title">
          <header className="pilot__head">
            <p className="pilot__label" id="pilot-title">
              <span aria-hidden="true">◢ </span>
              {t("ai.pilot.title")}
              <span className="pilot__tag">{t("ai.pilot.tag")}</span>
              {source ? <span className={`pilot__engine pilot__engine--${source}`}>{t(source === "ai" ? "ai.pilot.engine.ai" : "ai.pilot.engine.rules")}</span> : null}
            </p>
            <button type="button" className="icon-btn" onClick={close} aria-label={t("ai.pilot.close")}>
              <Icon name="close" />
            </button>
          </header>
          <form className="pilot__form" onSubmit={onSubmit}>
            <span className="pilot__prompt" aria-hidden="true">
              ›
            </span>
            <input
              ref={inputRef}
              className="pilot__input"
              aria-label={t("ai.pilot.inputLabel")}
              placeholder={listening ? t("ai.pilot.listening") : t("ai.pilot.placeholder")}
              value={text}
              maxLength={500}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
            {speechSupported() ? (
              <button type="button" className={`icon-btn pilot__mic${listening ? " is-on" : ""}`} aria-pressed={listening} aria-label={t(listening ? "ai.pilot.micStop" : "ai.pilot.mic")} onClick={toggleMic}>
                <Icon name="mic" />
              </button>
            ) : null}
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !text.trim()}>
              {t("ai.pilot.run")}
            </button>
          </form>

          {steps.length === 0 ? (
            <div className="pilot__examples">
              <p className="pilot__mono">{t("ai.pilot.examples")}</p>
              <ul>
                {examples.map((k) => (
                  <li key={k}>
                    <button type="button" className="pilot__chip" onClick={() => void run(t(k))}>
                      {t(k)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol ref={consoleRef} className="pilot__console" aria-label={t("ai.pilot.console")} aria-live="polite">
              {visible.map((s, i) => (
                <li key={i} className={`pilot__step pilot__step--${s.kind}${s.ok === true ? " is-ok" : s.ok === false ? " is-ko" : ""}`}>
                  <span className="pilot__glyph" aria-hidden="true">
                    ◢
                  </span>{" "}
                  {s.text}
                </li>
              ))}
              {busy || shown < steps.length ? (
                <li className="pilot__step pilot__step--wait" aria-hidden="true">
                  <span className="pilot__cursor" /> {t(phase === "running" ? "ai.pilot.running" : "ai.pilot.thinking")}
                </li>
              ) : null}
            </ol>
          )}

          {pending && phase === "awaiting" ? (
            <div className="pilot__confirm" role="group" aria-labelledby="pilot-confirm-h">
              <h2 id="pilot-confirm-h" className="pilot__confirm-title">
                {t("ai.pilot.confirmTitle")}
              </h2>
              <ul className="pilot__actions">
                {pending.actions.map((a, i) => (
                  <li key={i}>{a.summary}</li>
                ))}
              </ul>
              <p className="pilot__mono pilot__ttl">{t("ai.pilot.confirmHint", { seconds: left })}</p>
              <div className="pilot__buttons">
                <button type="button" className="btn btn--primary" onClick={() => void confirm()} disabled={left === 0}>
                  {t("ai.pilot.confirm")}
                </button>
                <button type="button" className="btn btn--ghost" onClick={cancel}>
                  {t("ai.pilot.cancel")}
                </button>
              </div>
            </div>
          ) : null}
          <p className="pilot__hint">{t("ai.pilot.hint")}</p>
        </section>
      ) : null}
    </>
  );
}
