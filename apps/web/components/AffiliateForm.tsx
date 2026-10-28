"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  AFFILIATE_AUDIENCE_SIZES,
  AFFILIATE_CHANNELS,
  AFFILIATE_PRIVACY_NOTICE_VERSION,
  AFFILIATE_PROVINCES,
  type AffiliateApplicationRequest,
  type AffiliateAudienceSize,
  type AffiliateChannel,
  type AffiliateProvince,
} from "@mimt/shared";
import { API_URL, CONTACT_EMAIL, href, type Lang } from "@/lib/site";

const CHANNEL_LABELS: Record<AffiliateChannel, { fr: string; en: string }> = {
  website: { fr: "Site Web ou blogue", en: "Website or blog" },
  social: { fr: "Réseaux sociaux", en: "Social media" },
  video: { fr: "Vidéo (YouTube, TikTok…)", en: "Video (YouTube, TikTok…)" },
  newsletter: { fr: "Infolettre (abonnés consentants)", en: "Newsletter (opted-in subscribers)" },
  podcast: { fr: "Balado", en: "Podcast" },
  in_person: { fr: "En personne (clients, réseau)", en: "In person (clients, network)" },
  community: { fr: "Communauté ou association", en: "Community or association" },
  other: { fr: "Autre", en: "Other" },
};

const AUDIENCE_LABELS: Record<AffiliateAudienceSize, { fr: string; en: string }> = {
  lt_1k: { fr: "Moins de 1 000 personnes", en: "Fewer than 1,000 people" },
  "1k_10k": { fr: "1 000 à 10 000 personnes", en: "1,000 to 10,000 people" },
  "10k_50k": { fr: "10 000 à 50 000 personnes", en: "10,000 to 50,000 people" },
  gt_50k: { fr: "Plus de 50 000 personnes", en: "More than 50,000 people" },
};

const PROVINCE_LABELS: Record<AffiliateProvince, { fr: string; en: string }> = {
  QC: { fr: "Québec", en: "Québec" },
  ON: { fr: "Ontario", en: "Ontario" },
  BC: { fr: "Colombie-Britannique", en: "British Columbia" },
  AB: { fr: "Alberta", en: "Alberta" },
  MB: { fr: "Manitoba", en: "Manitoba" },
  SK: { fr: "Saskatchewan", en: "Saskatchewan" },
  NS: { fr: "Nouvelle-Écosse", en: "Nova Scotia" },
  NB: { fr: "Nouveau-Brunswick", en: "New Brunswick" },
  NL: { fr: "Terre-Neuve-et-Labrador", en: "Newfoundland and Labrador" },
  PE: { fr: "Île-du-Prince-Édouard", en: "Prince Edward Island" },
  YT: { fr: "Yukon", en: "Yukon" },
  NT: { fr: "Territoires du Nord-Ouest", en: "Northwest Territories" },
  NU: { fr: "Nunavut", en: "Nunavut" },
};

/** Law 25 notice shown above the consent box (its version is stored with the application). */
export function privacyNotice(lang: Lang): string[] {
  return lang === "fr"
    ? [
        "Qui : MIMT (GROUPE TAKATAK) recueille ces renseignements. Seule l'équipe qui gère le programme y a accès.",
        "Pourquoi : étudier votre demande, préparer et gérer votre contrat d'agent affilié, vous payer et produire les déclarations fiscales exigées.",
        "Combien de temps : une demande refusée est supprimée 90 jours après la décision. Si vous devenez agent affilié, nous gardons ces renseignements pendant le contrat et le temps exigé par les lois fiscales.",
        "Sécurité : votre nom, vos coordonnées et vos numéros de taxes sont chiffrés dans notre base de données.",
        `Vos droits : vous pouvez consulter, corriger ou retirer votre demande en écrivant à ${CONTACT_EMAIL}.`,
      ]
    : [
        "Who: MIMT (GROUPE TAKATAK) collects this information. Only the team running the program can see it.",
        "Why: to review your application, prepare and manage your affiliate agreement, pay you and file the required tax slips.",
        "How long: a declined application is deleted 90 days after the decision. If you become an affiliate, we keep this information for the term of the agreement and as long as tax laws require.",
        "Security: your name, contact details and tax numbers are encrypted in our database.",
        `Your rights: you can access, correct or withdraw your application by writing to ${CONTACT_EMAIL}.`,
      ];
}

type Status = { kind: "idle" | "sending" | "ok" | "error"; message?: string };

/** Application form of /affilies/ (POST /v1/public/affiliates/applications). */
export function AffiliateForm({ lang }: { lang: Lang }) {
  const uid = useId();
  const fr = lang === "fr";
  const shownAt = useRef(Date.now());
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);
  const id = (n: string) => `${uid}-${n}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (k: string) => String(data.get(k) ?? "").trim();
    const channels = data.getAll("channels").map(String) as AffiliateChannel[];
    if (channels.length === 0) {
      setStatus({ kind: "error", message: fr ? "Choisissez au moins une façon de faire connaître MIMT." : "Choose at least one way you would promote MIMT." });
      return;
    }
    const body: AffiliateApplicationRequest = {
      legalName: text("legalName"),
      ...(text("businessName") ? { businessName: text("businessName") } : {}),
      email: text("email"),
      phone: text("phone"),
      province: text("province") as AffiliateProvince,
      channels,
      audienceSize: text("audienceSize") as AffiliateAudienceSize,
      ...(text("gstNumber") ? { gstNumber: text("gstNumber") } : {}),
      ...(text("qstNumber") ? { qstNumber: text("qstNumber") } : {}),
      locale: fr ? "fr-CA" : "en-CA",
      consents: { privacyNotice: true, privacyNoticeVersion: AFFILIATE_PRIVACY_NOTICE_VERSION, marketing: data.get("marketing") === "on" },
      adult: true,
      website: text("website"),
      elapsedMs: Date.now() - shownAt.current,
    };
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`${API_URL}/v1/public/affiliates/applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 202 || res.ok) {
        form.reset();
        setStatus({
          kind: "ok",
          message: fr
            ? "Merci! Votre demande est reçue. Nous l'étudions et vous écrivons par courriel avec la suite, dont le contrat à signer en ligne."
            : "Thank you! Your application is in. We will review it and email you the next steps, including the agreement to sign online.",
        });
        return;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ kind: "error", message: errorText(res.status, err.error, fr) });
    } catch {
      setStatus({ kind: "error", message: errorText(0, undefined, fr) });
    }
  }

  return (
    <form className="lead-form lead-form--affiliate" onSubmit={onSubmit}>
      <div className="lead-form__grid">
        <div className="field">
          <label htmlFor={id("legalName")}>
            {fr ? "Nom légal" : "Legal name"}
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          </label>
          <input id={id("legalName")} name="legalName" required maxLength={120} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor={id("businessName")}>{fr ? "Nom d'entreprise (facultatif)" : "Business name (optional)"}</label>
          <input id={id("businessName")} name="businessName" maxLength={120} autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor={id("email")}>
            {fr ? "Courriel" : "Email"}
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          </label>
          <input id={id("email")} name="email" type="email" required maxLength={200} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor={id("phone")}>
            {fr ? "Téléphone (cellulaire de préférence)" : "Phone (mobile preferred)"}
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          </label>
          <input id={id("phone")} name="phone" type="tel" required maxLength={30} autoComplete="tel" aria-describedby={id("phone-hint")} />
          <p className="form-note" id={id("phone-hint")}>
            {fr ? "Ce numéro ouvre votre espace affilié dans l'app MIMT (connexion par texto)." : "This number opens your affiliate area in the MIMT app (sign-in by text)."}
          </p>
        </div>
        <div className="field">
          <label htmlFor={id("province")}>
            {fr ? "Province ou territoire" : "Province or territory"}
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          </label>
          <select id={id("province")} name="province" required defaultValue="QC">
            {AFFILIATE_PROVINCES.map((p) => (
              <option key={p} value={p}>
                {PROVINCE_LABELS[p][lang]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("audienceSize")}>
            {fr ? "Taille de votre audience" : "Size of your audience"}
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          </label>
          <select id={id("audienceSize")} name="audienceSize" required defaultValue="lt_1k">
            {AFFILIATE_AUDIENCE_SIZES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a][lang]}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="field field--wide check-group">
          <legend>
            {fr ? "Comment ferez-vous connaître MIMT?" : "How would you promote MIMT?"}
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          </legend>
          {AFFILIATE_CHANNELS.map((c) => (
            <div className="check" key={c}>
              <input id={id(`ch-${c}`)} name="channels" type="checkbox" value={c} />
              <label htmlFor={id(`ch-${c}`)}>{CHANNEL_LABELS[c][lang]}</label>
            </div>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor={id("gstNumber")}>{fr ? "Numéro de TPS/TVH (facultatif)" : "GST/HST number (optional)"}</label>
          <input id={id("gstNumber")} name="gstNumber" maxLength={20} placeholder="123456789 RT 0001" inputMode="text" />
        </div>
        <div className="field">
          <label htmlFor={id("qstNumber")}>{fr ? "Numéro de TVQ (facultatif)" : "QST number (optional)"}</label>
          <input id={id("qstNumber")} name="qstNumber" maxLength={20} placeholder="1234567890 TQ 0001" inputMode="text" />
        </div>
      </div>

      <div className="hp" aria-hidden="true">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="affiliate-notice" id={id("notice")}>
        <h3>{fr ? "Avis de confidentialité (Loi 25)" : "Privacy notice (Québec Law 25)"}</h3>
        <ul>
          {privacyNotice(lang).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>
          <a href={href(lang, "privacy")}>{fr ? "Politique de confidentialité complète" : "Full privacy policy"}</a>
        </p>
      </div>

      <div className="check">
        <input id={id("privacy")} name="privacy" type="checkbox" required aria-describedby={id("notice")} />
        <label htmlFor={id("privacy")}>
          {fr
            ? "J'ai lu l'avis de confidentialité et j'accepte que MIMT utilise ces renseignements pour étudier ma demande et gérer mon contrat. *"
            : "I have read the privacy notice and agree that MIMT uses this information to review my application and manage my agreement. *"}
        </label>
      </div>
      <div className="check">
        <input id={id("adult")} name="adult" type="checkbox" required />
        <label htmlFor={id("adult")}>{fr ? "J'atteste avoir 18 ans ou plus. *" : "I confirm I am 18 or older. *"}</label>
      </div>
      <div className="check">
        <input id={id("marketing")} name="marketing" type="checkbox" defaultChecked={false} />
        <label htmlFor={id("marketing")}>
          {fr
            ? "Facultatif : j'accepte de recevoir par courriel des nouvelles et des offres de MIMT (GROUPE TAKATAK, info@mimt.ca). Je peux me désabonner en tout temps. Ce choix n'a aucun effet sur ma demande."
            : "Optional: I agree to receive news and offers by email from MIMT (GROUPE TAKATAK, info@mimt.ca). I can unsubscribe at any time. This choice has no effect on my application."}
        </label>
      </div>

      <button className="btn btn--primary" type="submit" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? (fr ? "Envoi…" : "Sending…") : fr ? "Envoyer ma demande" : "Send my application"}
      </button>
      <p className={`form-status form-status--${status.kind}`} role="status" aria-live="polite">
        {status.message ?? ""}
      </p>
    </form>
  );
}

function errorText(status: number, code: string | undefined, fr: boolean): string {
  if (status === 429) return fr ? `Trop de demandes depuis votre connexion. Réessayez plus tard ou écrivez à ${CONTACT_EMAIL}.` : `Too many applications from your connection. Try later or write to ${CONTACT_EMAIL}.`;
  if (code === "invalid_phone") return fr ? "Entrez un numéro de téléphone canadien à 10 chiffres." : "Enter a 10-digit Canadian phone number.";
  if (status === 400) return fr ? "Vérifiez les champs : un renseignement n'est pas valide (courriel, TPS ou TVQ)." : "Check the fields: something is not valid (email, GST or QST).";
  return fr ? `L'envoi n'a pas fonctionné. Réessayez ou écrivez-nous à ${CONTACT_EMAIL}.` : `Sending failed. Try again or write to us at ${CONTACT_EMAIL}.`;
}
