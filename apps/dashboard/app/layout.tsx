import type { ReactNode } from "react";
import "./globals.css";

const NAV = [
  { href: "/", label: "Vue d'ensemble" },
  { href: "/utilisateurs", label: "Utilisateurs" },
  { href: "/utilisation", label: "Utilisation" },
  { href: "/revenus", label: "Revenus" },
  { href: "/sante", label: "Santé" },
  { href: "/soutien", label: "Soutien" },
];

export const metadata = { title: "MIMT — Tableau de bord", description: "Staff dashboard (lecture seule)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <p className="brand">
              MIMT <span>dashboard</span>
            </p>
            <p className="brand-sub">Lecture seule · personnel</p>
            <nav className="nav">
              {NAV.map((n) => (
                <a key={n.href} href={n.href}>
                  {n.label}
                </a>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
