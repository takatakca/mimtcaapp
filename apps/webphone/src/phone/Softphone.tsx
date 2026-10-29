// Floating softphone: launcher button + panel (dial pad, contacts, audio devices) and the in-call
// view. Keyboard: type digits in the number field, Enter calls, Escape closes the panel; during a
// call, digit keys send DTMF.
import { isEmergencyNumber } from "@mimt/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useSession } from "../auth/SessionProvider";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatAsYouType, formatPhone, isDialKey, normalizeDialInput, type CallBlockReason } from "../lib/dial";
import { formatDuration } from "../lib/format";
import { needsNetworkTip, qualityLabelKey, type ConnectionTestResult } from "./connectionTest";
import { DialPad } from "./DialPad";
import { usePhone } from "./PhoneProvider";
import type { CallStatus } from "./types";

const STATUS_KEY: Record<CallStatus, TKey> = {
  idle: "phone.ready",
  incoming: "call.incoming",
  connecting: "call.connecting",
  ringing: "call.ringing",
  connected: "call.connected",
  reconnecting: "call.reconnecting",
  ended: "call.ended",
  failed: "call.failed",
};

type Tab = "keypad" | "contacts" | "audio";

export function Softphone() {
  const { t } = useI18n();
  const { state, panelOpen, setPanelOpen } = usePhone();
  const inCall = state.status !== "idle" && state.status !== "incoming";
  const launcherRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      {panelOpen || inCall ? (
        <section
          className="softphone"
          aria-label={t("phone.title")}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !inCall) {
              setPanelOpen(false);
              launcherRef.current?.focus();
            }
          }}
        >
          {inCall ? <InCall /> : <Idle onClose={() => setPanelOpen(false)} />}
        </section>
      ) : null}
      {!inCall ? (
        <button
          ref={launcherRef}
          type="button"
          className={`softphone-launcher${panelOpen ? " softphone-launcher--open" : ""}`}
          aria-expanded={panelOpen}
          aria-label={panelOpen ? t("phone.close") : t("phone.open")}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <Icon name={panelOpen ? "close" : "phone"} size={24} />
          <span className={`softphone-launcher__dot${state.registered ? " is-on" : ""}`} aria-hidden="true" />
        </button>
      ) : null}
      <IncomingToast />
    </>
  );
}

function RegistrationStatus() {
  const { t } = useI18n();
  const { state } = usePhone();
  const key: TKey = state.registered ? "phone.registered" : state.registering ? "phone.registering" : "phone.offline";
  return (
    <span className={`reg reg--${state.registered ? "on" : "off"}`}>
      <span className="reg__dot" aria-hidden="true" />
      {t(key)}
    </span>
  );
}

function Idle({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("keypad");
  const { state } = usePhone();
  return (
    <>
      <header className="softphone__head">
        <div>
          <h2 className="softphone__title">{t("phone.title")}</h2>
          <RegistrationStatus />
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("phone.close")}>
          <Icon name="close" />
        </button>
      </header>
      <div className="tabs" role="tablist" aria-label={t("phone.title")}>
        {(["keypad", "contacts", "audio"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`sp-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`sp-panel-${k}`}
            className={`tabs__tab${tab === k ? " is-active" : ""}`}
            onClick={() => setTab(k)}
          >
            {t(`phone.tab.${k}` as TKey)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`sp-panel-${tab}`} aria-labelledby={`sp-tab-${tab}`} className="softphone__body">
        {tab === "keypad" ? <Keypad /> : tab === "contacts" ? <Contacts onPick={() => setTab("keypad")} /> : <AudioSettings />}
      </div>
      {state.error ? (
        <p className="note note--error softphone__error" role="alert">
          {t(`phone.error.${state.error}` as TKey)}
        </p>
      ) : null}
    </>
  );
}

const BLOCK_KEY: Record<Exclude<CallBlockReason, null>, TKey> = {
  invalid: "phone.invalidNumber",
  e911_setup: "calls.blockedNoE911",
};

function Keypad() {
  const { t } = useI18n();
  const { draft, setDraft, dial } = usePhone();
  const [blocked, setBlocked] = useState<CallBlockReason>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emergency = isEmergencyNumber(draft);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const call = () => {
    const reason = dial(draft);
    setBlocked(reason);
    if (!reason) setDraft("");
  };

  return (
    <div className="keypad">
      <label htmlFor="dial-input" className="sr-only">
        {t("phone.numberLabel")}
      </label>
      <div className="keypad__display">
        <input
          ref={inputRef}
          id="dial-input"
          className="keypad__input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t("phone.numberPlaceholder")}
          value={formatAsYouType(draft)}
          onChange={(e) => {
            setDraft(normalizeDialInput(e.target.value));
            setBlocked(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              call();
            }
          }}
        />
        {draft ? (
          <button type="button" className="icon-btn" onClick={() => setDraft(draft.slice(0, -1))} aria-label={t("calls.delete")}>
            <Icon name="backspace" />
          </button>
        ) : null}
      </div>
      {emergency ? (
        <div className="note note--warn" role="status">
          <strong>{t("phone.e911Title")}</strong> {t("phone.e911Address")}
        </div>
      ) : null}
      <DialPad
        onKey={(k) => {
          setDraft(normalizeDialInput(draft + k));
          setBlocked(null);
          inputRef.current?.focus();
        }}
      />
      <button
        type="button"
        className={`call-btn${emergency ? " call-btn--emergency" : ""}`}
        onClick={call}
        disabled={!draft}
        aria-label={draft ? t("calls.callNumber", { number: formatPhone(draft) }) : t("calls.call")}
      >
        <Icon name="phone" size={22} />
        <span>{emergency ? t("phone.call911") : t("calls.call")}</span>
      </button>
      {blocked ? (
        <p className="note note--error" role="alert">
          {t(BLOCK_KEY[blocked])}{" "}
          {blocked === "e911_setup" ? <Link to="/compte#e911">{t("account.e911Address")}</Link> : null}
        </p>
      ) : (
        <p className="keypad__hint">{t("call.emergencyHint")}</p>
      )}
    </div>
  );
}

interface ContactRow {
  label: string;
  number: string;
  sub?: string;
}

interface PickerContact {
  name?: string[];
  tel?: string[];
}

function Contacts({ onPick }: { onPick: () => void }) {
  const { t } = useI18n();
  const { prepare } = usePhone();
  const { businesses } = useSession();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [filter, setFilter] = useState("");
  const pickerSupported = typeof navigator !== "undefined" && "contacts" in navigator;

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: ContactRow[] = [];
      const biz = businesses[0];
      if (biz) {
        const ext = await api.extensions(biz.business.id).catch(() => null);
        ext?.extensions
          .filter((e) => e.did)
          .forEach((e) => out.push({ label: e.displayName, number: e.did!, sub: t("phone.extension", { number: e.number }) }));
      }
      const calls = await api.calls().catch(() => null);
      const seen = new Set(out.map((r) => r.number));
      calls?.calls.forEach((c) => {
        if (!seen.has(c.peer) && c.kind !== "app") {
          seen.add(c.peer);
          out.push({ label: formatPhone(c.peer), number: c.peer, sub: t("phone.recent") });
        }
      });
      if (alive) setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, [businesses, t]);

  const pickFromDevice = async () => {
    const nav = navigator as unknown as { contacts: { select: (p: string[], o: { multiple: boolean }) => Promise<PickerContact[]> } };
    const [c] = await nav.contacts.select(["name", "tel"], { multiple: false }).catch(() => [] as PickerContact[]);
    const tel = c?.tel?.[0];
    if (tel) {
      prepare(normalizeDialInput(tel));
      onPick();
    }
  };

  const q = filter.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.number.includes(q.replace(/\D/g, "") || "§")) : rows;

  return (
    <div className="contacts">
      <label htmlFor="contact-search" className="sr-only">
        {t("contacts.search")}
      </label>
      <input id="contact-search" className="input" type="search" placeholder={t("contacts.search")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {pickerSupported ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={pickFromDevice}>
          {t("phone.pickContact")}
        </button>
      ) : null}
      {visible.length === 0 ? (
        <p className="empty">{t("phone.noContacts")}</p>
      ) : (
        <ul className="list list--compact">
          {visible.map((r) => (
            <li key={r.number}>
              <button
                type="button"
                className="list__row list__row--button"
                onClick={() => {
                  prepare(r.number);
                  onPick();
                }}
              >
                <span>
                  <span className="list__title">{r.label}</span>
                  {r.sub ? <span className="list__sub">{r.sub}</span> : null}
                </span>
                <Icon name="phone" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AudioSettings() {
  const { t } = useI18n();
  const { engine, state } = usePhone();
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="audio-in">{t("phone.input")}</label>
        <select
          id="audio-in"
          className="input"
          value={state.inputDeviceId ?? ""}
          onChange={(e) => void engine?.setInputDevice(e.target.value)}
          disabled={state.inputDevices.length === 0}
        >
          {state.inputDevices.length === 0 ? <option value="">{t("phone.defaultDevice")}</option> : null}
          {state.inputDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="audio-out">{t("phone.output")}</label>
        <select
          id="audio-out"
          className="input"
          value={state.outputDeviceId ?? ""}
          onChange={(e) => void engine?.setOutputDevice(e.target.value)}
          disabled={!state.outputSelectionSupported || state.outputDevices.length === 0}
        >
          {state.outputDevices.length === 0 ? <option value="">{t("phone.defaultDevice")}</option> : null}
          {state.outputDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        {!state.outputSelectionSupported ? <p className="field__hint">{t("phone.outputUnsupported")}</p> : null}
      </div>
      <p className="field__hint">{t("phone.micHint")}</p>
      <ConnectionTest />
    </div>
  );
}

type TestState = { kind: "idle" } | { kind: "running" } | { kind: "done"; result: ConnectionTestResult } | { kind: "failed" };

/** « Tester ma connexion »: Twilio preflight on a fresh token. Hidden when the engine has no test (none today). */
function ConnectionTest() {
  const { t, lang } = useI18n();
  const { engine, state } = usePhone();
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const busy = state.status !== "idle" && state.status !== "ended" && state.status !== "failed";
  if (!engine?.runConnectionTest) return null;

  const run = async () => {
    setTest({ kind: "running" });
    try {
      setTest({ kind: "done", result: await engine.runConnectionTest!() });
    } catch {
      setTest({ kind: "failed" });
    }
  };
  const num = (n: number | null, digits = 0) =>
    n === null ? "—" : n.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { maximumFractionDigits: digits });
  const r = test.kind === "done" ? test.result : null;

  return (
    <section className="stack" aria-labelledby="conn-test-h">
      <h3 id="conn-test-h" className="small-title">
        {t("phone.test.title")}
      </h3>
      <p className="field__hint">{t("phone.test.hint")}</p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void run()} disabled={busy || test.kind === "running"}>
        {test.kind === "running" ? t("phone.test.running") : t("phone.test.button")}
      </button>
      {busy ? <p className="field__hint">{t("phone.test.busy")}</p> : null}
      <div aria-live="polite" role="status">
        {test.kind === "failed" ? <p className="note note--error">{t("phone.test.failed")}</p> : null}
        {r ? (
          <>
            <dl className="dl">
              <dt>{t("phone.test.quality")}</dt>
              <dd>{t(qualityLabelKey(r.quality))}</dd>
              <dt>{t("phone.test.jitter")}</dt>
              <dd>{t("phone.test.ms", { value: num(r.jitterMs) })}</dd>
              <dt>{t("phone.test.loss")}</dt>
              <dd>{t("phone.test.pct", { value: num(r.packetLossPct, 1) })}</dd>
              <dt>{t("phone.test.rtt")}</dt>
              <dd>{t("phone.test.ms", { value: num(r.rttMs) })}</dd>
              <dt>{t("phone.test.turn")}</dt>
              <dd>{r.turnRequired === null ? "—" : t(r.turnRequired ? "phone.test.yes" : "phone.test.no")}</dd>
              {r.edge ? (
                <>
                  <dt>{t("phone.test.edge")}</dt>
                  <dd>{r.edge}</dd>
                </>
              ) : null}
            </dl>
            {needsNetworkTip(r) ? <p className="note note--warn">{t("phone.test.tip")}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since ? Math.max(0, (now - since) / 1000) : 0;
}

function InCall() {
  const { t } = useI18n();
  const { engine, state, setPanelOpen } = usePhone();
  const [showKeys, setShowKeys] = useState(false);
  const [dtmf, setDtmf] = useState("");
  const elapsed = useElapsed(state.status === "connected" ? state.connectedAt : null);
  const finished = state.status === "ended" || state.status === "failed";
  const hangupRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hangupRef.current?.focus();
  }, []);

  // Clear "Appel terminé" after a moment.
  useEffect(() => {
    if (!finished) return;
    const id = setTimeout(() => {
      engine?.dismiss();
      setPanelOpen(false);
    }, state.status === "failed" ? 5000 : 2000);
    return () => clearTimeout(id);
  }, [finished, engine, state.status, setPanelOpen]);

  const send = (k: string) => {
    engine?.sendDigits(k);
    setDtmf((d) => (d + k).slice(-16));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (state.status === "connected" && isDialKey(e.key)) {
      e.preventDefault();
      send(e.key);
    }
  };

  return (
    <div className="incall" onKeyDown={onKeyDown}>
      {state.emergency ? (
        <div className="emergency-banner" role="alert">
          <Icon name="alert" />
          <span>
            {t("call.emergencyBanner")}
            <br />
            <small>{t("phone.e911Address")}</small>
          </span>
        </div>
      ) : null}
      <div className="incall__peer">{formatPhone(state.peer) || t("voicemail.unknownCaller")}</div>
      <div className="incall__status" aria-live="polite" role="status">
        {t(STATUS_KEY[state.status])}
        {state.status === "connected" ? <span className="incall__timer"> · {formatDuration(elapsed)}</span> : null}
        {state.onHold ? <span> · {t("call.hold")}</span> : null}
      </div>
      {state.error ? (
        <p className="note note--error" role="alert">
          {t(`phone.error.${state.error}` as TKey)}
        </p>
      ) : null}
      {state.qualityWarnings.length > 0 ? (
        <p className="note note--warn" role="status">
          {t("phone.quality")}
        </p>
      ) : null}
      {!finished ? (
        <>
          {showKeys ? (
            <>
              <div className="incall__dtmf" aria-live="polite">
                {dtmf || " "}
              </div>
              <DialPad compact onKey={send} />
            </>
          ) : null}
          <div className="incall__controls">
            <button
              type="button"
              className={`round-btn${state.muted ? " is-active" : ""}`}
              aria-pressed={state.muted}
              onClick={() => engine?.setMuted(!state.muted)}
              disabled={state.status !== "connected"}
            >
              <Icon name={state.muted ? "micOff" : "mic"} />
              <span>{state.muted ? t("call.unmute") : t("call.mute")}</span>
            </button>
            {state.canHold ? (
              <button
                type="button"
                className={`round-btn${state.onHold ? " is-active" : ""}`}
                aria-pressed={state.onHold}
                onClick={() => engine?.setHold(!state.onHold)}
                disabled={state.status !== "connected"}
              >
                <Icon name={state.onHold ? "play" : "pause"} />
                <span>{state.onHold ? t("call.resume") : t("call.hold")}</span>
              </button>
            ) : null}
            <button
              type="button"
              className={`round-btn${showKeys ? " is-active" : ""}`}
              aria-pressed={showKeys}
              onClick={() => setShowKeys(!showKeys)}
              disabled={state.status !== "connected"}
            >
              <Icon name="dialpad" />
              <span>{showKeys ? t("call.hideKeypad") : t("call.keypad")}</span>
            </button>
          </div>
          <button ref={hangupRef} type="button" className="hangup-btn" onClick={() => engine?.hangup()}>
            <Icon name="hangup" size={24} />
            <span>{t("call.hangup")}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function IncomingToast() {
  const { t } = useI18n();
  const { engine, state, setPanelOpen } = usePhone();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const incoming = state.status === "incoming";
  useEffect(() => {
    if (incoming) acceptRef.current?.focus();
  }, [incoming]);
  return (
    <div className="toast-region" aria-live="assertive">
      {incoming ? (
        <div className="toast" role="alertdialog" aria-labelledby="incoming-title" aria-describedby="incoming-from">
          <div className="toast__pulse" aria-hidden="true">
            <Icon name="phone" size={22} />
          </div>
          <div className="toast__text">
            <p id="incoming-title" className="toast__title">
              {t("call.incoming")}
            </p>
            <p id="incoming-from" className="toast__from">
              {formatPhone(state.peer) || t("voicemail.unknownCaller")}
            </p>
          </div>
          <div className="toast__actions">
            <button type="button" className="btn btn--danger btn--sm" onClick={() => engine?.reject()}>
              {t("call.reject")}
            </button>
            <button
              ref={acceptRef}
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                engine?.accept();
                setPanelOpen(true);
              }}
            >
              {t("call.accept")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
