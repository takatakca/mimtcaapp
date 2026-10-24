"use client";

import { useEffect, useRef, useState } from "react";
import { AI_DEMO_LIMITS, type AiDemoMessage, type AiDemoResponse, type AiDemoScenario, type AiDemoTicket } from "@mimt/shared";
import { API_URL, href, type Lang } from "@/lib/site";
import { Icon, type IconName } from "@/components/Visuals";

/**
 * « Appelez notre IA » : a call to a fictional business, in the browser. The browser turns speech into text and
 * reads the answers aloud (Web Speech API); POST /v1/public/ai-demo runs one AI turn per caller message. Typing
 * always works too (browsers without speech recognition, or a visitor who prefers it).
 */

type Phase = "pick" | "connecting" | "speaking" | "listening" | "thinking" | "ended" | "error";

const SCENARIOS: Record<AiDemoScenario, { fr: [string, string, string]; en: [string, string, string]; icon: IconName }> = {
  restaurant: {
    icon: "chat",
    fr: ["Casse-croûte Comète", "Passez une commande", "« Une poutine et un Coke pour emporter »"],
    en: ["Casse-croûte Comète", "Place an order", "“A poutine and a Coke to go”"],
  },
  support: {
    icon: "shield",
    fr: ["Boutique Nordik", "Service à la clientèle", "« Où est ma commande 1042? »"],
    en: ["Boutique Nordik", "Customer service", "“Where is my order 1042?”"],
  },
  booking: {
    icon: "calendar",
    fr: ["Salon Aurore", "Prenez rendez-vous", "« Une coupe jeudi après-midi »"],
    en: ["Salon Aurore", "Book an appointment", "“A haircut Thursday afternoon”"],
  },
};

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.slice(0, 2);
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(base)) ?? null;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function AiDemo({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const locale = fr ? "fr-CA" : "en-CA";
  const [scenario, setScenario] = useState<AiDemoScenario | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [messages, setMessages] = useState<AiDemoMessage[]>([]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [ticket, setTicket] = useState<AiDemoTicket | null>(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const [canListen, setCanListen] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const scenarioRef = useRef<AiDemoScenario | null>(null);
  const voiceRef = useRef(true);
  const liveRef = useRef(false);
  const msgsRef = useRef<AiDemoMessage[]>([]);
  const logRef = useRef<HTMLOListElement | null>(null);

  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => setCanListen(Boolean(recognitionCtor())), []);
  useEffect(() => {
    let off = false;
    fetch(`${API_URL}/v1/public/ai-demo/status`)
      .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean }>) : { available: false }))
      .then((s) => !off && setAvailable(s.available))
      .catch(() => !off && setAvailable(false));
    return () => {
      off = true;
    };
  }, []);
  useEffect(() => {
    if (phase === "pick" || phase === "ended" || phase === "error") return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, interim]);
  useEffect(() => () => hangUp(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function push(m: AiDemoMessage) {
    msgsRef.current = [...msgsRef.current, m];
    setMessages(msgsRef.current);
  }

  function listen() {
    const Ctor = recognitionCtor();
    if (!Ctor || !liveRef.current || !voiceRef.current) {
      setPhase("listening");
      return;
    }
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = locale;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        text += r[0]?.transcript ?? "";
        if (r.isFinal) finalText = text;
      }
      setInterim(text);
    };
    rec.onerror = () => undefined;
    rec.onend = () => {
      recRef.current = null;
      setInterim("");
      if (!liveRef.current) return;
      if (finalText.trim()) void send(finalText.trim());
      else setPhase("listening");
    };
    setPhase("listening");
    try {
      rec.start();
    } catch {
      setPhase("listening");
    }
  }

  function speak(text: string, after: () => void) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || !voiceRef.current) {
      after();
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    const v = pickVoice(locale);
    if (v) u.voice = v;
    u.rate = 1.04;
    u.onend = after;
    u.onerror = after;
    setPhase("speaking");
    synth.speak(u);
  }

  async function turn(history: AiDemoMessage[]): Promise<AiDemoResponse | null> {
    try {
      const res = await fetch(`${API_URL}/v1/public/ai-demo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: scenarioRef.current, locale, messages: history }),
      });
      if (res.status === 429) throw new Error(fr ? "La démo est très demandée. Réessayez dans quelques minutes." : "The demo is busy. Try again in a few minutes.");
      if (!res.ok) throw new Error(fr ? "L'IA ne répond pas pour le moment. Réessayez bientôt." : "The AI is not answering right now. Try again soon.");
      return (await res.json()) as AiDemoResponse;
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      liveRef.current = false;
      return null;
    }
  }

  function handle(out: AiDemoResponse | null) {
    if (!out || !liveRef.current) return;
    push({ role: "agent", text: out.reply });
    if (out.done) {
      speak(out.reply, () => undefined);
      setTicket(out.ticket);
      liveRef.current = false;
      setPhase("ended");
      return;
    }
    speak(out.reply, listen);
  }

  async function send(text: string) {
    const clean = text.slice(0, AI_DEMO_LIMITS.messageChars);
    if (!clean || !liveRef.current) return;
    recRef.current?.abort();
    push({ role: "caller", text: clean });
    setPhase("thinking");
    handle(await turn(msgsRef.current));
  }

  async function call(s: AiDemoScenario) {
    setScenario(s);
    scenarioRef.current = s;
    msgsRef.current = [];
    setMessages([]);
    setTicket(null);
    setError("");
    setSeconds(0);
    liveRef.current = true;
    setPhase("connecting");
    // A short ring before the AI picks up.
    await new Promise((r) => setTimeout(r, 900));
    const res = await fetch(`${API_URL}/v1/public/ai-demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: s, locale, messages: [] }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(
        res?.status === 429
          ? fr ? "La démo est très demandée. Réessayez dans quelques minutes." : "The demo is busy. Try again in a few minutes."
          : fr ? "L'IA ne répond pas pour le moment. Réessayez bientôt." : "The AI is not answering right now. Try again soon.",
      );
      setPhase("error");
      liveRef.current = false;
      return;
    }
    handle((await res.json()) as AiDemoResponse);
  }

  function hangUp() {
    liveRef.current = false;
    recRef.current?.abort();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }

  const active = phase !== "pick";
  const info = scenario ? SCENARIOS[scenario][lang] : null;
  const status: Record<Phase, string> = fr
    ? { pick: "", connecting: "Appel en cours…", speaking: "L'IA parle", listening: canListen && voiceOn ? "À vous : parlez" : "À vous : écrivez", thinking: "L'IA réfléchit…", ended: "Appel terminé", error: "Appel interrompu" }
    : { pick: "", connecting: "Calling…", speaking: "AI speaking", listening: canListen && voiceOn ? "Your turn: speak" : "Your turn: type", thinking: "AI thinking…", ended: "Call ended", error: "Call dropped" };

  return (
    <div className={`aidemo${active ? " aidemo--active" : ""}`}>
      {available === false && !active ? (
        <div className="aidemo__soon">
          <p>
            {fr
              ? "La démo en libre-service ouvre très bientôt. En attendant, on vous la fait en direct, sur votre propre scénario."
              : "The self-serve demo opens very soon. Meanwhile, we'll run it live for you, on your own scenario."}
          </p>
          <a className="btn btn--primary" href={href(lang, "business", "demo")}>
            {fr ? "Demander une démo en direct" : "Request a live demo"}
          </a>
        </div>
      ) : null}
      {!active ? (
        <ul className={`aidemo__picks${available === false ? " aidemo__picks--off" : ""}`} aria-hidden={available === false ? true : undefined}>
          {(Object.keys(SCENARIOS) as AiDemoScenario[]).map((s) => {
            const [name, what, tryThis] = SCENARIOS[s][lang];
            return (
              <li key={s}>
                <button type="button" className="aidemo__pick" onClick={() => void call(s)} disabled={available === false} tabIndex={available === false ? -1 : undefined}>
                  <span className="aidemo__glyph" aria-hidden="true">
                    <Icon name={SCENARIOS[s].icon} />
                  </span>
                  <span className="aidemo__what">{what}</span>
                  <strong className="aidemo__name">{name}</strong>
                  <span className="aidemo__try">{tryThis}</span>
                  <span className="aidemo__call">
                    <span className="aidemo__dot" aria-hidden="true" />
                    {fr ? "Appeler l'IA" : "Call the AI"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="aidemo__call-screen" role="region" aria-label={fr ? "Appel de démonstration" : "Demo call"}>
          <div className="aidemo__top">
            <div>
              <p className="aidemo__biz">{info?.[0]}</p>
              <p className="aidemo__status" aria-live="polite">
                {status[phase]} · {mmss(seconds)}
              </p>
            </div>
            <button
              type="button"
              className="aidemo__voice"
              aria-pressed={voiceOn}
              onClick={() => {
                voiceRef.current = !voiceRef.current;
                setVoiceOn(voiceRef.current);
                window.speechSynthesis?.cancel();
                recRef.current?.abort();
              }}
            >
              {voiceOn ? (fr ? "Voix : oui" : "Voice: on") : fr ? "Voix : non" : "Voice: off"}
            </button>
          </div>

          <div className={`orb orb--${phase}`} aria-hidden="true">
            <span className="orb__ring" />
            <span className="orb__ring" />
            <span className="orb__ring" />
            <span className="orb__core" />
          </div>

          <ol className="aidemo__log" ref={logRef} aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={`bubble bubble--${m.role}`}>
                {m.text}
              </li>
            ))}
            {interim ? <li className="bubble bubble--caller bubble--interim">{interim}</li> : null}
          </ol>

          {ticket ? (
            <div className="aidemo__ticket">
              <p className="aidemo__ticket-label">{fr ? "Reçu par l'entreprise, par texto :" : "What the business gets, by text:"}</p>
              <p className="aidemo__ticket-title">{ticket.title}</p>
              <ul>
                {ticket.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="aidemo__error">{error}</p> : null}

          {phase === "ended" || phase === "error" ? (
            <div className="aidemo__after">
              <p>
                {fr
                  ? "Ça, c'est la base. Pour votre entreprise, on bâtit le vôtre : votre menu, vos heures, votre ton, sur votre numéro MIMT."
                  : "That's the starting point. For your business, we build yours: your menu, your hours, your voice, on your MIMT number."}
              </p>
              <div className="cta-row">
                <a className="btn btn--primary" href={href(lang, "business", "demo")}>
                  {fr ? "Bâtissons le vôtre" : "Let's build yours"}
                </a>
                <button type="button" className="btn btn--outline-light" onClick={() => setPhase("pick")}>
                  {fr ? "Essayer un autre scénario" : "Try another scenario"}
                </button>
              </div>
            </div>
          ) : (
            <form
              className="aidemo__input"
              onSubmit={(e) => {
                e.preventDefault();
                const t = draft.trim();
                setDraft("");
                void send(t);
              }}
            >
              {canListen && voiceOn ? (
                <button type="button" className={`aidemo__mic${phase === "listening" ? " is-on" : ""}`} onClick={listen} disabled={phase !== "listening"} aria-label={fr ? "Parler" : "Speak"}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
                  </svg>
                </button>
              ) : null}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={AI_DEMO_LIMITS.messageChars}
                placeholder={fr ? "Ou écrivez votre réponse…" : "Or type your answer…"}
                aria-label={fr ? "Votre réponse" : "Your answer"}
                disabled={phase === "thinking" || phase === "connecting"}
              />
              <button type="submit" className="btn btn--primary btn--sm" disabled={!draft.trim() || phase === "thinking" || phase === "connecting"}>
                {fr ? "Envoyer" : "Send"}
              </button>
              <button
                type="button"
                className="aidemo__hang"
                onClick={() => {
                  hangUp();
                  setPhase("pick");
                }}
                aria-label={fr ? "Raccrocher" : "Hang up"}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.47a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.67-1.85.99.99 0 0 1-.56-.9v-3.1A15.1 15.1 0 0 0 12 9Z" />
                </svg>
              </button>
            </form>
          )}
        </div>
      )}
      <p className="aidemo__fine">
        {fr
          ? "Démo avec des commerces fictifs. Votre voix est transcrite par votre navigateur (qui peut utiliser le service de Google ou d'Apple); le texte est envoyé à l'IA (Claude, d'Anthropic) pour répondre. MIMT ne conserve pas la conversation. N'y dites rien de personnel."
          : "Demo with fictional businesses. Your voice is transcribed by your browser (which may use Google's or Apple's service); the text is sent to the AI (Claude, by Anthropic) to answer. MIMT does not keep the conversation. Don't share anything personal."}
      </p>
    </div>
  );
}
