import { Icon } from "@/components/Visuals";
import { href, type Lang } from "@/lib/site";

/** HTML comment in the exported page: the owner must confirm this offer before launch (grep "[À confirmer par MIMT]"). */
export function ConfirmMarker({ note }: { note: string }) {
  const safe = note.replace(/--/g, "—");
  return <div hidden dangerouslySetInnerHTML={{ __html: `<!-- [À confirmer par MIMT] ${safe} -->` }} />;
}

/**
 * The two "free" offers, shown on the home and plans pages.
 * - Number transfer: the API charges PORT_IN_FEE_CENTS, 0 by default (apps/api/src/config.ts).
 * - Business setup: a launch offer the owner asked for; terms are not written yet, so the page says so.
 */
export function Offers({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <ul className="offers" aria-label={fr ? "Offres gratuites" : "Free offers"}>
      <li className="offer" data-reveal="">
        <span className="offer__icon">
          <Icon name="transfer" />
        </span>
        <div>
          <p className="offer__tag">{fr ? "0 $" : "$0"}</p>
          <h3>{fr ? "Transfert de numéro gratuit" : "Free number transfer"}</h3>
          <p>
            {fr
              ? "Apportez votre numéro actuel chez MIMT. Aucuns frais de transfert MIMT, pour les particuliers comme pour les entreprises."
              : "Bring your current number to MIMT. No MIMT transfer fee, for individuals and businesses alike."}
          </p>
          <p className="offer__small">
            {fr
              ? "Les frais ou contrats de votre fournisseur actuel restent les vôtres. Ouverture du transfert annoncée au lancement."
              : "Your current provider's fees or contracts remain yours. Transfers open at launch."}
          </p>
        </div>
      </li>
      <li className="offer offer--launch" data-reveal="">
        <ConfirmMarker note="Mise en service gratuite pour MIMT Affaires : durée, admissibilité et conditions de l'offre de lancement." />
        <span className="offer__icon">
          <Icon name="spark" />
        </span>
        <div>
          <p className="offer__tag">{fr ? "Offre de lancement" : "Launch offer"}</p>
          <h3>{fr ? "Mise en service gratuite pour MIMT Affaires" : "Free setup for MIMT Business"}</h3>
          <p>
            {fr
              ? "Postes, accueil bilingue, heures d'ouverture : on configure votre système avec vous, sans frais de mise en service."
              : "Extensions, bilingual greeting, business hours: we set up your system with you, with no setup fee."}{" "}
            <a href={href(lang, "business", "demo")}>{fr ? "Demander une démo" : "Request a demo"}</a>
          </p>
          <p className="offer__small">{fr ? "Offre de lancement; conditions à venir." : "Launch offer; terms to come."}</p>
        </div>
      </li>
    </ul>
  );
}
