import { PageHero, Shell } from "@/components/Shell";
import { CONTACT_EMAIL, href, type Lang } from "@/lib/site";

export function AccessibilityPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="accessibility">
      <PageHero
        eyebrow={fr ? "Légal" : "Legal"}
        title={fr ? "Accessibilité" : "Accessibility"}
        lead={fr ? "MIMT doit être utilisable par tout le monde." : "MIMT should work for everyone."}
      />
      <section className="section">
        <div className="container prose">
          {fr ? (
            <>
              <h2>Notre objectif</h2>
              <p>
                Nous visons la conformité aux Règles pour l&apos;accessibilité des contenus Web (WCAG) 2.1, niveau AA, sur ce site
                et dans l&apos;app : contraste suffisant, navigation au clavier, compatibilité avec les lecteurs d&apos;écran, texte
                agrandissable.
              </p>
              <h2>Sur ce site</h2>
              <ul>
                <li>Un lien « Aller au contenu » en tête de chaque page, pour sauter le menu au clavier ou avec un lecteur d&apos;écran.</li>
                <li>Un seul titre principal par page et des intertitres dans l&apos;ordre, pour naviguer par titres.</li>
                <li>Un texte de remplacement pour chaque image; notre vérification automatique bloque la publication d&apos;une image qui n&apos;en a pas.</li>
                <li>Une langue déclarée sur chaque page (français ou anglais), pour que la synthèse vocale prononce correctement.</li>
                <li>Un contour visible autour de l&apos;élément qui a le focus clavier.</li>
                <li>Les animations sont réduites si vous avez activé l&apos;option « réduire les animations » de votre appareil.</li>
              </ul>
              <h2>Dans l&apos;app</h2>
              <ul>
                <li>Étiquettes pour les lecteurs d&apos;écran (VoiceOver, TalkBack).</li>
                <li>Respect de la taille de texte choisie sur votre appareil.</li>
                <li>Transcription de la messagerie vocale (forfaits Premium et Affaires).</li>
              </ul>
              <h2>Communiquer sans entendre ou sans parler</h2>
              <p>
                MIMT n&apos;exige pas d&apos;appel vocal pour l&apos;essentiel : vous pouvez texter vos contacts depuis votre numéro
                MIMT, texter gratuitement les autres utilisateurs avec leur identifiant @nom, et lire vos messages vocaux transcrits
                en texte avec les forfaits qui incluent la transcription. Sur l&apos;ordinateur, l&apos;application Web à app.mimt.ca
                fonctionne avec le clavier, un grand écran et les outils d&apos;agrandissement de votre système.
              </p>
              <h2>Services de relais et 9-1-1</h2>
              <p>
                Si vous utilisez un service de relais (ATS ou relais IP), le 9-1-1 peut comporter des limites. Lisez notre{" "}
                <a href={href(lang, "e911")}>page 9-1-1</a>. Nous vous rappelons ces limites à l&apos;inscription et chaque année.
              </p>
              <h2>Formats adaptés</h2>
              <p>
                Nos conditions, notre avis 9-1-1 et nos factures sont offerts en formats adaptés (gros caractères, texte brut, etc.)
                sur demande, sans frais.
              </p>
              <h2>Limites connues</h2>
              <p>
                Certains éléments interactifs, comme le sélecteur de numéros et la démo d&apos;IA vocale, sont plus difficiles à
                utiliser avec un lecteur d&apos;écran que le reste du site. Le service de 9-1-1 par texto (T9-1-1) est offert par
                les fournisseurs cellulaires, pas par l&apos;app MIMT. Si un obstacle vous empêche d&apos;utiliser un service,
                écrivez-nous : nous trouverons une autre façon de vous servir, par courriel par exemple.
              </p>
              <h2>Nous joindre</h2>
              <p>
                Un obstacle sur le site ou dans l&apos;app? Écrivez à <a href={`mailto:${CONTACT_EMAIL}?subject=Accessibilit%C3%A9`}>{CONTACT_EMAIL}</a>{" "}
                ou utilisez le <a href={href(lang, "contact")}>formulaire de contact</a> (sujet « Accessibilité »).
              </p>
            </>
          ) : (
            <>
              <h2>Our goal</h2>
              <p>
                We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1, level AA, on this site and in the app: enough
                contrast, keyboard navigation, screen-reader support, resizable text.
              </p>
              <h2>On this site</h2>
              <ul>
                <li>A &ldquo;Skip to content&rdquo; link at the top of every page, to jump past the menu by keyboard or with a screen reader.</li>
                <li>One main heading per page and subheadings in order, for navigating by headings.</li>
                <li>Alternative text for every image; our automatic check blocks publishing an image without one.</li>
                <li>A declared language on every page (French or English), so speech synthesis pronounces it correctly.</li>
                <li>A visible outline around the element that has keyboard focus.</li>
                <li>Animations are reduced if you turned on your device&apos;s &ldquo;reduce motion&rdquo; option.</li>
              </ul>
              <h2>In the app</h2>
              <ul>
                <li>Screen-reader labels (VoiceOver, TalkBack).</li>
                <li>Respects the text size set on your device.</li>
                <li>Voicemail transcription (Premium and Business plans).</li>
              </ul>
              <h2>Communicating without hearing or speaking</h2>
              <p>
                MIMT doesn&apos;t require voice calls for the essentials: you can text your contacts from your MIMT number, text
                other users for free with their @name handle, and read your voicemails transcribed as text on plans that include
                transcription. On a computer, the web app at app.mimt.ca works with the keyboard, a large screen and your system&apos;s
                magnification tools.
              </p>
              <h2>Relay services and 9-1-1</h2>
              <p>
                If you use a relay service (TTY or IP Relay), 9-1-1 may have limits. Read our <a href={href(lang, "e911")}>9-1-1 page</a>.
                We remind you of these limits at sign-up and every year.
              </p>
              <h2>Alternative formats</h2>
              <p>Our terms, 9-1-1 notice and bills are available in alternative formats (large print, plain text, etc.) on request, free.</p>
              <h2>Known limits</h2>
              <p>
                Some interactive parts, such as the number picker and the voice AI demo, are harder to use with a screen reader
                than the rest of the site. Text with 9-1-1 (T9-1-1) is offered by mobile carriers, not by the MIMT app. If a barrier
                keeps you from using a service, write to us: we will find another way to serve you, by email for example.
              </p>
              <h2>Contact us</h2>
              <p>
                Found a barrier on the site or in the app? Write to <a href={`mailto:${CONTACT_EMAIL}?subject=Accessibility`}>{CONTACT_EMAIL}</a>{" "}
                or use the <a href={href(lang, "contact")}>contact form</a> (topic &ldquo;Accessibility&rdquo;).
              </p>
            </>
          )}
        </div>
      </section>
    </Shell>
  );
}
