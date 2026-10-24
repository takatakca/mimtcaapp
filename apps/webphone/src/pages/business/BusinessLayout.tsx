// MIMT Affaires admin portal: /affaires/:businessId/… with a sub-navigation per PBX section.
import { PLANS } from "@mimt/shared";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { useSession } from "../../auth/SessionProvider";
import { Badge, Empty, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone } from "../../lib/dial";
import { needsBusinessSetup } from "../../lib/bizSetup";
import type { BusinessCtx } from "./shared";

const SECTIONS: Array<{ to: string; label: TKey; end?: boolean }> = [
  { to: "", label: "biz.nav.overview", end: true },
  { to: "postes", label: "biz.nav.extensions" },
  { to: "groupes", label: "biz.nav.ringGroups" },
  { to: "accueil", label: "biz.nav.ivr" },
  { to: "heures", label: "biz.nav.hours" },
  { to: "numeros", label: "biz.nav.numbers" },
  { to: "membres", label: "biz.nav.members" },
  { to: "enregistrements", label: "biz.nav.recordings" },
  { to: "receptionniste-ia", label: "biz.nav.ai" },
];

const ROLE_KEY: Record<BusinessCtx["biz"]["role"], TKey> = {
  owner: "biz.role.owner",
  admin: "biz.role.admin",
  member: "biz.role.member",
};

export function BusinessLayout() {
  const { t, lang } = useI18n();
  const { businessId = "" } = useParams();
  const { businesses, me } = useSession();
  const biz = businesses.find((b) => b.business.id === businessId);
  if (!biz) {
    return (
      <div className="page">
        <PageHeader title={t("biz.title")} />
        <Empty>{t("biz.notFound")}</Empty>
        {needsBusinessSetup(me, businesses) ? (
          <section className="card wiz-card">
            <p>{t("biz.new.notFoundCta")}</p>
            <Link className="btn btn--primary" to="/affaires/nouvelle">
              {t("biz.new.cta")}
            </Link>
          </section>
        ) : null}
      </div>
    );
  }
  const ctx: BusinessCtx = { id: businessId, biz, canAdmin: biz.role !== "member" };
  const plan = me && (me.account.plan === "business" || me.account.plan === "business_pro") ? PLANS[me.account.plan].name[lang] : null;
  const base = `/affaires/${encodeURIComponent(businessId)}`;

  return (
    <div className="page page--wide">
      <PageHeader
        title={biz.business.name}
        sub={
          <>
            {t("biz.title")}
            {plan ? ` · ${plan}` : ""}
            {biz.business.mainNumber ? ` · ${formatPhone(biz.business.mainNumber)}` : ""}{" "}
            <Badge tone={ctx.canAdmin ? "info" : "muted"}>{t(ROLE_KEY[biz.role])}</Badge>
          </>
        }
      />
      <nav className="subnav" aria-label={t("biz.nav.label")}>
        {SECTIONS.map((s) => (
          <NavLink key={s.to} to={s.to ? `${base}/${s.to}` : base} end={s.end} className={({ isActive }) => `subnav__link${isActive ? " is-active" : ""}`}>
            {t(s.label)}
          </NavLink>
        ))}
      </nav>
      {!ctx.canAdmin ? <p className="note note--info">{t("biz.readOnly")}</p> : null}
      <Outlet context={ctx} />
    </div>
  );
}
