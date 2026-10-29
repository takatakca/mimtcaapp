// /accueil — « Centre de contrôle » (docs/MIMT-APP-STUDY-2026-10-28.md): the signed-in home. Greeting and numbers,
// Disponible / Ne pas déranger, where calls go, what callers hear, what to handle (voicemails, missed calls, texts),
// the wallet, the « Démarrage » checklist and account alerts. Read-only views of existing routes; the only write is
// the availability toggle (PATCH /v1/me dnd, same as /compte/appels). Each card loads on its own: one failing route
// never blanks the page.
import { DEFAULT_CALL_SETTINGS, planHas, type MissionDto, type PointsResponse } from "@mimt/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Icon, type IconName } from "../components/Icon";
import { Badge, ErrorNote, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatPhone } from "../lib/dial";
import { formatWhen } from "../lib/format";
import {
  accountAlerts,
  availability,
  buildTodo,
  firstName,
  formatHhmm,
  markSetupCelebrated,
  routeSummary,
  setupCelebrated,
  TODO_LIMIT,
  type TodoItem,
} from "../lib/home";
import { missionLabel, missionProgress, missionTarget } from "../lib/missions";
import { formatPoints } from "../lib/points";
import { useAsync, type AsyncState } from "../lib/useAsync";
import { usePhone } from "../phone/PhoneProvider";

export function Home() {
  const { t } = useI18n();
  const { me } = useSession();
  const { setPanelOpen } = usePhone();
  // One read for the wallet card and the « points owed » alert.
  const points = useAsync(() => api.points(), []);
  if (!me) return <Loading />;
  const name = firstName(me.user.displayName);
  return (
    <div className="page page--wide home">
      <header className="home__head">
        <div className="home__intro">
          <p className="kicker">{t("home.kicker")}</p>
          <h1>{name ? t("home.hello", { name }) : t("home.helloAnon")}</h1>
          <Numbers />
        </div>
        <div className="home__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setPanelOpen(true)}>
            <Icon name="dialpad" size={18} />
            {t("home.compose")}
          </button>
          <Link to="/messages" className="btn btn--ghost btn--sm">
            <Icon name="messages" size={18} />
            {t("home.newText")}
          </Link>
        </div>
      </header>

      <AvailabilityCard />
      <Alerts points={points} />

      <div className="home__body">
        <div className="home__panels">
          <RoutingCard />
          <GreetingCard />
          <WalletCard points={points} />
        </div>
        <div className="home__work">
          <TodoCard />
          <StartCard />
        </div>
      </div>

      <p className="home__help muted small">
        {t("home.help")} <Link to="/aide">{t("home.helpAction")}</Link>
      </p>
    </div>
  );
}

function Kicker({ children }: { children: string }) {
  return <p className="kicker">{children}</p>;
}

function Numbers() {
  const { t } = useI18n();
  const { me } = useSession();
  const numbers = me?.numbers ?? [];
  if (!numbers.length) return <p className="muted small">{t("home.noNumber")}</p>;
  return (
    <ul className="home__numbers" aria-label={t("home.numbers")}>
      {numbers.map((n) => (
        <li key={n.id} className="home__number">
          <span className={`status-dot${n.state === "active" ? " status-dot--ok" : " status-dot--warn"}`} aria-hidden="true" />
          <span className="home__number-value">{formatPhone(n.e164)}</span>
          <span className="muted small">{t(n.state === "active" ? "home.numberActive" : "home.numberPending")}</span>
        </li>
      ))}
    </ul>
  );
}

/** Disponible / Ne pas déranger. Quiet hours set in /compte/appels are shown, not edited here (they would be lost). */
function AvailabilityCard() {
  const { t, lang } = useI18n();
  const { me, refreshMe } = useSession();
  const settings = me?.callSettings ?? DEFAULT_CALL_SETTINGS;
  const state = availability(settings);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TKey | null>(null);

  const set = async (enabled: boolean) => {
    if (busy || enabled === state.dnd) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.updateMe({ dnd: { enabled, schedule: null } });
      await refreshMe();
      setStatus("home.avail.saved");
    } catch (e) {
      setStatus(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card hud-card home-avail${state.dnd ? " home-avail--dnd" : ""}`} aria-labelledby="avail-h">
      <div className="home-avail__text">
        <h2 id="avail-h" className="kicker kicker--plain">
          {t("home.avail.label")}
        </h2>
        <p className="home-avail__state">
          <span className={`status-dot${state.dnd ? " status-dot--warn" : " status-dot--ok"}`} aria-hidden="true" />
          {t(state.dnd ? "home.avail.dnd" : "home.avail.available")}
        </p>
        <p className="muted small">
          {state.schedule
            ? `${t(state.schedule.now ? "home.avail.scheduledNow" : "home.avail.scheduled", {
                from: formatHhmm(state.schedule.from, lang),
                to: formatHhmm(state.schedule.to, lang),
              })}. ${t("home.avail.scheduledHint")}`
            : t(state.dnd ? "home.avail.dndHint" : "home.avail.availableHint")}
        </p>
      </div>
      {state.schedule ? (
        <Link to="/compte/appels" className="btn btn--ghost btn--sm">
          {t("home.route.edit")}
        </Link>
      ) : (
        <div className="segmented" role="group" aria-label={t("home.avail.label")}>
          <button type="button" className="segmented__opt" aria-pressed={!state.dnd} disabled={busy} onClick={() => void set(false)}>
            {t("home.avail.available")}
          </button>
          <button
            type="button"
            className="segmented__opt segmented__opt--dnd"
            aria-pressed={state.dnd}
            disabled={busy}
            onClick={() => void set(true)}
          >
            {t("home.avail.dnd")}
          </button>
        </div>
      )}
      {status === "home.avail.saved" ? (
        <span className="sr-only" role="status">
          {t(status)}
        </span>
      ) : status ? (
        <ErrorNote error={status} />
      ) : null}
    </section>
  );
}

type PointsState = AsyncState<PointsResponse>;

function Alerts({ points }: { points: PointsState }) {
  const { t, lang } = useI18n();
  const { me } = useSession();
  if (!me) return null;
  const alerts = accountAlerts(me, points.data?.owed ?? 0).map((a) => ({
    ...a,
    text: t(a.text, { points: formatPoints(points.data?.owed ?? 0, lang) }),
    action: { to: a.to, label: t(a.action) },
  }));
  if (!alerts.length) return null;
  return (
    <section className="home-alerts" aria-labelledby="alerts-h">
      <h2 id="alerts-h" className="sr-only">
        {t("home.alerts.title")}
      </h2>
      <ul className="stack">
        {alerts.map((a) => (
          <li key={a.key} className={`note note--${a.tone} home-alert`}>
            <Icon name="alert" size={18} />
            <span>{a.text}</span>
            {a.action ? (
              <Link to={a.action.to} className="btn btn--ghost btn--sm">
                {a.action.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoutingCard() {
  const { t } = useI18n();
  const { me } = useSession();
  const settings = me?.callSettings ?? DEFAULT_CALL_SETTINGS;
  const route = routeSummary(settings);
  const canForward = me ? planHas(me.account.plan, "call_forwarding") : false;
  const main = me?.numbers[0]?.e164;
  const steps: Array<{ icon: IconName; text: string }> = [];
  if (route.kind === "dnd") steps.push({ icon: "voicemail", text: t("home.route.dnd") });
  else if (route.kind === "always")
    steps.push({
      icon: "phone",
      text: t("home.route.always", { number: formatPhone(route.target) }),
    });
  else if (route.kind === "no_answer") {
    steps.push({
      icon: "phone",
      text: t("home.route.noAnswer", {
        number: formatPhone(route.target),
        seconds: route.timeoutS,
      }),
    });
  } else steps.push({ icon: "screen", text: t("home.route.apps") });
  if (route.kind !== "dnd") steps.push({ icon: "voicemail", text: t("home.route.fallback") });

  return (
    <section className="card hud-card home-panel" aria-labelledby="route-h">
      <Kicker>{t("home.route.kicker")}</Kicker>
      <h2 id="route-h" className="card__title">
        {t("home.route.title")}
      </h2>
      {main ? <p className="muted small">{t("home.route.for", { number: formatPhone(main) })}</p> : null}
      <ol className="route-steps">
        {steps.map((s, i) => (
          <li key={i} className="route-steps__item">
            <span className="route-steps__icon" aria-hidden="true">
              <Icon name={s.icon} size={18} />
            </span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
      {!canForward && route.kind === "apps" ? <p className="muted small">{t("home.route.planHint")}</p> : null}
      <p className="muted small">{t("home.route.emergency")}</p>
      <Link
        to="/compte/appels"
        className="btn btn--ghost btn--sm home-panel__cta"
        aria-label={`${t("home.route.edit")} : ${t("home.route.title")}`}
      >
        {t("home.route.edit")}
      </Link>
    </section>
  );
}

function GreetingCard() {
  const { t, locale } = useI18n();
  const settings = useAsync(() => api.voicemailSettings(), []);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const s = settings.data;
  const greeting = s?.greeting ?? null;

  const toggle = () => {
    if (!greeting?.url) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const a = audio.current ?? new Audio(greeting.url);
    audio.current = a;
    a.onended = () => setPlaying(false);
    a.currentTime = 0;
    void a.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  };

  return (
    <section className="card hud-card home-panel" aria-labelledby="greet-h">
      <Kicker>{t("home.greeting.kicker")}</Kicker>
      <h2 id="greet-h" className="card__title">
        {t("home.greeting.title")}
      </h2>
      {settings.loading && !s ? <Loading /> : null}
      {settings.error && !s ? <ErrorNote error={settings.error} onRetry={settings.reload} /> : null}
      {s ? (
        <div className="greeting">
          <span className="greeting__wave" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <div>
            <p className="greeting__name">{t(greeting ? "home.greeting.custom" : "home.greeting.default")}</p>
            <p className="muted small">
              {greeting
                ? t("home.greeting.updated", {
                    date: new Date(greeting.updatedAt).toLocaleDateString(locale, { day: "numeric", month: "long" }),
                  })
                : t("home.greeting.defaultHint")}
            </p>
          </div>
          {greeting?.url ? (
            <button
              type="button"
              className="icon-btn greeting__play"
              aria-label={t(playing ? "home.greeting.stop" : "home.greeting.play")}
              onClick={toggle}
            >
              <Icon name={playing ? "pause" : "play"} />
            </button>
          ) : null}
        </div>
      ) : null}
      {s && !s.available.greeting ? <p className="muted small">{t("home.greeting.notInPlan")}</p> : null}
      {s?.emailEnabled ? <p className="muted small">{t("home.greeting.email")}</p> : null}
      <Link to="/compte/appels" className="btn btn--ghost btn--sm home-panel__cta">
        {t("home.greeting.change")}
      </Link>
    </section>
  );
}

function WalletCard({ points }: { points: PointsState }) {
  const { t, lang } = useI18n();
  const p = points.data;
  return (
    <section className="card hud-card home-panel home-wallet" aria-labelledby="wallet-h">
      <Kicker>{t("home.wallet.kicker")}</Kicker>
      <h2 id="wallet-h" className="card__title">
        {t("home.wallet.title")}
      </h2>
      {points.loading && !p ? <Loading /> : null}
      {points.error && !p ? <ErrorNote error={points.error} onRetry={points.reload} /> : null}
      {p ? (
        <>
          <p className="home-wallet__balance">
            <span className="home-wallet__value">{formatPoints(p.balance, lang)}</span>{" "}
            <span className="muted">{t("home.wallet.points")}</span>
          </p>
          <p className="muted small">
            {t("home.wallet.minutes", {
              minutes: formatPoints(Math.floor(p.balance / 10), lang),
            })}
          </p>
          {!p.enabled ? <p className="muted small">{t("home.wallet.off")}</p> : null}
        </>
      ) : null}
      <div className="row row--wrap home-panel__cta">
        <Link to="/missions" className="btn btn--primary btn--sm">
          {t("home.wallet.earn")}
        </Link>
        <Link to="/points" className="btn btn--ghost btn--sm">
          {t("home.wallet.redeem")}
        </Link>
      </div>
    </section>
  );
}

const TODO_META: Record<TodoItem["kind"], { icon: IconName; label: TKey }> = {
  voicemail: { icon: "voicemail", label: "home.todo.voicemail" },
  missed: { icon: "phone", label: "home.todo.missed" },
  text: { icon: "messages", label: "home.todo.unanswered" },
};

function TodoCard() {
  const { t, locale } = useI18n();
  const { prepare } = usePhone();
  const vms = useAsync(() => api.voicemails(), []);
  const calls = useAsync(() => api.calls(), []);
  const convs = useAsync(() => api.conversations(), []);
  const loading = (vms.loading && !vms.data) || (calls.loading && !calls.data) || (convs.loading && !convs.data);
  const error = vms.error ?? calls.error ?? convs.error;
  const { items, counts } = buildTodo({
    voicemails: vms.data?.voicemails,
    calls: calls.data?.calls,
    conversations: convs.data?.conversations,
  });
  const shown = items.slice(0, TODO_LIMIT);
  const retry = () => {
    if (vms.error) vms.reload();
    if (calls.error) calls.reload();
    if (convs.error) convs.reload();
  };

  return (
    <section className="card hud-card home-todo" aria-labelledby="todo-h">
      <div className="card__head">
        <div>
          <Kicker>{t("home.todo.kicker")}</Kicker>
          <h2 id="todo-h" className="card__title">
            {t("home.todo.title")}
          </h2>
        </div>
        <dl className="home-stats">
          <Stat to="/messagerie" label={t("home.todo.statVoicemail")} value={counts.voicemail} />
          <Stat to="/appels?filtre=missed" label={t("home.todo.statMissed")} value={counts.missed} />
          <Stat to="/messages" label={t("home.todo.statTexts")} value={counts.text} />
        </dl>
      </div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={error} onRetry={retry} /> : null}
      {!loading && !items.length && !error ? (
        <p className="home-todo__empty">
          <Icon name="sparkle" size={18} /> {t("home.todo.empty")}
        </p>
      ) : null}
      {shown.length ? (
        <ul className="todo-list" aria-label={t("home.todo.list")}>
          {shown.map((item) => {
            const meta = TODO_META[item.kind];
            const who = item.peer ? formatPhone(item.peer) : t("home.todo.unknown");
            return (
              <li key={item.key} className={`todo todo--${item.kind}${item.urgent ? " todo--urgent" : ""}`}>
                <span className="todo__icon" aria-hidden="true">
                  <Icon name={meta.icon} size={18} />
                </span>
                <div className="todo__body">
                  <p className="todo__head">
                    <span className="todo__who">{who}</span>
                    <span className="todo__kind">{t(meta.label)}</span>
                    {item.ai ? <Badge tone="info">{t("home.todo.aiSummary")}</Badge> : null}
                    {item.urgent ? <Badge tone="error">{t("voicemail.urgencyHigh")}</Badge> : null}
                    <time className="todo__when muted small" dateTime={item.at}>
                      {formatWhen(item.at, locale, t("common.yesterday"))}
                    </time>
                  </p>
                  {item.kind !== "missed" ? <p className="todo__snippet">{item.snippet ?? t("home.todo.noTranscript")}</p> : null}
                </div>
                <div className="todo__actions">
                  {item.peer ? (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      aria-label={t("home.todo.callBackLabel", { number: who })}
                      onClick={() => prepare(item.peer!)}
                    >
                      <Icon name="phone" size={16} />
                      {t("home.todo.callBack")}
                    </button>
                  ) : null}
                  {item.kind === "voicemail" ? (
                    <Link to="/messagerie" className="btn btn--ghost btn--sm">
                      {t("home.todo.listen")}
                    </Link>
                  ) : item.peer ? (
                    <Link
                      to={`/messages/${encodeURIComponent(item.peer)}`}
                      className="btn btn--ghost btn--sm"
                      aria-label={t("home.todo.replyLabel", { number: who })}
                    >
                      {t("home.todo.reply")}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function Stat({ to, label, value }: { to: string; label: string; value: number }) {
  return (
    <div className={`home-stat${value ? " home-stat--on" : ""}`}>
      <dt>
        <Link to={to}>{label}</Link>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/** « Démarrage »: the missions as a checklist. Celebrated once at 100 %, then the card goes away. */
function StartCard() {
  const { t, lang } = useI18n();
  const data = useAsync(() => api.missions(), []);
  const [hidden] = useState(setupCelebrated);
  const r = data.data;
  const progress = r ? missionProgress(r.missions) : null;
  const complete = Boolean(progress && progress.total > 0 && progress.done === progress.total);
  useEffect(() => {
    if (complete) markSetupCelebrated();
  }, [complete]);
  if (hidden || (data.error && !r)) return null;
  if (!r || !progress)
    return (
      <section className="card hud-card home-start" aria-busy="true">
        <Loading />
      </section>
    );

  return (
    <section className={`card hud-card home-start${complete ? " home-start--done" : ""}`} aria-labelledby="start-h">
      <Kicker>{t("home.start.kicker")}</Kicker>
      <h2 id="start-h" className="card__title">
        {t("home.start.title")}
      </h2>
      <div className="home-start__meter">
        <div
          className="usage__track home-start__track"
          role="progressbar"
          aria-label={t("home.start.progressLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <div className="usage__fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <span className="home-start__count">
          {t("home.start.progress", {
            done: progress.done,
            total: progress.total,
          })}
        </span>
      </div>
      {complete ? (
        <div className="celebrate" role="status">
          <span className="celebrate__burst" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ ["--i" as string]: i }} />
            ))}
          </span>
          <p className="celebrate__text">{t("home.start.done")}</p>
        </div>
      ) : (
        <ul className="checklist">
          {r.missions.map((m) => (
            <ChecklistItem key={m.id} mission={m} lang={lang} />
          ))}
        </ul>
      )}
      <Link to="/missions" className="btn btn--ghost btn--sm home-panel__cta">
        {t("home.start.all")}
      </Link>
    </section>
  );
}

function ChecklistItem({ mission: m, lang }: { mission: MissionDto; lang: "fr" | "en" }) {
  const { t } = useI18n();
  const label = missionLabel(m.id, lang);
  const target = m.status === "todo" ? missionTarget(m.id, lang) : null;
  const to = target && target.to.startsWith("#") ? `/missions${target.to}` : target?.to;
  return (
    <li className={`checklist__item checklist__item--${m.status}`}>
      <span className="checklist__mark" aria-hidden="true">
        {m.status === "todo" ? "" : "✓"}
      </span>
      <span className="checklist__label">
        {label}
        <span className="sr-only">
          {" "}
          · {t(m.status === "todo" ? "mission.status.todo" : m.status === "pending" ? "mission.status.pending" : "mission.status.done")}
        </span>
      </span>
      {to ? (
        target?.external ? (
          <a href={to} target="_blank" rel="noopener noreferrer" className="checklist__go" aria-label={`${t("home.start.go")} : ${label}`}>
            {t("home.start.go")}
          </a>
        ) : (
          <Link to={to} className="checklist__go" aria-label={`${t("home.start.go")} : ${label}`}>
            {t("home.start.go")}
          </Link>
        )
      ) : null}
    </li>
  );
}
