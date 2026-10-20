import type { ReactNode } from "react";
import type { Viewport } from "next";
import { inter, montserrat } from "./fonts";
import { adsenseClient } from "./adsTxt.ts";
import { CONSENT_KEY } from "./consent.ts";
import "../styles/globals.css";
import "../styles/phase2.css";
import "../styles/home.css";

export const viewport: Viewport = {
  themeColor: "#060D1F",
  width: "device-width",
  initialScale: 1,
};

const ADSENSE_CLIENT = adsenseClient(process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID);

// Law 25: before any choice, Google gets "denied" for ad storage and personalisation (Consent Mode v2) and
// AdSense is asked for non-personalised ads. The banner (components/ConsentBanner) updates both on a choice.
// The ad tag is injected by this same script so it can never run before the defaults (Next hoists async tags).
function adsBootstrap(client: string): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;
var c=null;try{c=localStorage.getItem(${JSON.stringify(CONSENT_KEY)})}catch(e){}var g=c==="granted"?"granted":"denied";
gtag("consent","default",{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:"denied"});
(window.adsbygoogle=window.adsbygoogle||[]).requestNonPersonalizedAds=g==="granted"?0:1;
var s=document.createElement("script");s.async=true;s.crossOrigin="anonymous";
s.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}";document.head.appendChild(s);`;
}

export function RootHtml({ lang, children }: { lang: "fr-CA" | "en-CA"; children: ReactNode }) {
  return (
    <html lang={lang} className={`${montserrat.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available before first paint, so scroll-reveal never hides content without JS. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        {ADSENSE_CLIENT ? (
          <>
            <meta name="google-adsense-account" content={ADSENSE_CLIENT} />
            <script dangerouslySetInnerHTML={{ __html: adsBootstrap(ADSENSE_CLIENT) }} />
          </>
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
