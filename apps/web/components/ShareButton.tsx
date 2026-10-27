"use client";

import { useState } from "react";
import { SITE_URL, type Lang } from "@/lib/site";

/** "Partagez MIMT": the phone's share sheet when there is one, otherwise copies the link. No reward is tied to sharing. */
export function ShareButton({ lang, className = "btn btn--outline-light btn--sm" }: { lang: Lang; className?: string }) {
  const fr = lang === "fr";
  const [note, setNote] = useState<string | null>(null);
  const url = fr ? `${SITE_URL}/` : `${SITE_URL}/en/`;

  const share = async () => {
    const data = {
      title: "MIMT",
      text: fr ? "Un vrai numéro canadien, des appels et textos sur cellulaire et ordinateur. Fait au Québec." : "A real Canadian number, calls and texts on phone and computer. Made in Québec.",
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote(fr ? "Lien copié" : "Link copied");
    } catch {
      setNote(url);
    }
  };

  return (
    <span className="share">
      <button type="button" className={className} onClick={() => void share()}>
        {fr ? "Partager MIMT" : "Share MIMT"}
      </button>
      {note ? (
        <span className="share__note" role="status">
          {note}
        </span>
      ) : null}
    </span>
  );
}
