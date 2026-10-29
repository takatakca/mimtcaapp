// Team members: invite by email (the person claims the invitation after signing in), roles.
import type { BusinessMember, BusinessRole } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { useStepUp } from "../../components/StepUp";
import { Badge, Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { useAsync } from "../../lib/useAsync";
import { useBusiness } from "./shared";

type InvitableRole = Exclude<BusinessRole, "owner">;
const ROLE_KEY: Record<BusinessRole, TKey> = { owner: "biz.role.owner", admin: "biz.role.admin", member: "biz.role.member" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function Members() {
  const { t } = useI18n();
  const { id, canAdmin, biz } = useBusiness();
  const list = useAsync(() => api.members(id), [id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [msg, setMsg] = useState<TKey | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) return setEmailError(t("biz.members.invalidEmail"));
    setEmailError(null);
    try {
      const m = await api.inviteMember(id, { email: email.trim().toLowerCase(), role });
      list.setData((d) => d && { members: [...d.members, m] });
      setEmail("");
      setMsg("biz.members.invited");
    } catch (err) {
      setMsg(toErrorKey(err));
    }
  };

  const changeRole = async (m: BusinessMember, next: InvitableRole) => {
    try {
      const saved = await api.updateMember(id, m.id, { role: next });
      list.setData((d) => d && { members: d.members.map((x) => (x.id === saved.id ? saved : x)) });
    } catch (err) {
      setMsg(toErrorKey(err));
    }
  };

  const remove = async (m: BusinessMember) => {
    if (!window.confirm(t("biz.members.removeConfirm", { who: m.email ?? m.id }))) return;
    try {
      await api.removeMember(id, m.id);
      list.setData((d) => d && { members: d.members.filter((x) => x.id !== m.id) });
    } catch (err) {
      setMsg(toErrorKey(err));
    }
  };

  return (
    <>
    <section className="card" aria-labelledby="mem-h">
      <h2 id="mem-h" className="card__title">
        {t("biz.nav.members")}
      </h2>
      <p className="muted small">{t("biz.members.intro")}</p>
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading ? <Loading /> : null}
      {list.data && list.data.members.length === 0 ? <Empty>{t("common.empty")}</Empty> : null}
      <ul className="list">
        {list.data?.members.map((m) => (
          <li key={m.id} className="list__row">
            <span className="list__main">
              <span className="list__title">{m.email ?? t("biz.members.noEmail")}</span>
              <span className="list__sub">
                {m.status === "invited" ? <Badge tone="warn">{t("biz.members.pending")}</Badge> : <Badge tone="ok">{t("biz.members.active")}</Badge>}
              </span>
            </span>
            {canAdmin && m.role !== "owner" ? (
              <span className="row">
                <label htmlFor={`role-${m.id}`} className="sr-only">
                  {t("biz.members.role")}
                </label>
                <select id={`role-${m.id}`} className="input input--narrow" value={m.role} onChange={(e) => void changeRole(m, e.target.value as InvitableRole)}>
                  <option value="admin">{t("biz.role.admin")}</option>
                  <option value="member">{t("biz.role.member")}</option>
                </select>
                <button type="button" className="icon-btn" onClick={() => void remove(m)} aria-label={t("biz.members.remove", { who: m.email ?? m.id })}>
                  <Icon name="trash" />
                </button>
              </span>
            ) : (
              <Badge tone="muted">{t(ROLE_KEY[m.role])}</Badge>
            )}
          </li>
        ))}
      </ul>
      {canAdmin ? (
        <form className="form-grid" onSubmit={invite} noValidate>
          <Field id="inv-email" label={t("biz.members.email")} error={emailError}>
            <input id="inv-email" className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="inv-role" label={t("biz.members.role")}>
            <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)}>
              <option value="member">{t("biz.role.member")}</option>
              <option value="admin">{t("biz.role.admin")}</option>
            </select>
          </Field>
          <div className="form-grid__actions">
            <button type="submit" className="btn btn--primary">
              {t("biz.members.invite")}
            </button>
          </div>
        </form>
      ) : null}
      {msg ? (
        <p className={msg === "biz.members.invited" ? "ok-text" : "note note--error"} role="status">
          {t(msg)}
        </p>
      ) : null}
    </section>
    {biz.role === "owner" ? <BusinessSecurityCard businessId={id} /> : null}
    </>
  );
}

/** « Exiger une clé d'accès » for owners and admins (require_strong_auth, docs/MIMT-SECURITY.md). Owner only. */
function BusinessSecurityCard({ businessId }: { businessId: string }) {
  const { t } = useI18n();
  const policy = useAsync(() => api.businessSecurity(businessId), [businessId]);
  const { guard, dialog } = useStepUp();
  const [msg, setMsg] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await guard(() => api.setBusinessSecurity(businessId, { requireStrongAuth: on }));
      policy.reload();
      setMsg("security.business.saved");
    } catch (e) {
      setMsg(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="bizsec-h">
      <h2 id="bizsec-h" className="card__title">
        {t("security.business.title")}
      </h2>
      <label className="switch-row">
        <span>
          <span className="switch-row__label">{t("security.business.toggle")}</span>
          <span className="field__hint">{t("security.business.hint")}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={policy.data?.requireStrongAuth ?? false}
          disabled={busy || !policy.data}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </label>
      {msg ? (
        <p className={msg === "security.business.saved" ? "ok-text" : "note note--error"} role="status">
          {t(msg)}
        </p>
      ) : null}
      <ErrorNote error={policy.error} />
      <Link to="/compte/securite" className="btn btn--ghost btn--sm">
        {t("security.open")}
      </Link>
      {dialog}
    </section>
  );
}

