// Paramètres › Sécurité (/compte/securite): connected devices, « Déconnecter partout ailleurs », passkeys.
// API: apps/api/src/routes/security.ts. Spec and Law 25 notes: docs/MIMT-SECURITY.md.
import type { AuthMethod, PasskeyDto, SessionDto } from "@mimt/shared";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Icon } from "../components/Icon";
import { StepUpPanel, useStepUp } from "../components/StepUp";
import { Badge, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { createPasskey, isPasskeyCancel, passkeysSupported } from "../lib/passkeys";
import { useAsync } from "../lib/useAsync";

const METHOD: Record<AuthMethod, TKey> = {
  sms: "security.method.sms",
  passkey: "security.method.passkey",
  takatak: "security.method.takatak",
  legacy: "security.method.legacy",
};

/** "il y a 3 min", "il y a 2 h"… */
export function useAgo() {
  const { t } = useI18n();
  return (iso: string, now = Date.now()) => {
    const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
    if (min < 1) return t("security.justNow");
    if (min < 60) return t("security.minutesAgo", { n: min });
    if (min < 48 * 60) return t("security.hoursAgo", { n: Math.round(min / 60) });
    return t("security.daysAgo", { n: Math.round(min / 1440) });
  };
}

export function Security() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader
        title={t("security.title")}
        sub={t("security.lead")}
        actions={
          <Link to="/compte" className="btn btn--ghost btn--sm">
            {t("account.title")}
          </Link>
        }
      />
      <SessionsSection />
      <PasskeysSection />
    </div>
  );
}

function deviceLabel(device: string, unknown: string) {
  return device.replace(/Unknown/g, "").replace(/^\s*·\s*|\s*·\s*$/g, "").trim() || unknown;
}

function SessionsSection() {
  const { t, locale } = useI18n();
  const { signOut } = useSession();
  const ago = useAgo();
  const list = useAsync(() => api.sessions(), []);
  const [error, setError] = useState<TKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = list.data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current);

  const revoke = async (s: SessionDto) => {
    if (s.current && !window.confirm(t("security.sessions.signOutCurrentConfirm"))) return;
    setBusy(s.id);
    setError(null);
    try {
      await api.revokeSession(s.id);
      if (s.current) {
        await signOut();
        return;
      }
      list.reload();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(null);
    }
  };
  const revokeOthers = async () => {
    if (!window.confirm(t("security.sessions.signOutOthersConfirm"))) return;
    setBusy("others");
    setError(null);
    try {
      const r = await api.revokeOtherSessions();
      setMessage(t("security.sessions.signedOutOthers", { count: r.revoked }));
      list.reload();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-labelledby="sessions-h">
      <h2 id="sessions-h" className="card__title">
        {t("security.sessions.title")}
      </h2>
      <p className="muted small">{t("security.sessions.lead")}</p>
      {list.loading ? <Loading /> : null}
      <ul className="list" aria-label={t("security.sessions.title")}>
        {sessions.map((s) => {
          const device = deviceLabel(s.device, t("security.sessions.unknownDevice"));
          return (
            <li key={s.id}>
              <div className="list__row">
                <Icon name={/iOS|Android/.test(s.device) ? "phone" : "screen"} size={20} />
                <div className="list__main">
                  <span className="list__title">
                    {device} {s.current ? <Badge tone="info">{t("security.sessions.current")}</Badge> : null}
                  </span>
                  <span className="muted small">
                    {t("security.sessions.lastSeen", { when: ago(s.lastSeenAt) })} · {t(METHOD[s.method])}
                    {s.network ? ` · ${t("security.sessions.network", { network: s.network })}` : ""}
                  </span>
                  <span className="muted small">{t("security.sessions.since", { date: new Date(s.createdAt).toLocaleDateString(locale) })}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy !== null}
                  aria-label={t("security.sessions.signOutLabel", { device })}
                  onClick={() => void revoke(s)}
                >
                  {t("security.sessions.signOut")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {list.data ? (
        others.length ? (
          <button type="button" className="btn btn--danger" disabled={busy !== null} onClick={() => void revokeOthers()}>
            <Icon name="logout" size={16} /> {t("security.sessions.signOutOthers")}
          </button>
        ) : (
          <p className="muted small">{t("security.sessions.onlyThis")}</p>
        )
      ) : null}
      {message ? (
        <p className="ok-text" role="status">
          {message}
        </p>
      ) : null}
      <ErrorNote error={error ?? list.error} />
      <p className="field__hint">{t("security.sessions.minimisation")}</p>
    </section>
  );
}

function PasskeysSection() {
  const { t, locale } = useI18n();
  const ago = useAgo();
  const status = useAsync(() => api.securityStatus(), []);
  const keys = useAsync(() => api.passkeys(), []);
  const { guard, dialog } = useStepUp();
  const [error, setError] = useState<TKey | null>(null);
  const [message, setMessage] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const supported = passkeysSupported();
  const enabled = status.data?.passkeysEnabled ?? true;

  const act = async (fn: () => Promise<void>, done: TKey) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await guard(fn);
      setMessage(done);
      keys.reload();
      status.reload();
    } catch (e) {
      if (!isPasskeyCancel(e)) setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    act(async () => {
      const options = await api.passkeyRegisterOptions();
      const response = await createPasskey(options);
      await api.passkeyRegisterVerify({ challengeToken: options.challengeToken, response });
    }, "security.passkeys.added");
  const remove = (k: PasskeyDto) => {
    if (!window.confirm(t("security.passkeys.removeConfirm"))) return;
    void act(() => api.deletePasskey(k.id), "security.passkeys.removed");
  };

  const remaining = status.data?.recentAuthRemainingS ?? 0;
  return (
    <section className="card" aria-labelledby="passkeys-h">
      <h2 id="passkeys-h" className="card__title">
        {t("security.passkeys.title")}
      </h2>
      <p className="muted small">{t("security.passkeys.lead")}</p>
      {status.data?.strongAuthRequiredByBusiness ? <p className="note note--info">{t("security.passkeys.businessRequired")}</p> : null}
      {!enabled ? <p className="note note--warn">{t("security.passkeys.off")}</p> : !supported ? <p className="note note--warn">{t("security.passkeys.unsupported")}</p> : null}
      {keys.loading ? <Loading /> : null}
      {keys.data && keys.data.passkeys.length === 0 ? <p className="muted">{t("security.passkeys.none")}</p> : null}
      <ul className="list" aria-label={t("security.passkeys.title")}>
        {keys.data?.passkeys.map((k) => (
          <li key={k.id}>
            <div className="list__row">
              <Icon name="lock" size={20} />
              <div className="list__main">
                <span className="list__title">
                  {k.name} {k.backedUp ? <Badge tone="muted">{t("security.passkeys.synced")}</Badge> : null}
                </span>
                <span className="muted small">
                  {t("security.passkeys.created", { date: new Date(k.createdAt).toLocaleDateString(locale) })}
                  {k.lastUsedAt ? ` · ${t("security.passkeys.lastUsed", { when: ago(k.lastUsedAt) })}` : ""}
                </span>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={t("security.passkeys.removeLabel", { name: k.name })} onClick={() => remove(k)}>
                {t("security.passkeys.remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {enabled && supported ? (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void add()}>
          {t("security.passkeys.add")}
        </button>
      ) : null}
      {message ? (
        <p className="ok-text" role="status">
          {t(message)}
        </p>
      ) : null}
      <ErrorNote error={error ?? keys.error} />

      <div className="stack">
        {remaining > 0 ? (
          <p className="muted small">{t("security.stepUp.active", { minutes: Math.ceil(remaining / 60) })}</p>
        ) : confirming ? (
          <StepUpPanel
            onDone={() => {
              setConfirming(false);
              setMessage("security.stepUp.done");
              status.reload();
            }}
            onCancel={() => setConfirming(false)}
          />
        ) : status.data ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(true)}>
            {t("security.stepUp.confirmNow")}
          </button>
        ) : null}
      </div>
      {dialog}
    </section>
  );
}
