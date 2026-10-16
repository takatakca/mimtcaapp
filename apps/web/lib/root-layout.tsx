import type { ReactNode } from "react";
import type { Viewport } from "next";
import { inter, montserrat } from "./fonts";
import "../styles/globals.css";
import "../styles/phase2.css";
import "../styles/home.css";

export const viewport: Viewport = {
  themeColor: "#060D1F",
  width: "device-width",
  initialScale: 1,
};

export function RootHtml({ lang, children }: { lang: "fr-CA" | "en-CA"; children: ReactNode }) {
  return (
    <html lang={lang} className={`${montserrat.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available before first paint, so scroll-reveal never hides content without JS. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
