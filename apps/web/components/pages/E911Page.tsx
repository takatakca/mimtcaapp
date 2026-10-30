import { PageHero, Shell } from "@/components/Shell";
import { LEGAL_UPDATED, href, type Lang } from "@/lib/site";

// Legal review (lawyer): 9-1-1 limitations notice for nomadic VoIP, CRTC 2005-21, 2005-61, 2011-619.

export function E911Page({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="e911">
      <PageHero
        eyebrow={fr ? "Sécurité" : "Safety"}
        title={fr ? "Le 9-1-1 avec MIMT : ce qu'il faut savoir" : "9-1-1 with MIMT: what you need to know"}
        lead={
          fr
            ? "MIMT fonctionne par Internet. Le 9-1-1 y fonctionne différemment d'une ligne fixe ou d'un cellulaire. Lisez cette page avant d'utiliser le service."
            : "MIMT works over the internet. 9-1-1 works differently than on a landline or a cell phone. Read this page before using the service."
        }
      />
      <section className="section">
        <div className="container prose">
          <div className="notice notice--warn" role="note">
            <strong>{fr ? "En cas d'urgence, si vous le pouvez, utilisez un téléphone fixe ou un cellulaire." : "In an emergency, if you can, use a landline or a cell phone."}</strong>{" "}
            {fr
              ? "Le 9-1-1 de MIMT peut ne pas fonctionner lors d'une panne d'Internet ou de courant, ou si votre adresse n'est pas à jour."
              : "MIMT's 9-1-1 may not work during an internet or power outage, or if your address is not up to date."}
          </div>

          {fr ? (
            <>
              <h2>Comment fonctionne un appel au 9-1-1</h2>
              <p>
                MIMT est un service de téléphonie par Internet dit « nomade » : vous pouvez l'utiliser partout où vous avez une
                connexion. Le réseau ne peut donc pas déterminer automatiquement où vous êtes. Quand vous composez le 9-1-1, votre
                appel est d'abord reçu par un centre d'appels d'urgence spécialisé. Un préposé confirme où vous êtes, puis transfère
                l'appel au centre 9-1-1 de votre région.
              </p>
              <ul>
                <li>Dites tout de suite où vous êtes : adresse, ville et province.</li>
                <li>Ne raccrochez pas avant qu'on vous le dise. Si l'appel coupe, rappelez.</li>
                <li>Le préposé peut ne pas avoir votre numéro de rappel ou votre adresse à l'écran.</li>
              </ul>

              <h2>Gardez votre adresse à jour</h2>
              <p>
                Avant votre premier appel, l'app vous demande l'adresse municipale où vous utilisez MIMT. Cette adresse est transmise
                aux services d'urgence. <strong>Chaque fois que vous changez d'endroit</strong> (déménagement, chalet, voyage),
                mettez-la à jour dans l'app. Une adresse inexacte peut retarder l'arrivée des secours.
              </p>

              <h2>Quand le 9-1-1 peut ne pas fonctionner</h2>
              <ul>
                <li>Panne d'Internet, de Wi‑Fi ou de données mobiles, ou connexion faible.</li>
                <li>Panne de courant, ou téléphone ou ordinateur déchargé.</li>
                <li>Application fermée par le système, désinstallée ou pas à jour.</li>
                <li>Adresse enregistrée inexacte ou pas à jour.</li>
                <li>Utilisation à l'extérieur du Canada : l'appel peut ne pas joindre les secours locaux.</li>
              </ul>

              <h2>Ce que MIMT s'engage à faire</h2>
              <ul>
                <li>Le 9-1-1 n'est jamais bloqué par votre forfait, vos limites de minutes ou votre solde.</li>
                <li>Les appels sortants vers des numéros de téléphone sont activés seulement après l'enregistrement de votre adresse et l'acceptation de cet avis.</li>
                <li>Cet avis est aussi présenté dans l'app, dans nos conditions et par notre service à la clientèle. Il est offert en formats adaptés sur demande.</li>
              </ul>

              <h2>Personnes sourdes, malentendantes ou ayant un trouble de la parole</h2>
              <p>
                Le 9-1-1 par texto (T9-1-1) est un service des fournisseurs cellulaires et n'est pas offert par l'app MIMT. Les
                services de relais peuvent comporter des limites semblables pour le 9-1-1. Voir notre page{" "}
                <a href={href(lang, "accessibility")}>Accessibilité</a>.
              </p>

              <h2>Informez les autres utilisateurs</h2>
              <p>
                Si d'autres personnes utilisent votre ligne (famille, employés, invités), informez-les de ces limites.
              </p>
            </>
          ) : (
            <>
              <h2>How a 9-1-1 call works</h2>
              <p>
                MIMT is a &ldquo;nomadic&rdquo; internet phone service: you can use it anywhere you have a connection. The network
                therefore can&apos;t automatically tell where you are. When you dial 9-1-1, your call is first answered by a
                specialized emergency call centre. An agent confirms where you are, then transfers the call to the 9-1-1 centre for
                your area.
              </p>
              <ul>
                <li>Say right away where you are: address, city and province.</li>
                <li>Don&apos;t hang up until told to. If the call drops, call back.</li>
                <li>The agent may not see your call-back number or your address.</li>
              </ul>

              <h2>Keep your address up to date</h2>
              <p>
                Before your first call, the app asks for the civic address where you use MIMT. This address is sent to emergency
                services. <strong>Every time you change location</strong> (moving, cottage, travel), update it in the app. A wrong
                address can delay help.
              </p>

              <h2>When 9-1-1 may not work</h2>
              <ul>
                <li>Internet, Wi‑Fi or mobile data outage, or a weak connection.</li>
                <li>Power outage, or a dead phone or computer battery.</li>
                <li>App closed by the system, uninstalled or out of date.</li>
                <li>Registered address wrong or out of date.</li>
                <li>Use outside Canada: the call may not reach local emergency services.</li>
              </ul>

              <h2>What MIMT commits to</h2>
              <ul>
                <li>9-1-1 is never blocked by your plan, minute limits or balance.</li>
                <li>Outbound calls to phone numbers are turned on only after you register your address and accept this notice.</li>
                <li>This notice is also shown in the app, in our terms and by customer service. Alternative formats are available on request.</li>
              </ul>

              <h2>People who are Deaf, hard of hearing or speech-impaired</h2>
              <p>
                Text with 9-1-1 (T9-1-1) is a cellular carrier service and is not offered in the MIMT app. Relay services may have
                similar 9-1-1 limits. See our <a href={href(lang, "accessibility")}>Accessibility</a> page.
              </p>

              <h2>Tell other users</h2>
              <p>If other people use your line (family, employees, guests), tell them about these limits.</p>
            </>
          )}

          <h2>{fr ? "Renseignements sur l'avis" : "About this notice"}</h2>
          <ul>
            <li>
              {fr
                ? "Les appels au 9-1-1 sont acheminés par Twilio, notre fournisseur d'acheminement des appels, vers un centre d'appels d'urgence spécialisé qui confirme votre emplacement et transfère l'appel au centre 9-1-1 de votre région."
                : "9-1-1 calls are routed by Twilio, our call routing provider, to a specialized emergency call centre that confirms your location and transfers the call to the 9-1-1 centre for your area."}
            </li>
            <li>
              {fr ? "Dernière mise à jour de cet avis : " : "This notice was last updated: "}
              <time dateTime={LEGAL_UPDATED.iso}>{LEGAL_UPDATED[lang]}</time>
              {fr
                ? ". Si l'avis change de façon importante, l'app vous demande de l'accepter de nouveau."
                : ". If the notice changes in a significant way, the app asks you to accept it again."}
            </li>
            <li>
              {fr ? "Ce que le CRTC exige des services de téléphonie par Internet : " : "What the CRTC requires of internet phone services: "}
              <a href={fr ? "https://crtc.gc.ca/fra/phone/911/voip.htm" : "https://crtc.gc.ca/eng/phone/911/voip.htm"} rel="noopener">
                crtc.gc.ca
              </a>
            </li>
          </ul>
        </div>
      </section>
    </Shell>
  );
}
