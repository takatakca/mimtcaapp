"use client";

import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/site";

type Panel = "forward" | "voicemail" | "number";

interface Scenario {
  id: Panel;
  label: { fr: string; en: string };
  command: { fr: string; en: string };
  steps: { fr: string; en: string }[];
}

// Scripted demonstration of the Pilote MIMT command bar (apps/webphone). Fictional data only.
const SCENARIOS: readonly Scenario[] = [
  {
    id: "forward",
    label: { fr: "Renvoi d'appel", en: "Call forwarding" },
    command: { fr: "Renvoie mes appels sur mon cell après 17 h", en: "Forward my calls to my cell after 5 pm" },
    steps: [
      { fr: "Compréhension : renvoi d'appel, après 17 h", en: "Understood: call forwarding, after 5 pm" },
      { fr: "Vérification : forfait Premium, renvoi inclus ✓", en: "Check: Premium plan, forwarding included ✓" },
      { fr: "Action proposée : activer le renvoi 17 h → 9 h", en: "Proposed action: forward 5 pm → 9 am" },
      { fr: "Confirmé par vous ✓ Renvoi actif", en: "Confirmed by you ✓ Forwarding on" },
    ],
  },
  {
    id: "voicemail",
    label: { fr: "Messagerie vocale", en: "Voicemail" },
    command: { fr: "Résume mes messages vocaux d'aujourd'hui", en: "Summarise today's voicemails" },
    steps: [
      { fr: "Compréhension : résumé, messagerie, aujourd'hui", en: "Understood: summary, voicemail, today" },
      { fr: "Lecture : 3 messages transcrits en français", en: "Reading: 3 messages transcribed in French" },
      { fr: "Résumé prêt : 1 urgent, 2 à rappeler", en: "Summary ready: 1 urgent, 2 to call back" },
    ],
  },
  {
    id: "number",
    label: { fr: "Nouveau numéro", en: "New number" },
    command: { fr: "Trouve-moi un 438 facile à retenir", en: "Find me an easy 438 number" },
    steps: [
      { fr: "Compréhension : indicatif 438, numéro facile", en: "Understood: area code 438, easy number" },
      { fr: "Recherche : 12 numéros libres, 2 faciles", en: "Search: 12 free numbers, 2 easy ones" },
      { fr: "Action proposée : réserver 438 555-0100", en: "Proposed action: hold 438 555-0100" },
      { fr: "Confirmé par vous ✓ Réservé 10 minutes", en: "Confirmed by you ✓ Held for 10 minutes" },
    ],
  },
];

/** « Dites-le. L'IA le fait. » A typed command, the system's steps, and the app reacting. */
export function PilotShowcase({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);
  const s = SCENARIOS[index]!;
  const command = fr ? s.command.fr : s.command.en;

  useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  // Typing, then one step every 900 ms, then the next scenario.
  useEffect(() => {
    if (reduced.current) {
      setTyped(command);
      setDone(s.steps.length);
      return;
    }
    setTyped("");
    setDone(0);
    let i = 0;
    let step = 0;
    let timer = 0;
    const type = () => {
      i += 1;
      setTyped(command.slice(0, i));
      if (i < command.length) timer = window.setTimeout(type, 38);
      else timer = window.setTimeout(next, 500);
    };
    const next = () => {
      step += 1;
      setDone(step);
      if (step < s.steps.length) timer = window.setTimeout(next, 900);
    };
    timer = window.setTimeout(type, 400);
    return () => window.clearTimeout(timer);
  }, [index, command, s.steps.length]);

  useEffect(() => {
    if (paused || reduced.current || done < s.steps.length) return;
    const t = window.setTimeout(() => setIndex((n) => (n + 1) % SCENARIOS.length), 3200);
    return () => window.clearTimeout(t);
  }, [done, paused, s.steps.length]);

  const finished = done >= s.steps.length;
  return (
    <section className="section pilot hud-dark" id={fr ? "pilote" : "pilot"} aria-labelledby="pilot-title" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="future__grid" aria-hidden="true" />
      <div className="container">
        <div className="section-head" data-reveal="">
          <p className="kicker kicker--light">{fr ? "Pilote MIMT" : "MIMT Pilot"}</p>
          <h2 id="pilot-title">{fr ? "Dites-le. L'IA le fait." : "Say it. The AI does it."}</h2>
          <p className="section-lead">
            {fr
              ? "Dans l'app, vous écrivez ou dites ce que vous voulez. Le Pilote vous montre chaque étape, vous demande votre accord avant tout changement, puis l'exécute devant vous."
              : "In the app, you type or say what you want. The Pilot shows every step, asks your OK before any change, then does it in front of you."}
          </p>
        </div>
        <div className="pilot__tabs" role="tablist" aria-label={fr ? "Exemples" : "Examples"}>
          {SCENARIOS.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === index} className={`pilot__tab${i === index ? " is-on" : ""}`} onClick={() => setIndex(i)}>
              {fr ? x.label.fr : x.label.en}
            </button>
          ))}
        </div>
        <div className="pilot__stage">
          <div className="pilot__console" aria-live="polite">
            <p className="pilot__bar">
              <span className="pilot__prompt" aria-hidden="true">⌘K</span>
              <span className="pilot__typed">{typed}</span>
              <span className="pilot__caret" aria-hidden="true" />
            </p>
            <ol className="pilot__steps">
              {s.steps.slice(0, done).map((st) => (
                <li key={st.fr} className={`pilot__step${st.fr.includes("✓") ? " is-ok" : ""}`}>
                  <span aria-hidden="true">◢ </span>
                  {fr ? st.fr : st.en}
                </li>
              ))}
            </ol>
          </div>
          <div className={`pilot__app${finished ? " is-done" : ""}`} aria-hidden="true">
            <div className="pilot__chrome">
              <span />
              <span />
              <span />
              <b>app.mimt.ca</b>
            </div>
            {s.id === "forward" ? (
              <div className="pilot__screen">
                <p className="pilot__title">{fr ? "Réglages d'appel" : "Call settings"}</p>
                <div className={`pilot__row${finished ? " is-pulse" : ""}`}>
                  <span>{fr ? "Renvoi vers 514 555-0199" : "Forward to 514 555-0199"}</span>
                  <i className={`pilot__toggle${finished ? " is-on" : ""}`} />
                </div>
                <div className="pilot__row">
                  <span>{fr ? "Horaire" : "Schedule"}</span>
                  <b>{finished ? "17 h → 9 h" : "—"}</b>
                </div>
                <div className="pilot__row">
                  <span>{fr ? "Messagerie si pas de réponse" : "Voicemail if no answer"}</span>
                  <i className="pilot__toggle is-on" />
                </div>
              </div>
            ) : s.id === "voicemail" ? (
              <div className="pilot__screen">
                <p className="pilot__title">{fr ? "Messagerie vocale · résumé" : "Voicemail · summary"}</p>
                {[
                  { who: "Julie · Fleurs Gatineau", what: fr ? "Urgent : confirme la livraison de jeudi" : "Urgent: confirms Thursday's delivery", hot: true },
                  { who: "514 555-0123", what: fr ? "Rappeler : soumission demandée" : "Call back: wants a quote", hot: false },
                  { who: "Marc · Comptable", what: fr ? "Rappeler avant vendredi" : "Call back before Friday", hot: false },
                ].map((v, i) => (
                  <div key={v.who} className={`pilot__row pilot__vm${finished || done > i ? " is-in" : ""}`}>
                    <span>
                      <b>{v.who}</b>
                      <small>{v.what}</small>
                    </span>
                    {v.hot ? <em className="pilot__flag">{fr ? "Urgent" : "Urgent"}</em> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="pilot__screen">
                <p className="pilot__title">{fr ? "Choisir un numéro" : "Pick a number"}</p>
                <div className="pilot__row">
                  <span>438 555-0147</span>
                  <small>Montréal</small>
                </div>
                <div className={`pilot__row pilot__pick${finished ? " is-pulse is-held" : ""}`}>
                  <span>
                    438 555-0100 <em className="picker__lucky">✦ {fr ? "Finit par 00" : "Ends in 00"}</em>
                  </span>
                  <b>{finished ? (fr ? "Réservé 10:00" : "Held 10:00") : fr ? "Libre" : "Free"}</b>
                </div>
                <div className="pilot__row">
                  <span>438 555-0233</span>
                  <small>Montréal</small>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="pilot__fine">
          {fr
            ? "Démonstration avec des données fictives. Le Pilote ne touche jamais aux paiements, au forfait ni à l'adresse 9-1-1, et demande votre accord avant chaque changement."
            : "Demonstration with fictional data. The Pilot never touches payments, your plan or your 9-1-1 address, and asks your OK before every change."}
        </p>
      </div>
    </section>
  );
}
