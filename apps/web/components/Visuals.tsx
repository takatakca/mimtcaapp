import type { ReactNode } from "react";
import type { Lang } from "@/lib/site";

/** Abstract phone illustration drawn for MIMT (decorative). */
export function PhoneMockup({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <svg className="phone-mockup" viewBox="0 0 320 560" role="img" aria-labelledby="phone-title">
      <title id="phone-title">{fr ? "Illustration de l'application MIMT sur un téléphone" : "Illustration of the MIMT app on a phone"}</title>
      <defs>
        <radialGradient id="pm-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#1F8BFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1F8BFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pm-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0E2350" />
          <stop offset="1" stopColor="#081430" />
        </linearGradient>
        <linearGradient id="pm-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#29C3FF" />
          <stop offset="1" stopColor="#1F8BFF" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="270" rx="160" ry="260" fill="url(#pm-glow)" />
      <rect x="52" y="20" width="216" height="440" rx="36" fill="#0B1B3D" stroke="url(#pm-edge)" strokeWidth="2.5" />
      <rect x="64" y="34" width="192" height="412" rx="26" fill="url(#pm-screen)" />
      <rect x="132" y="44" width="56" height="8" rx="4" fill="#060D1F" />
      {/* caller */}
      <text x="160" y="92" textAnchor="middle" fill="#B8C4D3" fontSize="11" letterSpacing="2" fontFamily="var(--font-body), sans-serif">
        {fr ? "APPEL WI‑FI" : "WI‑FI CALL"}
      </text>
      <circle cx="160" cy="146" r="34" fill="#13306A" stroke="#29C3FF" strokeOpacity="0.6" />
      <text x="160" y="155" textAnchor="middle" fill="#F5F8FC" fontSize="24" fontWeight="700" fontFamily="var(--font-heading), sans-serif">
        M
      </text>
      <text x="160" y="208" textAnchor="middle" fill="#F5F8FC" fontSize="18" fontWeight="700" fontFamily="var(--font-heading), sans-serif">
        +1 514 ··· ····
      </text>
      <text x="160" y="230" textAnchor="middle" fill="#29C3FF" fontSize="12" fontFamily="var(--font-body), sans-serif">
        02:14
      </text>
      {/* wave */}
      <g fill="#1F8BFF">
        {[6, 14, 22, 12, 28, 18, 34, 20, 26, 10, 18, 8, 14, 6].map((h, i) => (
          <rect key={i} x={98 + i * 9} y={268 - h / 2} width="5" height={h} rx="2.5" opacity={0.55 + (i % 3) * 0.15} />
        ))}
      </g>
      {/* controls */}
      <g>
        <circle cx="110" cy="330" r="20" fill="#13306A" />
        <circle cx="160" cy="330" r="20" fill="#13306A" />
        <circle cx="210" cy="330" r="20" fill="#13306A" />
        <path d="M104 324h12v12h-12z" fill="none" stroke="#B8C4D3" strokeWidth="2" />
        <circle cx="160" cy="330" r="6" fill="none" stroke="#B8C4D3" strokeWidth="2" />
        <path d="M203 330h14M210 323v14" stroke="#B8C4D3" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="160" cy="396" r="24" fill="#E5484D" />
      <path d="M148 398c8-7 16-7 24 0" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {/* floating message card */}
      <g transform="translate(196 236)">
        <rect width="118" height="58" rx="14" fill="#F5F8FC" />
        <text x="14" y="24" fill="#060D1F" fontSize="11" fontWeight="700" fontFamily="var(--font-heading), sans-serif">
          {fr ? "Nouveau texto" : "New text"}
        </text>
        <text x="14" y="42" fill="#3A4A63" fontSize="10.5" fontFamily="var(--font-body), sans-serif">
          {fr ? "On se voit à 18 h?" : "See you at 6?"}
        </text>
      </g>
      <g transform="translate(6 128)">
        <rect width="104" height="46" rx="12" fill="#1565D8" />
        <text x="14" y="28" fill="#F5F8FC" fontSize="11" fontWeight="700" fontFamily="var(--font-heading), sans-serif">
          {fr ? "Messagerie" : "Voicemail"} · 1
        </text>
      </g>
    </svg>
  );
}

export function StoreBadges({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  // Not links: the apps are not published yet.
  return (
    <ul className="store-badges" aria-label={fr ? "Applications mobiles" : "Mobile apps"}>
      <li className="store-badge" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
          <path
            fill="currentColor"
            d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.3z"
          />
        </svg>
        <span>
          <small>{fr ? "Bientôt sur" : "Coming soon to"}</small>
          App Store
        </span>
      </li>
      <li className="store-badge" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
          <path fill="currentColor" d="M4 2.8v18.4c0 .4.4.7.8.5l15.8-9.2c.4-.2.4-.8 0-1L4.8 2.3c-.4-.2-.8.1-.8.5zm2 3.2 9 6-9 6V6z" />
        </svg>
        <span>
          <small>{fr ? "Bientôt sur" : "Coming soon to"}</small>
          Google Play
        </span>
      </li>
    </ul>
  );
}

/** Small inline icons for feature cards. */
export type IconName =
  | "number"
  | "wifi"
  | "voicemail"
  | "free"
  | "lock"
  | "sos"
  | "phone"
  | "team"
  | "desk"
  | "record"
  | "menu"
  | "admin"
  | "spark"
  | "shield"
  | "calendar"
  | "chat"
  | "globe"
  | "transfer"
  | "video"
  | "quebec"
  | "lang"
  | "tag";

export function Icon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<typeof name, ReactNode> = {
    number: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" {...common} /><path d="M10 18.5h4" {...common} /></>,
    wifi: <><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" {...common} /><circle cx="12" cy="19.5" r="1" fill="currentColor" /></>,
    voicemail: <><circle cx="6.5" cy="12" r="3.5" {...common} /><circle cx="17.5" cy="12" r="3.5" {...common} /><path d="M6.5 15.5h11" {...common} /></>,
    free: <><path d="M3 12l9-9h8v8l-9 9z" {...common} /><circle cx="15.5" cy="8.5" r="1.5" {...common} /></>,
    lock: <><rect x="4.5" y="10.5" width="15" height="10.5" rx="2" {...common} /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" {...common} /></>,
    sos: <><path d="M12 3l9 16H3z" {...common} /><path d="M12 10v4M12 17h0" {...common} /></>,
    phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" {...common} />,
    team: <><circle cx="8" cy="8" r="3" {...common} /><circle cx="17" cy="9" r="2.5" {...common} /><path d="M2.5 20a5.5 5.5 0 0 1 11 0M14 20a4 4 0 0 1 7.5-2" {...common} /></>,
    desk: <><rect x="2.5" y="4" width="19" height="12" rx="2" {...common} /><path d="M8 20h8M12 16v4" {...common} /></>,
    record: <><circle cx="12" cy="12" r="8.5" {...common} /><circle cx="12" cy="12" r="3.5" fill="currentColor" /></>,
    menu: <path d="M4 6h16M4 12h10M4 18h13" {...common} />,
    admin: <><path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" {...common} /><path d="M8.5 12l2.5 2.5 4.5-5" {...common} /></>,
    spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...common} /><path d="M19 16v4M17 18h4" {...common} /></>,
    shield: <><path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" {...common} /><path d="M12 8v5M12 16h0" {...common} /></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" {...common} /><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2" {...common} /></>,
    chat: <><path d="M4 5h16v11H9l-5 4z" {...common} /><path d="M8 9.5h8M8 12.5h5" {...common} /></>,
    transfer: <><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" {...common} /></>,
    video: <><rect x="2.5" y="6" width="13" height="12" rx="2.5" {...common} /><path d="M15.5 10.5l6-3.5v10l-6-3.5" {...common} /></>,
    quebec: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" {...common} /><circle cx="12" cy="10" r="2.4" {...common} /></>,
    lang: <><path d="M3 5h9M7.5 3v2M5 5c.6 3.5 3 6 6 7.5M10 5c-.8 3.6-3 6.4-6.5 8" {...common} /><path d="M12.5 21l4-10 4 10M14 17.5h5" {...common} /></>,
    tag: <><path d="M3 12l9-9h8v8l-9 9z" {...common} /><path d="M9.5 14.5l5-5" {...common} /></>,
    globe: <><circle cx="12" cy="12" r="9" {...common} /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3" {...common} /></>,
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
