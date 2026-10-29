# MIMT — Fiabilité des appels

Dernière mise à jour : 29 octobre 2026 (branche `claude/call-reliability`).

Trois mesures simples pour que les appels sonnent mieux et que les appelants entendent quelque chose même si l'API MIMT est en panne :

1. **Point d'accès Twilio (« edge ») fixé** dans l'application Web : Ashburn, puis Umatilla.
2. **URL de secours (fallback) Twilio** sur les numéros MIMT : si notre API ne répond pas, Twilio lit un message hébergé chez Twilio.
3. **Bouton « Tester ma connexion »** dans les réglages audio du téléphone Web.

## 1. Point d'accès Twilio (application Web)

Twilio n'a pas de point d'accès au Canada. Sans réglage, le SDK choisit « roaming » (le plus rapide au moment de la connexion), ce qui peut changer d'un appel à l'autre. MIMT fixe maintenant :

- `ashburn` (Virginie, États-Unis) : le plus proche du Québec;
- `umatilla` (Oregon, États-Unis) : secours si Ashburn est injoignable. Le SDK essaie les points d'accès dans l'ordre.

Fichiers : `apps/webphone/src/env.ts` (`parseEdges`, `DEFAULT_TWILIO_EDGES`), `apps/webphone/src/phone/twilioEngine.ts` (option `edge` du `Device`).

Pour changer la liste sans modifier le code, définir au moment du build `VITE_TWILIO_EDGE` (liste séparée par des virgules), par exemple `VITE_TWILIO_EDGE=ashburn,roaming`. Vide ou absent : `ashburn,umatilla`.

**Application mobile : inchangée.** Le SDK React Native de Twilio utilisé (`@twilio/voice-react-native-sdk` 1.8.0) n'offre pas d'option « edge » dans `Voice.connect()` ni à l'enregistrement. On n'ajoute rien de bricolé côté natif.

## 2. URL de secours Twilio (API)

### Fonctionnement

Chaque numéro Twilio a une URL principale (notre API) et une URL de secours facultative. Si l'URL principale échoue (erreur 5xx, délai dépassé, serveur arrêté), Twilio appelle l'URL de secours. En la plaçant **chez Twilio** (TwiML Bin ou Function), elle reste disponible même quand l'API, Coolify ou la base de données sont en panne.

Variables d'environnement de l'API (des URL, pas des secrets; `https://` obligatoire) :

| Variable | Rôle |
| --- | --- |
| `TWILIO_VOICE_FALLBACK_URL` | Secours des appels entrants (`voiceFallbackUrl`, méthode `POST`). |
| `TWILIO_SMS_FALLBACK_URL` | Facultatif : secours des textos entrants (`smsFallbackUrl`, méthode `POST`). |

Quand une variable est définie :

- **Nouveaux numéros** : elle est transmise à Twilio à l'achat (`purchaseNumber` : numéro gratuit, numéro payé par Stripe, numéro Affaires) et à l'activation d'un numéro transféré (`configurePortedNumber`).
- **Numéros existants** : une tâche unique s'exécute 2 minutes après le démarrage de l'API (`apps/api/src/jobs/numberFallback.ts`). Elle est idempotente : un numéro qui a déjà la bonne URL n'est pas réécrit. Elle n'écrit que les champs de secours; l'URL principale, l'adresse 9-1-1 et le reste ne changent jamais. Une URL non configurée n'est jamais effacée.

### Règle du propriétaire : jamais avant le 23 octobre 2026

La tâche ne touche **jamais** un numéro Twilio créé avant le 23 octobre 2026. Trois verrous :

1. Elle ne part que de la table `phone_numbers` de MIMT (numéros que MIMT a lui-même achetés ou transférés), jamais d'une liste du compte Twilio. Seuls les états `active`, `locked`, `grace` et `quarantine` avec un SID Twilio sont lus.
2. La date de création dans notre table doit être le 23 octobre 2026 ou après; sinon le numéro n'est même pas lu chez Twilio.
3. La date de création **chez Twilio** (`dateCreated`) doit aussi être le 23 octobre 2026 ou après, et le numéro E.164 chez Twilio doit être identique au nôtre. Date inconnue ou différente : le numéro est ignoré.

La date limite est écrite dans le code (`FALLBACK_BACKFILL_FROM`), sans variable pour la reculer. Chaque mise à jour est inscrite au journal d'audit (`number.fallback_set`).

### TwiML à coller dans le TwiML Bin (appels)

Choisir **une** des deux versions.

**Version A — message puis raccrocher** (aucun renvoi) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA">Bonjour, vous avez joint un numéro MIMT. Notre service est momentanément indisponible. Veuillez rappeler dans quelques minutes. Merci.</Say>
  <Say language="en-CA">Hello, you have reached a MIMT number. Our service is temporarily unavailable. Please call back in a few minutes. Thank you.</Say>
  <Hangup/>
</Response>
```

**Version B — message puis renvoi vers un numéro du propriétaire** (remplacer `+1XXXXXXXXXX` par le numéro de renvoi, au format E.164, par exemple `+15145550123`) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA">Bonjour, vous avez joint un numéro MIMT. Notre service est momentanément indisponible. Nous transférons votre appel.</Say>
  <Say language="en-CA">Hello, you have reached a MIMT number. Our service is temporarily unavailable. We are transferring your call.</Say>
  <Dial timeout="25">+1XXXXXXXXXX</Dial>
  <Say language="fr-CA">Personne n'est disponible. Veuillez rappeler plus tard. Merci.</Say>
  <Say language="en-CA">No one is available. Please call back later. Thank you.</Say>
  <Hangup/>
</Response>
```

Pas de `<Record>` : aucun message vocal n'est enregistré pendant une panne (il ne serait pas relié à la boîte vocale MIMT du client ni à ses règles de confidentialité). Un TwiML Bin ne peut pas savoir à quel client appartient le numéro : la version B renvoie **tous** les appels en panne vers le même numéro. Choisir la version A si ce n'est pas souhaité.

### TwiML facultatif pour les textos

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response/>
```

Une réponse vide n'envoie rien à l'expéditeur; le texto reste visible dans les journaux de messages de la console Twilio, mais n'arrive pas dans MIMT. Pour répondre à l'expéditeur (chaque réponse coûte un texto) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>MIMT : service momentanément indisponible, votre texto n'a pas pu être livré. Réessayez plus tard. / MIMT: service temporarily unavailable, your text could not be delivered. Please try again later.</Message>
</Response>
```

### Hors de portée (volontairement)

- **Appels sortants depuis l'application** : ils passent par la TwiML App, dont l'URL de secours n'est pas modifiée. Un secours pour ces appels toucherait aussi le 9-1-1 (adresse civique, numéro d'appelant) : à concevoir à part, avec l'avis du conseiller juridique, et non par un TwiML Bin générique. Ne **pas** coller le TwiML ci-dessus dans la TwiML App.
- Les numéros créés avant le 23 octobre 2026 gardent leur configuration actuelle. Le propriétaire peut, s'il le souhaite, y ajouter l'URL à la main dans la console Twilio.

## 3. « Tester ma connexion » (application Web)

Dans le téléphone (bouton flottant) › onglet **Audio**, sous le choix du micro et de la sortie. Le bouton lance le test « preflight » de Twilio (`Device.runPreflight`) avec un jeton tout neuf :

- un court appel d'essai passe par la TwiML App; l'API reconnaît un appel sans destination (`To` vide) d'un utilisateur connecté, dit « Test de connexion MIMT » puis garde la ligne ouverte 12 secondes et raccroche. Aucun numéro n'est composé, aucun appel n'est inscrit à l'historique; limite de 10 tests par heure et par compte. Le 9-1-1 est traité avant et n'est pas touché;
- résultat affiché : qualité (excellente, bonne, moyenne, faible), gigue, perte de paquets, temps aller-retour, relais TURN requis ou non, point d'accès Twilio utilisé;
- si la qualité est moyenne ou faible, ou si une mesure dépasse les seuils d'avertissement de Twilio (gigue > 30 ms, perte > 3 %, aller-retour > 400 ms) : « Rapprochez-vous du routeur Wi-Fi ou passez au réseau cellulaire ».

Correspondance des notes Twilio (selon le MOS moyen) : `excellent` et `great` → excellente; `good` → bonne; `fair` → moyenne; `degraded` → faible. Le test utilise le premier point d'accès de la liste (le SDK preflight n'en accepte qu'un). En mode démo (`VITE_MOCK_API=1`), un résultat fictif s'affiche, sans charger le SDK Twilio.

Fichiers : `apps/webphone/src/phone/connectionTest.ts` (+ test), `Softphone.tsx` (`ConnectionTest`), `i18n/fr.calltest.ts` et `en.calltest.ts`, `apps/api/src/routes/twilioVoice.ts`.

## Étapes du propriétaire

1. **Console Twilio › TwiML Bins › Create new TwiML Bin.** Nom : `MIMT secours appels`. Coller la version A ou B ci-dessus (pour B, remplacer `+1XXXXXXXXXX`). Enregistrer et copier l'URL du Bin (`https://handler.twilio.com/twiml/EH…`).
2. Facultatif : un second Bin `MIMT secours textos` avec le TwiML des textos.
3. **Coolify › application API MIMT › Environment Variables** : ajouter `TWILIO_VOICE_FALLBACK_URL` = URL du Bin d'appels (et, au besoin, `TWILIO_SMS_FALLBACK_URL`). Redéployer l'API.
4. Environ 2 minutes après le démarrage, vérifier dans les journaux de l'API la ligne `number fallback backfill done` (compteurs `updated`, `unchanged`, `skipped`, `errors`).
5. Vérification : dans la console Twilio, ouvrir un numéro acheté par MIMT après le 23 octobre 2026 › « A call comes in » › « Primary handler fails » doit afficher l'URL du Bin. Un numéro plus ancien doit être inchangé.
6. Facultatif : `VITE_TWILIO_EDGE` dans les variables de build de l'application Web (Coolify) seulement pour changer l'ordre par défaut.

---

## English summary

- **Twilio edge (web app):** the Voice SDK `Device` now uses `edge: ["ashburn", "umatilla"]` (Twilio has no Canadian edge; the SDK falls back in order). Override at build time with `VITE_TWILIO_EDGE` (comma list). Mobile is unchanged: the React Native Voice SDK 1.8.0 has no edge option.
- **Voice fallback URL (API):** optional `TWILIO_VOICE_FALLBACK_URL` and `TWILIO_SMS_FALLBACK_URL` (https only, not secrets) point to a Twilio-hosted TwiML Bin. They are set on every new or ported number, and a one-shot, idempotent job 2 minutes after API start applies them to existing MIMT numbers. It only reads numbers from MIMT's own `phone_numbers` table, and never touches a number created before 2026-10-23 (checked both in our table and with Twilio's `dateCreated`, plus a matching E.164). It only writes the fallback fields. The TwiML to paste is above (message + hang up, or message + `<Dial>` to an owner number placeholder; no `<Record>`). The TwiML App (outgoing app calls, including 9-1-1) is deliberately not changed.
- **"Tester ma connexion" (web app, Audio tab):** runs Twilio's preflight with a fresh token. The API answers a call with no `To` from a signed-in user with a short message, a 12-second pause and a hang-up (rate-limited to 10 per hour, nothing dialed). The panel shows quality (excellent/good/fair/poor), jitter, packet loss, round-trip time, TURN and the edge, plus a Wi-Fi tip when quality is fair or poor.
- **Owner steps:** create the TwiML Bin, set `TWILIO_VOICE_FALLBACK_URL` (and optionally `TWILIO_SMS_FALLBACK_URL`) on the API in Coolify, redeploy, check the `number fallback backfill done` log line, and spot-check one new and one old number in the Twilio console.
