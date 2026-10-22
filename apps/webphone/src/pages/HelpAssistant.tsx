// /aide: in-app help assistant (POST /v1/ai/help). Answers from MIMT facts only; hands over to info@mimt.ca.
import { AI_CONSENT_KIND, type HelpChatRequest } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { ApiClientError, toErrorKey } from "../api/errors";
import { ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { useAsync } from "../lib/useAsync";
import { AI_CONSENT_VERSION } from "./Account";

type Turn = HelpChatRequest["messages"][number] & { needsHuman?: boolean };

export function HelpAssistant() {
  const { locale } = useI18n();
  const fr = locale === "fr-CA";
  const status = useAsync(() => api.aiStatus(), []);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [quota, setQuota] = useState(false);

  if (status.loading) return <Loading />;
  const consent = status.data?.consent ?? false;
  const configured = status.data?.configured ?? false;

  async function agree() {
    setBusy(true);
    try {
      await api.setConsent({ kind: AI_CONSENT_KIND, granted: true, version: AI_CONSENT_VERSION, source: "web-help" });
      status.reload();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setQ("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.help({ messages: next.slice(-12).map(({ role, text: t }) => ({ role, text: t })) });
      setTurns([...next, { role: "assistant", text: res.answer, needsHuman: res.needsHuman }]);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "help_quota_reached") setQuota(true);
      else setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title={fr ? "Aide" : "Help"} />
      <section className="card help">
        {!configured ? (
          <p>{fr ? "L'assistant n'est pas encore disponible. Écrivez-nous à info@mimt.ca." : "The assistant is not available yet. Write to info@mimt.ca."}</p>
        ) : !consent ? (
          <>
            <p>
              {fr
                ? "L'assistant répond à vos questions sur MIMT (forfaits, numéro, 9-1-1, facturation). Vos questions sont traitées par Anthropic (Claude), à l'extérieur du Canada, et ne servent pas à entraîner de modèle. Il ne voit pas votre compte."
                : "The assistant answers your questions about MIMT (plans, number, 9-1-1, billing). Your questions are processed by Anthropic (Claude), outside Canada, and are not used to train models. It cannot see your account."}
            </p>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void agree()}>
              {fr ? "J'accepte, utiliser l'assistant" : "I agree, use the assistant"}
            </button>
            <p className="field__hint">{fr ? "Vous pouvez retirer ce consentement en tout temps dans Compte." : "You can withdraw this consent any time in Account."}</p>
          </>
        ) : (
          <>
            <ol className="help__log" aria-live="polite">
              {turns.length === 0 ? (
                <li className="help__msg help__msg--bot">{fr ? "Bonjour! Posez votre question sur MIMT : forfaits, numéro, transfert, 9-1-1, facturation…" : "Hi! Ask your question about MIMT: plans, number, transfer, 9-1-1, billing…"}</li>
              ) : null}
              {turns.map((tn, i) => (
                <li key={i} className={`help__msg help__msg--${tn.role === "user" ? "me" : "bot"}`}>
                  {tn.text}
                  {tn.needsHuman ? (
                    <a className="help__human" href="mailto:info@mimt.ca">
                      {fr ? "Écrire à une personne : info@mimt.ca" : "Write to a person: info@mimt.ca"}
                    </a>
                  ) : null}
                </li>
              ))}
              {busy ? <li className="help__msg help__msg--bot">…</li> : null}
            </ol>
            {quota ? <p className="note note--warn">{fr ? "Vous avez posé beaucoup de questions ce mois-ci. Écrivez-nous à info@mimt.ca." : "You asked many questions this month. Please write to info@mimt.ca."}</p> : null}
            <ErrorNote error={error} />
            <form className="help__form" onSubmit={(e) => void send(e)}>
              <label htmlFor="help-q" className="sr-only">
                {fr ? "Votre question" : "Your question"}
              </label>
              <input id="help-q" className="input" maxLength={1500} value={q} onChange={(e) => setQ(e.target.value)} placeholder={fr ? "Ex. : Comment transférer mon numéro?" : "E.g. How do I transfer my number?"} />
              <button type="submit" className="btn btn--primary" disabled={busy || !q.trim()}>
                {fr ? "Envoyer" : "Send"}
              </button>
            </form>
            <p className="field__hint">{fr ? "Réponses générées par IA, à partir des informations de MIMT. Urgence : composez le 9-1-1." : "AI-generated answers from MIMT information. Emergency: dial 9-1-1."}</p>
          </>
        )}
      </section>
    </div>
  );
}
