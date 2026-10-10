import type { ConversationDto, MessageDto } from "@mimt/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Icon } from "../components/Icon";
import { Badge, Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatPhone, toDialable } from "../lib/dial";
import { formatWhen } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { usePhone } from "../phone/PhoneProvider";

export function Messages() {
  const { t, locale } = useI18n();
  const { peer: peerParam } = useParams();
  const peer = peerParam ? decodeURIComponent(peerParam) : null;
  const convs = useAsync(() => api.conversations(), []);
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  return (
    <div className={`split${peer || composing ? " split--detail" : ""}`}>
      <section className="split__list" aria-label={t("messages.title")}>
        <PageHeader
          title={t("messages.title")}
          actions={
            <button type="button" className="btn btn--primary btn--sm" onClick={() => { setComposing(true); navigate("/messages"); }}>
              <Icon name="plus" size={16} /> {t("messages.new")}
            </button>
          }
        />
        <ErrorNote error={convs.error} onRetry={convs.reload} />
        {convs.loading && !convs.data ? <Loading /> : null}
        {convs.data && convs.data.conversations.length === 0 ? <Empty>{t("messages.empty")}</Empty> : null}
        <ul className="list">
          {convs.data?.conversations.map((c: ConversationDto) => (
            <li key={c.peer}>
              <Link
                to={`/messages/${encodeURIComponent(c.peer)}`}
                className={`list__row${peer === c.peer ? " is-active" : ""}`}
                aria-current={peer === c.peer ? "page" : undefined}
                onClick={() => setComposing(false)}
              >
                <span className="avatar" aria-hidden="true">
                  {formatPhone(c.peer).slice(0, 3)}
                </span>
                <span className="list__main">
                  <span className="list__title">
                    {formatPhone(c.peer)}
                  </span>
                  <span className="list__sub list__ellipsis">
                    {c.lastMessage.direction === "outbound" ? `${t("messages.you")} ` : ""}
                    {c.lastMessage.preview}
                  </span>
                </span>
                <span className="list__meta">{formatWhen(c.lastMessageAt, locale, t("common.yesterday"))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="split__detail" aria-label={t("messages.thread")}>
        {composing && !peer ? (
          <NewMessage
            onCancel={() => setComposing(false)}
            onSent={(to) => {
              setComposing(false);
              convs.reload();
              navigate(`/messages/${encodeURIComponent(to)}`);
            }}
          />
        ) : peer ? (
          <Thread key={peer} peer={peer} ourNumber={convs.data?.conversations.find((c) => c.peer === peer)?.ourNumber} onSent={convs.reload} />
        ) : (
          <Empty>{t("messages.pick")}</Empty>
        )}
      </section>
    </div>
  );
}

function useOurNumber(hint?: string): string | undefined {
  const { me } = useSession();
  return hint ?? me?.numbers.find((n) => n.state === "active" || n.state === "locked")?.e164 ?? me?.numbers[0]?.e164;
}

function NewMessage({ onCancel, onSent }: { onCancel: () => void; onSent: (to: string) => void }) {
  const { t } = useI18n();
  const from = useOurNumber();
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const dest = toDialable(to);
    if (!dest || dest === "911") return setError("messages.invalidTo");
    if (!from) return setError("messages.noNumber");
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage({ from, to: dest, body: body.trim() });
      onSent(dest);
    } catch (err) {
      setError(toErrorKey(err));
      setBusy(false);
    }
  };

  return (
    <form className="thread" onSubmit={submit}>
      <header className="thread__head">
        <button type="button" className="icon-btn" onClick={onCancel} aria-label={t("common.back")}>
          <Icon name="back" />
        </button>
        <h2>{t("messages.new")}</h2>
      </header>
      <div className="stack pad">
        <label htmlFor="new-to">{t("messages.to")}</label>
        <input id="new-to" className="input" type="tel" inputMode="tel" placeholder={t("messages.toPlaceholder")} value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
      </div>
      <div className="thread__spacer" />
      <ErrorNote error={error} />
      <Composer value={body} onChange={setBody} busy={busy} />
    </form>
  );
}

function Composer({ value, onChange, busy }: { value: string; onChange: (v: string) => void; busy: boolean }) {
  const { t } = useI18n();
  return (
    <div className="composer">
      <label htmlFor="composer" className="sr-only">
        {t("messages.placeholder")}
      </label>
      <textarea
        id="composer"
        className="input composer__input"
        rows={1}
        maxLength={1600}
        placeholder={t("messages.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button type="submit" className="btn btn--primary" disabled={busy || !value.trim()} aria-label={t("messages.send")}>
        <Icon name="send" size={18} />
      </button>
    </div>
  );
}

function Thread({ peer, ourNumber, onSent }: { peer: string; ourNumber?: string; onSent: () => void }) {
  const { t, locale } = useI18n();
  const { prepare } = usePhone();
  const from = useOurNumber(ourNumber);
  // Newest first from the API; kept newest-first here and reversed for display.
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TKey | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async (c?: string) => {
    setLoading(true);
    try {
      const page = await api.messages(peer, c);
      setMessages((prev) => (c ? [...prev, ...page.messages] : page.messages));
      setCursor(page.nextCursor);
      setError(null);
      if (!c) requestAnimationFrame(() => endRef.current?.scrollIntoView?.({ block: "end" }));
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    api
      .suggestions(peer)
      .then((s) => setSuggestions(s.suggestions))
      .catch(() => setSuggestions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!from || !body.trim()) return;
    setBusy(true);
    try {
      const m = await api.sendMessage({ from, to: peer, body: body.trim() });
      setMessages((prev) => [m, ...prev]);
      setBody("");
      setSuggestions([]);
      setError(null);
      onSent();
      requestAnimationFrame(() => endRef.current?.scrollIntoView?.({ block: "end" }));
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const ordered = [...messages].reverse();
  return (
    <form className="thread" onSubmit={send}>
      <header className="thread__head">
        <Link to="/messages" className="icon-btn thread__back" aria-label={t("common.back")}>
          <Icon name="back" />
        </Link>
        <h2>{formatPhone(peer)}</h2>
        <button type="button" className="icon-btn" onClick={() => prepare(peer)} aria-label={t("messages.call")}>
          <Icon name="phone" />
        </button>
      </header>
      <div className="thread__scroll" aria-live="polite">
        {cursor ? (
          <button type="button" className="btn btn--ghost btn--sm thread__older" onClick={() => void load(cursor)} disabled={loading}>
            {t("messages.loadEarlier")}
          </button>
        ) : null}
        {loading && messages.length === 0 ? <Loading /> : null}
        {ordered.map((m) => (
          <div key={m.id} className={`bubble bubble--${m.direction === "outbound" ? "out" : "in"}`}>
            {m.spamLabel ? <Badge tone="warn">{t("spam.message")}</Badge> : null}
            <p>{m.body}</p>
            <span className="bubble__meta">
              {formatWhen(m.createdAt, locale, t("common.yesterday"))}
              {m.direction === "outbound" && (m.status === "failed" || m.status === "undelivered") ? ` · ${t("messages.notDelivered")}` : ""}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ErrorNote error={error} />
      {suggestions.length > 0 ? (
        <div className="chips" role="group" aria-label={t("messages.suggestions")}>
          <Icon name="sparkle" size={16} />
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setBody(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <Composer value={body} onChange={setBody} busy={busy} />
    </form>
  );
}
