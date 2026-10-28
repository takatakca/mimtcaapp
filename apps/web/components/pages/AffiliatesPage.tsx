import { AFFILIATE_ATTRIBUTION_DAYS, AFFILIATE_DEFAULTS, AFFILIATE_HOLD_DAYS, affiliateCommissionCents, formatCad, formatCommissionPct, PLANS } from "@mimt/shared";
import { AffiliateForm } from "@/components/AffiliateForm";
import { FaqList } from "@/components/FaqList";
import { PageHero, Shell } from "@/components/Shell";
import type { FaqItem } from "@/lib/faq";
import { faqPageLd } from "@/lib/seo";
import { href, type Lang } from "@/lib/site";

/** Commission example on Premium, from the shared prices and the default terms. */
export function affiliateExample(lang: Lang) {
  const monthly = PLANS.premium.monthlyPriceCents;
  const perMonth = affiliateCommissionCents(monthly, AFFILIATE_DEFAULTS.commissionBps);
  return {
    plan: formatCad(monthly, lang),
    perMonth: formatCad(perMonth, lang),
    total: formatCad(perMonth * AFFILIATE_DEFAULTS.durationMonths, lang),
  };
}

export function affiliateFaq(lang: Lang): FaqItem[] {
  const fr = lang === "fr";
  const pct = formatCommissionPct(AFFILIATE_DEFAULTS.commissionBps, lang);
  const threshold = formatCad(AFFILIATE_DEFAULTS.payoutThresholdCents, lang);
  return [
    {
      topic: "general",
      id: "aff-qui",
      q: fr ? "Qui peut devenir agent affilié?" : "Who can become an affiliate agent?",
      a: fr
        ? "Toute personne de 18 ans ou plus, ou toute entreprise, au Canada, qui peut faire connaître MIMT honnêtement : créateurs de contenu, consultants, commerces, associations. Nous étudions chaque demande."
        : "Anyone 18 or older, or any business, in Canada, who can promote MIMT honestly: content creators, consultants, shops, associations. We review every application.",
    },
    {
      topic: "general",
      id: "aff-calcul",
      q: fr ? "Comment la commission est-elle calculée?" : "How is the commission calculated?",
      a: fr
        ? `${pct} % des revenus nets de chaque facture d'abonnement payée par le client sur le Web, pendant ${AFFILIATE_DEFAULTS.durationMonths} mois à partir de sa première facture. Revenus nets : sans la TPS, la TVQ ni la taxe 9-1-1, et moins les remboursements. Les achats faits dans l'App Store ou sur Google Play et les achats ponctuels ne comptent pas pour l'instant.`
        : `${pct}% of the net revenue of each subscription invoice the customer pays on the web, for ${AFFILIATE_DEFAULTS.durationMonths} months from their first invoice. Net revenue: without GST, QST or the 9-1-1 tax, and less refunds. App Store and Google Play purchases and one-time purchases do not count for now.`,
    },
    {
      topic: "general",
      id: "aff-paiement",
      q: fr ? "Quand suis-je payé?" : "When am I paid?",
      a: fr
        ? `Chaque commission attend ${AFFILIATE_HOLD_DAYS} jours (remboursements et rétrofacturations), puis devient payable. Dès que votre solde payable atteint ${threshold}, nous vous payons par virement au plus tard le 15 du mois suivant.`
        : `Each commission waits ${AFFILIATE_HOLD_DAYS} days (refunds and chargebacks), then becomes payable. Once your payable balance reaches ${threshold}, we pay you by transfer by the 15th of the following month.`,
    },
    {
      topic: "general",
      id: "aff-attribution",
      q: fr ? "Comment sait-on qu'un client vient de moi?" : "How do you know a customer came from me?",
      a: fr
        ? `Par votre lien ou votre code. Le client doit être nouveau et payer son premier forfait dans les ${AFFILIATE_ATTRIBUTION_DAYS} jours suivant son premier clic. Si un client a utilisé plusieurs liens, le premier compte. Nos serveurs l'enregistrent eux-mêmes.`
        : `Through your link or code. The customer must be new and pay for their first plan within ${AFFILIATE_ATTRIBUTION_DAYS} days of their first click. If a customer used several links, the first one counts. Our servers record it themselves.`,
    },
    {
      topic: "general",
      id: "aff-soi",
      q: fr ? "Puis-je utiliser mon propre lien?" : "Can I use my own link?",
      a: fr
        ? "Non. Vos propres comptes, ceux d'une personne qui agit pour vous et ceux qui paient avec la même carte que vous ne donnent aucune commission."
        : "No. Your own accounts, those of someone acting for you and those paying with the same card as you earn no commission.",
    },
    {
      topic: "general",
      id: "aff-taxes",
      q: fr ? "Dois-je être inscrit à la TPS et à la TVQ?" : "Do I need to be registered for GST and QST?",
      a: fr
        ? "Pas pour faire la demande. Vos impôts et votre inscription aux taxes, lorsque la loi l'exige, sont votre responsabilité. Si vous êtes inscrit, donnez vos numéros : la TPS et la TVQ s'ajoutent à vos paiements. MIMT peut devoir déclarer les sommes versées aux autorités fiscales."
        : "Not to apply. Your income taxes and tax registration, when the law requires it, are your responsibility. If you are registered, give us your numbers: GST and QST are added to your payments. MIMT may have to report amounts paid to tax authorities.",
    },
    {
      topic: "general",
      id: "aff-divulgation",
      q: fr ? "Dois-je dire que je suis payé?" : "Do I have to say I am paid?",
      a: fr
        ? "Oui, chaque fois, avant le lien et de façon visible : par exemple « Lien affilié : je reçois une commission si vous vous abonnez » ou #partenariatpayé. C'est exigé par la Loi sur la concurrence et par votre contrat."
        : "Yes, every time, before the link and visibly: for example “Affiliate link: I earn a commission if you subscribe” or #paidpartnership. The Competition Act and your agreement require it.",
    },
    {
      topic: "general",
      id: "aff-contrat",
      q: fr ? "Comment se passe le contrat?" : "How does the agreement work?",
      a: fr
        ? "Si votre demande est acceptée, vous recevez le contrat d'agent affilié par courriel et le signez en ligne. Il est en français, avec une traduction anglaise sur demande. Votre lien fonctionne dès la signature, et votre espace affilié s'ouvre dans l'app MIMT avec le numéro de téléphone de votre demande."
        : "If your application is accepted, you receive the affiliate agreement by email and sign it online. It is in French, with an English translation on request. Your link works as soon as it is signed, and your affiliate area opens in the MIMT app with the phone number from your application.",
    },
  ];
}

/** /affilies/ — « Programme d'agents affiliés MIMT »: pitch, how it works, commission model, rules, FAQ, application. */
export function AffiliatesPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const pct = formatCommissionPct(AFFILIATE_DEFAULTS.commissionBps, lang);
  const months = AFFILIATE_DEFAULTS.durationMonths;
  const threshold = formatCad(AFFILIATE_DEFAULTS.payoutThresholdCents, lang);
  const ex = affiliateExample(lang);
  const faq = affiliateFaq(lang);
  return (
    <Shell lang={lang} page="affiliates" ld={[faqPageLd(lang, faq, "affiliates")]}>
      <PageHero
        photo={{ name: "pro-bureau", alt: fr ? "Une professionnelle travaille à son bureau" : "A professional working at her desk" }}
        eyebrow={fr ? "Programme d'agents affiliés MIMT" : "MIMT affiliate agent program"}
        title={fr ? "Recommandez MIMT, touchez une commission sur chaque client" : "Recommend MIMT, earn a commission on every customer"}
        lead={
          fr
            ? `Vous avez une audience, une clientèle ou un réseau? Devenez agent affilié : ${pct} % des revenus nets de chaque client que vous amenez, pendant ${months} mois.`
            : `Do you have an audience, clients or a network? Become an affiliate agent: ${pct}% of the net revenue of every customer you bring, for ${months} months.`
        }
      />

      <section className="section" aria-labelledby="aff-how">
        <div className="container">
          <h2 id="aff-how">{fr ? "Comment ça marche" : "How it works"}</h2>
          <ol className="steps steps--4">
            {(fr
              ? [
                  ["Faites votre demande", "Le formulaire plus bas prend deux minutes. Aucun frais, aucun achat."],
                  ["Nous l'étudions", "Nous vérifions que MIMT convient à votre audience et vous écrivons par courriel."],
                  ["Signez en ligne", "Vous recevez le contrat d'agent affilié et le signez électroniquement."],
                  ["Partagez votre lien", "Votre lien et votre code sont dans l'app MIMT, avec vos clients et vos commissions en temps réel."],
                ]
              : [
                  ["Apply", "The form below takes two minutes. No fee, no purchase."],
                  ["We review it", "We check that MIMT fits your audience and email you."],
                  ["Sign online", "You receive the affiliate agreement and sign it electronically."],
                  ["Share your link", "Your link and code are in the MIMT app, with your customers and commissions as they happen."],
                ]
            ).map(([title, text], i) => (
              <li className="step" key={title}>
                <span className="step__num" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="aff-model">
        <div className="container">
          <h2 id="aff-model">{fr ? "Le modèle de commission" : "The commission model"}</h2>
          <p className="section-lead">
            {fr
              ? "Conditions de base du programme. Vos conditions exactes sont écrites dans votre contrat."
              : "Standard program terms. Your exact terms are written in your agreement."}
          </p>
          <ul className="grid grid--4 features">
            <li className="card feature">
              <h3>{fr ? `${pct} % des revenus nets` : `${pct}% of net revenue`}</h3>
              <p>{fr ? "Sur chaque facture d'abonnement payée, sans les taxes et moins les remboursements." : "On every paid subscription invoice, without taxes and less refunds."}</p>
            </li>
            <li className="card feature">
              <h3>{fr ? `${months} mois par client` : `${months} months per customer`}</h3>
              <p>{fr ? "À partir de la première facture payée de chaque client que vous amenez." : "From the first paid invoice of each customer you bring."}</p>
            </li>
            <li className="card feature">
              <h3>{fr ? `Paiement dès ${threshold}` : `Paid from ${threshold}`}</h3>
              <p>
                {fr
                  ? `Après ${AFFILIATE_HOLD_DAYS} jours d'attente par commission, chaque mois, par virement.`
                  : `After a ${AFFILIATE_HOLD_DAYS}-day hold per commission, monthly, by transfer.`}
              </p>
            </li>
            <li className="card feature">
              <h3>{fr ? `${AFFILIATE_ATTRIBUTION_DAYS} jours pour convertir` : `${AFFILIATE_ATTRIBUTION_DAYS} days to convert`}</h3>
              <p>{fr ? "Le client paie son premier forfait dans les 60 jours de son premier clic. Le premier lien compte." : "The customer pays their first plan within 60 days of their first click. The first link counts."}</p>
            </li>
          </ul>
          <p className="aff-example">
            {fr
              ? `Exemple : un client prend Premium à ${ex.plan} par mois. Vous touchez ${ex.perMonth} pour chaque mois payé, soit ${ex.total} sur ${months} mois. Taxes en sus pour le client, non incluses dans le calcul.`
              : `Example: a customer takes Premium at ${ex.plan} a month. You earn ${ex.perMonth} for each paid month, or ${ex.total} over ${months} months. Taxes are extra for the customer and not part of the calculation.`}
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="aff-rules">
        <div className="container prose">
          <h2 id="aff-rules">{fr ? "Vos engagements" : "Your commitments"}</h2>
          <ul>
            {(fr
              ? [
                  "Dire, à chaque publication et avant le lien, que vous recevez une commission (Loi sur la concurrence, lignes directrices du Bureau de la concurrence sur le marketing d'influence).",
                  "Aucun courriel, texto ou message direct sans consentement, et toujours un moyen de se désabonner (Loi canadienne anti-pourriel).",
                  "Seulement les prix, limites et fonctions publiés sur mimt.ca : jamais d'« illimité », jamais de fausse promesse sur le 9-1-1.",
                  "Aucune annonce payée sur le nom MIMT ou GROUPE TAKATAK, aucun faux avis, aucune récompense contre un avis ou un « J'aime ».",
                  "Aucune autorecommandation. Vous ne voyez jamais l'identité de vos clients, seulement des totaux (Loi 25).",
                ]
              : [
                  "State in every post, before the link, that you earn a commission (Competition Act, Competition Bureau guidance on influencer marketing).",
                  "No email, text or direct message without consent, and always a way to unsubscribe (Canada's Anti-Spam Legislation).",
                  "Only the prices, limits and features published on mimt.ca: never “unlimited”, never a false promise about 9-1-1.",
                  "No paid ads on the MIMT or GROUPE TAKATAK name, no fake reviews, no reward for a review or a like.",
                  "No self-referral. You never see who your customers are, only totals (Law 25).",
                ]
            ).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p>
            {fr ? "Les détails sont dans le contrat, et notre " : "Details are in the agreement, and our "}
            <a href={href(lang, "terms")}>{fr ? "conditions d'utilisation" : "terms of service"}</a>
            {fr ? " s'appliquent à vos clients." : " apply to your customers."}
          </p>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="aff-faq">
        <div className="container">
          <h2 id="aff-faq">{fr ? "Questions fréquentes" : "Frequently asked questions"}</h2>
          <FaqList lang={lang} items={faq} />
        </div>
      </section>

      <section className="section" aria-labelledby="aff-apply" id="demande">
        <div className="container">
          <div className="card form-card">
            <h2 className="form-card__title" id="aff-apply">
              {fr ? "Demande d'agent affilié" : "Affiliate agent application"}
            </h2>
            <AffiliateForm lang={lang} />
          </div>
        </div>
      </section>
    </Shell>
  );
}
