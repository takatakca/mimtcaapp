import type { ReactNode } from "react";
import type { Viewport } from "next";
import { inter, montserrat } from "./fonts";
import { adsenseClient } from "./adsTxt.ts";
import { tagBootstrap, tagIds } from "./tags.ts";
import "../styles/globals.css";
import "../styles/phase2.css";
import "../styles/home.css";
import "../styles/human.css";

export const viewport: Viewport = {
  themeColor: "#060D1F",
  width: "device-width",
  initialScale: 1,
};

const ADSENSE_CLIENT = adsenseClient(process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID);
const TAGS = tagIds(process.env, ADSENSE_CLIENT);

export function RootHtml({ lang, children }: { lang: "fr-CA" | "en-CA"; children: ReactNode }) {
  return (
    <html lang={lang} className={`${montserrat.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available before first paint, so scroll-reveal never hides content without JS. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        {ADSENSE_CLIENT ? <meta name="google-adsense-account" content={ADSENSE_CLIENT} /> : null}
        {/* Consent Mode defaults, then AdSense / GA4 / Google Ads (lib/tags.ts). */}
        <script dangerouslySetInnerHTML={{ __html: tagBootstrap(TAGS) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
