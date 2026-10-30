// Français (Canada) — « MIMT Connect », liaison de compte côté utilisateur MIMT : page /lier et carte « Partenaires »
// de Compte › Intégrations (docs/MIMT-CONNECT.md). Fusionné dans fr.ts; chaque clé doit aussi exister dans
// en.partnerLinks.ts.

export const frPartnerLinks = {
  "partnerLink.title": "Relier votre compte",
  "partnerLink.lead": "Un partenaire de MIMT demande à relier votre compte MIMT à votre profil chez lui.",
  "partnerLink.codeLabel": "Code reçu du partenaire",
  "partnerLink.codeHint": "8 caractères, valide 15 minutes.",
  "partnerLink.check": "Vérifier le code",
  "partnerLink.ask": "{partner} veut relier votre compte MIMT à votre profil (identifiant {externalId}).",
  "partnerLink.profile": "Profil : {name}",
  "partnerLink.canTitle": "Une fois relié, {partner} pourra :",
  "partnerLink.perm.calls": "voir les appels de ses lignes qui vous sont acheminés (numéros, heures, durées);",
  "partnerLink.perm.click_to_call": "lancer des appels en votre nom (votre application MIMT sonne d'abord; vous décidez de répondre);",
  "partnerLink.perm.number": "voir et utiliser le numéro MIMT que vous choisissez comme ligne pour ces appels.",
  "partnerLink.cannot": "Il ne voit ni vos textos, ni vos messages vocaux, ni vos autres appels, et il ne peut rien acheter en votre nom.",
  "partnerLink.revocable": "Vous pouvez retirer ce lien en tout temps dans Compte › Intégrations.",
  "partnerLink.approve": "Autoriser",
  "partnerLink.cancel": "Annuler",
  "partnerLink.done": "Votre compte MIMT est relié à {partner}.",
  "partnerLink.seeIntegrations": "Voir mes intégrations",
  "partnerLink.error.invalid": "Ce code n'est pas valide. Vérifiez-le et réessayez.",
  "partnerLink.error.expired": "Ce code a expiré ou a déjà servi. Demandez-en un nouveau au partenaire.",
  "partnerLink.error.memberTaken": "Ce profil est déjà relié à un autre compte MIMT.",
  "partnerLink.error.alreadyLinked": "Votre compte est déjà relié à un autre profil de ce partenaire. Retirez ce lien d'abord.",

  "partners.title": "Partenaires",
  "partners.lead": "Les services qui peuvent faire sonner vos applications MIMT et appeler en votre nom, avec votre accord.",
  "partners.empty": "Aucun partenaire n'est relié à votre compte.",
  "partners.soon": "Les liens avec des partenaires seront offerts bientôt.",
  "partners.item": "{partner} — profil {externalId}",
  "partners.line": "Ligne utilisée : {number}",
  "partners.noLine": "Aucune ligne choisie pour ce partenaire.",
  "partners.since": "Relié depuis le {date}",
  "partners.revoke": "Retirer le lien",
  "partners.revokeConfirm": "Retirer le lien avec {partner}? Il ne pourra plus faire sonner vos applications ni appeler en votre nom.",
  "partners.revoked": "Le lien a été retiré.",
};
