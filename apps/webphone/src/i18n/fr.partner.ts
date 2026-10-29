// Français (Canada) — « MIMT Connect », section Partenaire du portail Affaires (docs/MIMT-CONNECT.md). Fusionné
// dans fr.ts; chaque clé doit aussi exister dans en.partner.ts.

export const frPartner = {
  "biz.nav.partner": "Partenaire",
  "partner.title": "MIMT Connect",
  "partner.lead": "Branchez votre propre système (site Web, CRM) à votre standard MIMT : clés d'API, webhooks signés et crédits.",
  "partner.notPartner": "Cette entreprise n'est pas encore partenaire MIMT Connect. Écrivez-nous pour l'activer.",
  "partner.suspended": "Le compte partenaire est suspendu : l'API refuse les clés pour le moment.",

  "partner.credits.title": "Crédits",
  "partner.credits.balance": "{credits} crédits",
  "partner.credits.rate": "{credits} crédit(s) par minute commencée, quand un membre répond.",
  "partner.credits.empty": "Plus de crédits : les appels sonnent encore, mais ne sont pas facturés. Communiquez avec MIMT pour recharger.",

  "partner.keys.title": "Clés d'API",
  "partner.keys.lead": "Chaque clé n'est affichée qu'une seule fois. MIMT ne garde que son empreinte.",
  "partner.keys.label": "Nom de la clé (facultatif)",
  "partner.keys.create": "Créer une clé",
  "partner.keys.rotate": "Remplacer",
  "partner.keys.revoke": "Révoquer",
  "partner.keys.revokeConfirm": "Révoquer cette clé? Les appels à l'API qui l'utilisent seront refusés tout de suite.",
  "partner.keys.revoked": "Révoquée",
  "partner.keys.active": "Active",
  "partner.keys.lastUsed": "Dernière utilisation : {date}",
  "partner.keys.neverUsed": "Jamais utilisée",
  "partner.keys.empty": "Aucune clé pour l'instant.",
  "partner.keys.shownOnce": "Copiez cette clé maintenant : elle ne sera plus jamais affichée.",

  "partner.webhook.title": "Webhook",
  "partner.webhook.lead": "Nous envoyons call.ringing, call.answered, call.completed et recording.ready à cette adresse https, signés avec X-MIMT-Signature.",
  "partner.webhook.url": "Adresse du webhook (https)",
  "partner.webhook.save": "Enregistrer",
  "partner.webhook.remove": "Retirer",
  "partner.webhook.rotate": "Nouveau secret de signature",
  "partner.webhook.saved": "Webhook enregistré.",
  "partner.webhook.secret": "Secret de signature, affiché une seule fois :",

  "partner.calls.title": "Derniers appels",
  "partner.calls.empty": "Aucun appel pour l'instant.",
  "partner.calls.member": "Membre",
  "partner.calls.nobody": "Personne n'a répondu",
  "partner.calls.credits": "{credits} crédits",
  "partner.billing.billed": "Facturé",
  "partner.billing.partial": "Facturé en partie",
  "partner.billing.unbilled": "Non facturé",
  "partner.billing.free": "Gratuit",
  "partner.billing.pending": "En cours",

  "partner.copy": "Copier",
  "partner.copied": "Copié.",
} as const;
