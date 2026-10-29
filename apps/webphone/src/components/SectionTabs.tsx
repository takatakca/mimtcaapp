// Tabs that join pages under one sidebar entry: « Portefeuille » (balance + missions) and « Boutique » (offers,
// orders, number transfer), so each stays reachable from the other on phones too.
import { NavLink } from "react-router";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";

function SectionTabs({ label, items }: { label: TKey; items: Array<{ to: string; label: TKey }> }) {
  const { t } = useI18n();
  return (
    <nav className="subnav section-tabs" aria-label={t(label)}>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end className={({ isActive }) => `subnav__link${isActive ? " is-active" : ""}`}>
          {t(i.label)}
        </NavLink>
      ))}
    </nav>
  );
}

export function WalletTabs() {
  return (
    <SectionTabs
      label="nav.walletTabs"
      items={[
        { to: "/points", label: "nav.walletBalance" },
        { to: "/missions", label: "nav.walletEarn" },
      ]}
    />
  );
}

export function ShopTabs() {
  return (
    <SectionTabs
      label="nav.shopTabs"
      items={[
        { to: "/services/offres", label: "nav.offers" },
        { to: "/services/commandes", label: "nav.orders" },
        { to: "/services/transfert", label: "nav.portIn" },
      ]}
    />
  );
}
