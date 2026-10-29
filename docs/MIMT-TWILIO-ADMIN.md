# MIMT : outils Twilio pour le personnel (import d'un numéro, diagnostics)

Ajouté le 2026-10-29 par Claude (agent MIMT nº 2, session 01GtWamF). Accès : `CATALOG_ADMIN_USER_IDS` seulement.
Dans l'app : Compte › Administration MIMT (`/compte/admin`). API : `apps/api/src/routes/adminTwilio.ts`.

## Diagnostics (lecture seule) — `GET /v1/admin/twilio/diagnostics`
Rien n'est modifié chez Twilio. Le rapport indique :
- le compte Twilio de l'API (nom, 4 derniers caractères du SID, statut, type) et son solde ;
- l'App TwiML des appels sortants (doit pointer vers `/webhooks/twilio/voice/outbound`) ;
- les pays permis en voix (attendu : CA et US seulement) ;
- les alertes de dépenses (usage triggers) ;
- les numéros du compte et s'ils pointent vers MIMT.

## Import d'un numéro existant — `POST /v1/admin/numbers/import { e164, ownerUserId? }`
- Exige une confirmation récente (clé d'accès ou code texto de moins de 10 minutes).
- Le numéro doit être **dans le compte Twilio utilisé par l'API**. Sinon : `409 not_in_mimt_twilio_account`. Twilio
  signe chaque webhook avec le jeton du compte propriétaire du numéro, alors un numéro d'un autre compte serait refusé
  par notre vérification de signature : il faut d'abord le transférer dans le compte de l'API.
- Écrit seulement notre base de données. Rien n'est acheté, modifié ni libéré chez Twilio.
- **Règle du propriétaire (numéros d'avant le 2026-10-23)** : la ligne garde la date de création de Twilio, donc la tâche
  de cycle de vie et le rattrapage des URL de secours l'ignorent. De plus, la tâche de cycle de vie vérifie maintenant
  la date de création chez Twilio avant toute libération.
- La réponse liste les écarts avec la configuration MIMT (adresse voix, SMS, statut) et prévient si le forfait du compte
  envoie les appels directement à la messagerie (aucune minute entrante).

## Ce soir (2026-10-29) : la ligne de test de Matt, +1 579 999 6789
1. Matt se connecte à app.mimt.ca, puis va dans Compte › Administration MIMT et importe `+15799996789`.
2. Si la réponse est `not_in_mimt_twilio_account` : le numéro est dans un autre compte Twilio que celui de l'API.
   Il faut le transférer dans le compte de l'API (Twilio : « transfer number between accounts ») ou faire pointer l'API
   vers ce compte. Ne pas changer les clés soi-même : elles se collent dans Coolify par Matt seulement.
3. Appeler le numéro : l'app MIMT sonne pendant 25 s, puis la messagerie vocale prend l'appel.
4. Textos : tant que le numéro reste dans le Messaging Service « Takatak Verification », les textos reçus suivent la
   configuration du service. Recommandation : le laisser tel quel ce soir (le service sert aux codes de connexion) et
   tester la voix d'abord.
