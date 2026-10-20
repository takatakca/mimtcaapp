import type { Lang } from "@/lib/site";

/**
 * Home hero visual: a real screenshot of the MIMT web app on a phone (demo data, no real customer), in a simple
 * device frame. Captured from apps/webphone in demo mode; refresh public/screens/*.webp when the app changes.
 */
export function HeroArt({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <figure className="hero-art">
      <div className="hero-art__halo" aria-hidden="true" />
      <div className="device device--phone">
        <img
          src="/screens/app-phone-conversation.webp"
          width={640}
          height={1313}
          alt={fr ? "L'app MIMT sur un téléphone : une conversation texto avec un client" : "The MIMT app on a phone: a text conversation with a customer"}
          fetchPriority="high"
        />
      </div>
      <figcaption className="hero-art__cap">{fr ? "L'app Web MIMT, données de démonstration" : "The MIMT web app, demo data"}</figcaption>
    </figure>
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
