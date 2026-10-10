import type { ReactNode } from "react";
import type { Viewport } from "next";
import { inter, montserrat } from "./fonts";
import "../styles/globals.css";
import "../styles/phase2.css";

export const viewport: Viewport = {
  themeColor: "#060D1F",
  width: "device-width",
  initialScale: 1,
};

export function RootHtml({ lang, children }: { lang: "fr-CA" | "en-CA"; children: ReactNode }) {
  return (
    <html lang={lang} className={`${montserrat.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
