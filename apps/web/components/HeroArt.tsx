import type { Lang } from "@/lib/site";

/**
 * Original animated phone illustration for the home hero: a text conversation types itself in,
 * an incoming Wi‑Fi call pulses and the voice wave moves. Pure SVG + CSS (styles/home.css);
 * every animation stops under prefers-reduced-motion and the final frame stays readable.
 */
export function HeroArt({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const t = fr
    ? {
        title: "Illustration de l'application MIMT : une conversation texto et un appel Wi‑Fi entrant",
        status: "MIMT · Wi‑Fi",
        contact: "Camille",
        b1: "Salut! Tu arrives quand?",
        b2: "Vers 18 h, je t'appelle!",
        b3: "Parfait, à tantôt!",
        typing: "Camille écrit…",
        call: "Appel entrant",
        number: "+1 514 ··· ····",
        answer: "Répondre",
        chipSpam: "Spam probable",
        chipVm: "Résumé IA : « Rappel rendez-vous »",
        chipPort: "Transfert de numéro : 0 $",
      }
    : {
        title: "Illustration of the MIMT app: a text conversation and an incoming Wi‑Fi call",
        status: "MIMT · Wi‑Fi",
        contact: "Camille",
        b1: "Hey! When do you land?",
        b2: "Around 6, I'll call you!",
        b3: "Perfect, see you!",
        typing: "Camille is typing…",
        call: "Incoming call",
        number: "+1 514 ··· ····",
        answer: "Answer",
        chipSpam: "Likely spam",
        chipVm: "AI summary: “Appointment reminder”",
        chipPort: "Number transfer: $0",
      };
  return (
    <div className="hero-art">
      <div className="hero-art__halo" aria-hidden="true" />
      <svg className="hero-phone" viewBox="0 0 300 600" role="img" aria-labelledby="hero-phone-title">
        <title id="hero-phone-title">{t.title}</title>
        <defs>
          <linearGradient id="hp-screen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0E2350" />
            <stop offset="1" stopColor="#071330" />
          </linearGradient>
          <linearGradient id="hp-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#29C3FF" />
            <stop offset="0.5" stopColor="#1F8BFF" stopOpacity="0.5" />
            <stop offset="1" stopColor="#29C3FF" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="hp-me" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1F8BFF" />
            <stop offset="1" stopColor="#1565D8" />
          </linearGradient>
          <linearGradient id="hp-call" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#13306A" />
            <stop offset="1" stopColor="#0F2A5E" />
          </linearGradient>
        </defs>

        {/* body */}
        <rect x="10" y="6" width="280" height="588" rx="46" fill="#0B1B3D" stroke="url(#hp-edge)" strokeWidth="3" />
        <rect x="24" y="20" width="252" height="560" rx="34" fill="url(#hp-screen)" />
        <rect x="112" y="32" width="76" height="20" rx="10" fill="#060D1F" />

        {/* status + contact header */}
        <text x="44" y="46" fill="#B8C4D3" fontSize="11" fontFamily="var(--font-body), sans-serif">
          9:41
        </text>
        <text x="256" y="46" textAnchor="end" fill="#29C3FF" fontSize="10" fontWeight="600" fontFamily="var(--font-body), sans-serif">
          {t.status}
        </text>
        <circle cx="60" cy="88" r="17" fill="#1565D8" />
        <text x="60" y="94" textAnchor="middle" fill="#F5F8FC" fontSize="15" fontWeight="800" fontFamily="var(--font-heading), sans-serif">
          C
        </text>
        <text x="86" y="85" fill="#F5F8FC" fontSize="14" fontWeight="700" fontFamily="var(--font-heading), sans-serif">
          {t.contact}
        </text>
        <text x="86" y="101" fill="#B8C4D3" fontSize="10.5" fontFamily="var(--font-body), sans-serif">
          +1 438 ··· ····
        </text>
        <line x1="40" y1="120" x2="260" y2="120" stroke="#B8C4D3" strokeOpacity="0.15" />

        {/* conversation */}
        <g className="hp-bubble hp-bubble--1">
          <rect x="40" y="138" width="172" height="40" rx="16" fill="#1A3466" />
          <text x="56" y="163" fill="#F5F8FC" fontSize="11.5" fontFamily="var(--font-body), sans-serif">
            {t.b1}
          </text>
        </g>
        <g className="hp-bubble hp-bubble--2">
          <rect x="86" y="190" width="174" height="40" rx="16" fill="url(#hp-me)" />
          <text x="100" y="215" fill="#FFFFFF" fontSize="11.5" fontFamily="var(--font-body), sans-serif">
            {t.b2}
          </text>
        </g>
        <g className="hp-typing">
          <rect x="40" y="242" width="64" height="30" rx="15" fill="#1A3466" />
          <circle className="hp-dot hp-dot--1" cx="58" cy="257" r="3.5" fill="#B8C4D3" />
          <circle className="hp-dot hp-dot--2" cx="72" cy="257" r="3.5" fill="#B8C4D3" />
          <circle className="hp-dot hp-dot--3" cx="86" cy="257" r="3.5" fill="#B8C4D3" />
        </g>
        <g className="hp-bubble hp-bubble--3">
          <rect x="40" y="242" width="132" height="38" rx="16" fill="#1A3466" />
          <text x="56" y="266" fill="#F5F8FC" fontSize="11.5" fontFamily="var(--font-body), sans-serif">
            {t.b3}
          </text>
        </g>

        {/* incoming call card */}
        <g className="hp-call">
          <rect x="36" y="318" width="228" height="176" rx="24" fill="url(#hp-call)" stroke="#29C3FF" strokeOpacity="0.35" />
          <text x="150" y="346" textAnchor="middle" fill="#29C3FF" fontSize="10" fontWeight="700" letterSpacing="2" fontFamily="var(--font-body), sans-serif">
            {t.call.toUpperCase()}
          </text>
          <circle className="hp-ring" cx="150" cy="384" r="24" fill="none" stroke="#29C3FF" strokeWidth="2" />
          <circle cx="150" cy="384" r="22" fill="#1565D8" />
          <path
            d="M141 376h5l2.5 5.5-2.8 1.7a12 12 0 0 0 6.3 6.3l1.7-2.8 5.5 2.5v5a2 2 0 0 1-2 2 19 19 0 0 1-18.2-18.2 2 2 0 0 1 2-2"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <text x="150" y="430" textAnchor="middle" fill="#F5F8FC" fontSize="15" fontWeight="800" fontFamily="var(--font-heading), sans-serif">
            {t.number}
          </text>
          <g className="hp-wave" fill="#29C3FF">
            {[8, 16, 24, 14, 28, 18, 30, 20, 12, 22, 10, 16, 8].map((h, i) => (
              <rect key={i} className="hp-bar" style={{ animationDelay: `${(i % 5) * 0.12}s` }} x={96 + i * 8.6} y={456 - h / 2} width="4.5" height={h} rx="2.25" />
            ))}
          </g>
        </g>

        {/* answer button */}
        <g className="hp-answer">
          <rect x="76" y="512" width="148" height="44" rx="22" fill="#1F8BFF" />
          <text x="150" y="539" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="700" fontFamily="var(--font-heading), sans-serif">
            {t.answer}
          </text>
        </g>
      </svg>

      <p className="hero-chip hero-chip--spam" aria-hidden="true">
        <span className="hero-chip__dot" /> {t.chipSpam}
      </p>
      <p className="hero-chip hero-chip--vm" aria-hidden="true">
        <span className="hero-chip__icon">✦</span> {t.chipVm}
      </p>
      <p className="hero-chip hero-chip--port" aria-hidden="true">
        <span className="hero-chip__icon">⇄</span> {t.chipPort}
      </p>
    </div>
  );
}

/** Night skyline silhouette for the bottom of the hero (decorative, original drawing). */
export function Skyline() {
  return (
    <svg className="skyline" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M0 120V88h40V70h22v18h18V52h30v36h14V76h26v12h20V40h12l6-14 6 14h12v48h18V64h34v24h16V30h36v58h14V72h24v16h22V58l40-30 40 30v30h18V68h28v20h20V46h30v42h16V60h22v28h26V20l6-8 6 8v68h20V70h30v18h18V54h40v34h14V74h22v14h24V36h34v52h18V66h26v22h20V48h30v40h16V62h26v26h22V44l18-20 18 20v44h18V70h28v18h20V58h32v30h14V74h22v14h24V40h30v48h16V68h28v20h20V54h34v34h18V72h24v16h22V50h28v38h16V66h30v22h20V120z"
      />
    </svg>
  );
}
