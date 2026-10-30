import { PageHero, Shell } from "@/components/Shell";
import { GUIDES, guidePath } from "@/lib/guides";
import { CCTS_URL, CONTACT_EMAIL, href, type Lang } from "@/lib/site";

export function ComplaintsPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const ccts = CCTS_URL;
  return (
    <Shell lang={lang} page="complaints">
      <PageHero
        eyebrow={fr ? "Soutien" : "Support"}
        title={fr ? "Plaintes" : "Complaints"}
        lead={
          fr
            ? "Un problème avec MIMT? Dites-le-nous. Voici comment nous traitons les plaintes, et vers qui vous tourner si nous ne la réglons pas."
            : "A problem with MIMT? Tell us. Here is how we handle complaints, and where to turn if we don't resolve yours."
        }
      />
      <section className="section">
        <div className="container prose">
          <h2>{fr ? "1. Écrivez-nous" : "1. Write to us"}</h2>
          <p>
            {fr ? "Utilisez le " : "Use the "}
            <a href={href(lang, "contact")}>{fr ? "formulaire de contact" : "contact form"}</a>
            {fr ? " (sujet « Plainte ») ou écrivez à " : " (topic “Complaint”) or write to "}
            <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(fr ? "Plainte" : "Complaint")}`}>{CONTACT_EMAIL}</a>
            {fr
              ? ". Indiquez votre numéro MIMT, la date du problème et ce que vous attendez de nous."
              : ". Include your MIMT number, the date of the problem and what you expect from us."}
          </p>
          <p>
            {fr
              ? "Nous accusons réception et vous donnons un numéro de dossier. Nous visons une réponse complète en 10 jours ouvrables."
              : "We acknowledge your complaint and give you a file number. We aim to give a full answer within 10 business days."}
          </p>

          <h2>{fr ? "2. Demandez une révision" : "2. Ask for a review"}</h2>
          <p>
            {fr
              ? "Si la réponse ne vous satisfait pas, répondez au même courriel en demandant une révision. Une personne responsable, qui n'a pas traité votre première demande, revoit le dossier et vous donne notre réponse finale."
              : "If you're not satisfied with the answer, reply to the same email and ask for a review. A manager who did not handle your first request reviews the file and gives you our final answer."}
          </p>

          <h2>{fr ? "3. Le CPRST, si nous ne réglons pas votre plainte" : "3. The CCTS, if we don't resolve your complaint"}</h2>
          <div className="card ccts">
            <p>
              {fr ? (
                <>
                  La <strong>Commission des plaintes relatives aux services de télécom-télévision (CPRST)</strong> est un organisme
                  indépendant qui aide gratuitement les consommateurs et les petites entreprises à régler leurs plaintes au sujet de
                  leurs services de télécommunication. Les fournisseurs de services de télécommunication au Canada doivent y
                  participer.
                </>
              ) : (
                <>
                  The <strong>Commission for Complaints for Telecom-television Services (CCTS)</strong> is an independent
                  organization that helps consumers and small businesses resolve complaints about their telecom services, free of
                  charge. Telecom service providers in Canada must participate in it.
                </>
              )}
            </p>
            <p>
              {fr
                ? "Le CPRST demande normalement que vous ayez d'abord essayé de régler le problème avec nous."
                : "The CCTS normally asks that you first try to resolve the problem with us."}
            </p>
            <p>
              <a className="btn btn--primary" href={ccts} rel="noopener">
                {fr ? "Visiter ccts-cprst.ca" : "Visit ccts-cprst.ca"}
              </a>
            </p>
            <p className="fineprint">{fr ? "Téléphone sans frais du CPRST : 1-888-221-1687" : "CCTS toll-free: 1-888-221-1687"}</p>
          </div>

          <h2>{fr ? "Préparer votre dossier" : "Preparing your file"}</h2>
          <p>
            {fr
              ? "Une plainte claire se règle plus vite. Notez la date et l'heure du problème, le numéro MIMT concerné, le numéro appelé ou qui vous a appelé s'il y a lieu, et ce que vous avez déjà essayé. Joignez une capture d'écran du message d'erreur ou de la facture en cause. Dites aussi ce qui réglerait la situation pour vous : une correction de facture, un remboursement, une explication ou un changement de service. Gardez une copie de nos échanges : le CPRST pourra vous les demander."
              : "A clear complaint is settled faster. Note the date and time of the problem, the MIMT number involved, the number called or that called you if relevant, and what you already tried. Attach a screenshot of the error message or of the invoice in question. Also say what would settle the matter for you: a billing correction, a refund, an explanation or a change of service. Keep a copy of our exchanges: the CCTS may ask for them."}
          </p>
          <h2>{fr ? "Ce que le CPRST peut traiter" : "What the CCTS can handle"}</h2>
          <p>
            {fr
              ? "Le CPRST traite notamment les plaintes au sujet de la facturation, des modalités du contrat, de la livraison du service, de la gestion du crédit et du service à la clientèle des fournisseurs de télécommunication. Il ne traite pas les plaintes sur les prix eux-mêmes, ni celles qui relèvent d'un autre organisme, comme la protection des renseignements personnels."
              : "The CCTS handles in particular complaints about billing, contract terms, service delivery, credit management and customer service of telecom providers. It does not handle complaints about prices themselves, or those that belong to another body, such as privacy."}
          </p>

          <h2>{fr ? "Autres ressources" : "Other resources"}</h2>
          <ul>
            <li>
              {fr
                ? "Protection des renseignements personnels : la Commission d'accès à l'information du Québec (cai.gouv.qc.ca), après avoir écrit à notre responsable."
                : "Privacy: Québec's Commission d'accès à l'information (cai.gouv.qc.ca), after writing to our person in charge."}
            </li>
            <li>
              {fr
                ? "Droits des consommateurs au Québec : l'Office de la protection du consommateur (opc.gouv.qc.ca)."
                : "Consumer rights in Québec: the Office de la protection du consommateur (opc.gouv.qc.ca)."}
            </li>
            <li>
              {fr
                ? "Télémarketing et appels importuns : la Liste nationale de numéros de télécommunication exclus, gérée pour le CRTC (lnnte-dncl.gc.ca)."
                : "Telemarketing and unwanted calls: the National Do Not Call List, run for the CRTC (lnnte-dncl.gc.ca)."}
            </li>
            <li>
              {fr ? "Fraude ou arnaque : voir notre " : "Fraud or scam: see our "}
              <a href={guidePath(GUIDES.find((g) => g.id === "arnaques")!, lang)}>{fr ? "guide sur les arnaques par texto" : "guide to text message scams"}</a>
              {fr ? " et le Centre antifraude du Canada." : " and the Canadian Anti-Fraud Centre."}
            </li>
            <li>
              {fr ? "Renseignements personnels : voir notre " : "Personal information: see our "}
              <a href={href(lang, "privacy")}>{fr ? "politique de confidentialité" : "privacy policy"}</a>.
            </li>
            <li>
              {fr ? "Accessibilité : voir notre page " : "Accessibility: see our "}
              <a href={href(lang, "accessibility")}>{fr ? "Accessibilité" : "Accessibility page"}</a>.
            </li>
          </ul>
        </div>
      </section>
    </Shell>
  );
}
