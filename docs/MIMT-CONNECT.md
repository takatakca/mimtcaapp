# MIMT Connect (plateforme partenaire)

Demande du propriétaire (2026-10-29) : besoinavocat.ca, client de TAKATAK et site de référence d'avocats, veut faire
rouler tout son téléphone sur MIMT. Un seul numéro public sur le site « chasse » un groupe d'avocats; chaque avocat a son
identifiant chez besoinavocat, et les minutes, les enregistrements (avec l'avis de consentement existant) et les
métadonnées de chaque appel reviennent dans la base de données de besoinavocat, par identifiant d'avocat. MIMT gagne
le revenu en crédits. **MIMT Connect est générique** : besoinavocat est le premier partenaire, d'autres entreprises
clientes de TAKATAK suivront avec le même code. Aucun service tiers payant : les crédits sont internes à MIMT.

Code : `apps/api/src/routes/partners.ts` (API), `apps/api/src/services/partners.ts` (règles, crochets du standard,
webhooks), `apps/api/src/repo/partners*.ts` (stockage), `supabase/migrations/0023_partners.sql` (tables et contraintes),
`packages/shared/src/partners.ts` (contrat), `apps/webphone/src/pages/business/Partner.tsx` (section « Partenaire »).
Tests : `apps/api/test/partners.test.ts`, `apps/api/test/partners.repo.contract.test.ts` (mémoire et Postgres),
`apps/webphone/src/pages/business/Partner.test.tsx`.

## Interrupteur

`PARTNERS=on|off`, **`off` par défaut**. Éteint : toutes les routes de ce document répondent 404 (comme si elles
n'existaient pas, même sans authentification), aucun crochet ne touche aux appels (le TwiML est identique à avant) et
aucun webhook ne part. Les données sont gardées. `PARTNER_CREDIT_PER_MINUTE` (défaut `1`) est le tarif par défaut.

## Modèle

| Partenaire (MIMT Connect) | Standard MIMT Affaires existant |
| --- | --- |
| Partenaire | Une entreprise MIMT existante (`businesses`), une seule fois |
| Membre (`externalId` du partenaire, ex. `avocat-42`) | Un poste (`extensions`), numéro attribué automatiquement à partir de 2000 |
| Groupe de chasse (`key`, ex. `trouver-un-avocat`) | Un groupe d'appel (`ring_groups`) : simultané ou séquentiel, délai, messagerie ou au revoir |
| Numéro public du groupe (`did`) | La route du numéro (`did_routes`) vers le groupe d'appel |
| Enregistrement | L'enregistrement existant (forfait Affaires Pro, politique « tous », avis de consentement lu à l'appelant) |

Un membre sonne sur son cellulaire (`phone`, avec le « appuyez sur 1 » existant : une boîte vocale du cellulaire ne
répond jamais à sa place) ou dans ses applications MIMT (`handle` @nom, à condition que la personne soit déjà membre
active de l'entreprise : un partenaire ne peut pas faire sonner un inconnu). Un membre désactivé garde son poste et son
historique, mais ne sonne plus.

## Authentification

- **Clés d'API** : `mimt_pk_` + 32 octets aléatoires. Montrée **une seule fois** à la création. MIMT ne garde que le
  SHA-256 et les 14 premiers caractères (pour la reconnaître). Au plus 5 clés actives. Révocation immédiate. Rotation =
  nouvelle clé + révocation de l'ancienne (pour un chevauchement : créer une 2e clé, déployer, puis révoquer la 1re).
- En-tête : `Authorization: Bearer mimt_pk_…`. Limite : 120 requêtes par minute par clé (429 `rate_limited`), plus la
  limite générale par adresse IP.
- Partenaire suspendu : 403 `partner_suspended`. Clé inconnue ou révoquée : 401 `invalid_api_key`.

## Référence de l'API partenaire

Base : `https://api.mimt.ca`. Toutes les réponses sont en JSON; les erreurs sont `{ "error": "<code>", "message": "…" }`.

```bash
export MIMT_KEY="mimt_pk_…"
H="Authorization: Bearer $MIMT_KEY"
```

### `PUT /v1/partner/members/:externalId` — créer ou mettre à jour un membre (idempotent)

```bash
curl -X PUT https://api.mimt.ca/v1/partner/members/avocat-42 -H "$H" -H "content-type: application/json" \
  -d '{"name":"Me Julie Tremblay","email":"jtremblay@cabinet.ca","phone":"+15145550142","language":"fr","active":true}'
```

`name` (1-80) obligatoire; `email`, `phone` (Canada/É.-U., pas de numéro surtaxé), `handle` (@nom MIMT), `language`
(`fr` par défaut), `active` (`true` par défaut). Réponse `201` à la création, `200` ensuite (même poste, rien de neuf) :

```json
{ "externalId": "avocat-42", "name": "Me Julie Tremblay", "email": "jtremblay@cabinet.ca", "phone": "+15145550142",
  "handle": null, "language": "fr", "active": true, "extension": "2000", "createdAt": "…", "updatedAt": "…" }
```

### `GET /v1/partner/members`, `GET /v1/partner/members/:externalId`, `DELETE /v1/partner/members/:externalId`

`DELETE` **désactive** (historique gardé, plus aucune sonnerie) et renvoie le membre.

### `PUT /v1/partner/hunt-groups/:key` — groupe de chasse

```bash
curl -X PUT https://api.mimt.ca/v1/partner/hunt-groups/trouver-un-avocat -H "$H" -H "content-type: application/json" \
  -d '{"name":"Trouver un avocat","members":["avocat-42","avocat-7"],"strategy":"simultaneous","ringTimeoutS":25,
       "fallback":"voicemail","did":"+15145550100"}'
```

`members` : identifiants externes, dans l'ordre pour `sequential`. `ringTimeoutS` : 5 à 120 s (défaut 20), pour tout le
groupe en simultané, par membre en séquentiel. `fallback` : `voicemail` (défaut, la messagerie du groupe) ou `hangup`.
`did` (facultatif) : un numéro de l'entreprise, routé vers ce groupe. Exige un forfait MIMT Affaires (403
`plan_required`). `GET /v1/partner/hunt-groups` liste les groupes.

### `GET /v1/partner/calls?since=&member=&limit=`

```bash
curl "https://api.mimt.ca/v1/partner/calls?since=2026-10-29T00:00:00Z&member=avocat-42" -H "$H"
```

Du plus ancien au plus récent, `startedAt` strictement après `since`; `limit` 1 à 200 (défaut 100). Pour suivre :
repasser `nextSince` comme `since` (null = fin).

```json
{ "calls": [ { "id": "…", "direction": "inbound", "huntGroup": "trouver-un-avocat", "externalId": "avocat-42",
  "from": "+14385550199", "to": "+15145550100", "startedAt": "…", "answeredAt": "…", "endedAt": "…", "durationS": 412,
  "credits": 14, "billing": "billed",
  "recordingUrl": "https://api.mimt.ca/v1/business/…/recordings/…/audio?token=…", "recordingUrlExpiresAt": "…" } ],
  "nextSince": null }
```

`durationS` = temps de conversation avec le membre. `billing` : `billed`, `partial`, `unbilled`, `free` (personne n'a
répondu), `pending` (en cours). **`recordingUrl` passe toujours par notre API** (lien signé de 15 minutes), jamais
l'adresse Twilio.

### `GET /v1/partner/recordings/:id`

Un lien frais (15 minutes) pour un enregistrement : `{ "recordingId", "url", "expiresAt" }`. À utiliser après le
webhook `recording.ready`, qui ne contient que l'identifiant.

### `GET /v1/partner/credits`

`{ "balance": 4820, "creditPerMinute": 2, "ledger": [ { "id", "delta", "reason": "topup|call|adjustment", "reference",
"balanceAfter", "createdAt" } ] }` (100 derniers mouvements).

## Crédits

- **Registre en ajout seulement** (`partner_credit_ledger`, même modèle que les Points en 0018) : déclencheur qui refuse
  `UPDATE` et `DELETE`, clé d'idempotence unique par mouvement (`call:<CallSid>`, `topup:<clé>`), solde
  `partners.credit_balance` modifié dans la même transaction après `select … for update`, `CHECK (… >= 0)` sur le solde
  et sur `balance_after` : **le solde ne passe jamais sous zéro**, même avec deux appels qui finissent en même temps.
- **Débit** : à la fin de l'appel, une seule fois, `ceil(secondes de conversation / 60) × tarif` (tarif du partenaire,
  sinon `PARTNER_CREDIT_PER_MINUTE`). Seuls les appels **répondus par un membre** coûtent; un appel sans réponse
  (messagerie comprise) est `free`. Temps de conversation : la durée de la jambe du membre qui a répondu; si l'appel se
  termine avant que Twilio nous l'envoie, de la réponse à la fin de l'appel.
- **Recharge** : administrateurs MIMT seulement pour l'instant (`POST /v1/admin/partners/:id/credits`, journalisée).
  Une recharge Stripe pourra appeler la même fonction (`topUpCredits`) plus tard.
- **Choix : on ne laisse jamais tomber un appelant.** À zéro crédit, les appels du groupe de chasse **sonnent quand
  même**. Le débit prend ce qui reste (`partial`) ou rien (`unbilled`), le solde s'arrête à zéro, et `call.completed`
  donne `unbilled_credits`. Une alerte part **une fois par solde vide** (journal d'erreur pour la surveillance + ligne
  d'audit `partner.credits_exhausted`), réarmée par la recharge suivante. Raison : pour un service de référence
  d'avocats, un client qui appelle et n'obtient rien est pire qu'un manque à gagner de quelques minutes, que MIMT
  récupère en facturant la recharge.

## Webhooks vers le partenaire

Événements : `call.ringing`, `call.answered` (avec `member_external_id`), `call.completed` (durée, crédits) et
`recording.ready`. Corps :

```json
{ "id": "<id de l'événement>", "type": "call.completed", "created_at": "2026-10-29T15:07:12.000Z",
  "data": { "partner_id": "…", "call_id": "…", "member_external_id": "avocat-42", "hunt_group": "trouver-un-avocat",
            "answered_at": "…", "ended_at": "…", "duration_s": 412, "credits": 14, "billing": "billed", "unbilled_credits": 0 } }
```

- `call.ringing` : `call_id`, `hunt_group`, `from`, `to`, `started_at`. `call.answered` : `call_id`,
  `member_external_id`, `hunt_group`, `answered_at`. `recording.ready` : `call_id`, `recording_id`,
  `member_external_id`, `duration_s`.
- **Identifiants et métadonnées seulement** : jamais d'audio, jamais de transcription (v1 n'en envoie aucune; une
  transcription ne sera ajoutée que si le partenaire active l'IA avec consentement).
- En-têtes : `X-MIMT-Signature: t=<secondes unix>,v1=<HMAC-SHA256 hex de "<t>.<corps brut>">`, `X-MIMT-Event`,
  `X-MIMT-Delivery` (= `id`, pour dédoublonner). Secret `whsec_…`, montré une seule fois (première adresse ou
  « nouveau secret »), gardé chiffré.
- Livraison : file `partner_webhook_events` vidée toutes les 15 s par l'API (même modèle que l'outbox TAKATAK). Une
  réponse 2xx = livré. Sinon (redirection comprise) : nouvel essai après 30 s, 1 min, 2 min… jusqu'à 4 h, **abandon
  après 10 essais**. Délai de 10 s par envoi. Adresse : https publique seulement (pas d'IP, pas de `localhost`, pas
  d'identifiants dans l'URL). Livraison « au moins une fois » : dédoublonner sur `id`.

### Vérifier la signature (Node)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

/** rawBody: le corps EXACT reçu (Buffer ou chaîne), avant JSON.parse. */
export function verifyMimtSignature(rawBody, header, secret, toleranceS = 300) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const [, t, v1] = m;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceS) return false; // rejeu
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Express : app.post("/api/mimt/webhook", express.raw({ type: "application/json" }), (req, res) => {
//   if (!verifyMimtSignature(req.body, req.get("X-MIMT-Signature"), process.env.MIMT_WEBHOOK_SECRET)) return res.sendStatus(401);
//   const event = JSON.parse(req.body); /* upsert par event.id */ res.sendStatus(204);
// });
```

## Administration (MIMT)

Même liste que `/v1/admin/affiliates` (`CATALOG_ADMIN_USER_IDS`), chaque action journalisée :

| Méthode | Route | Effet |
| --- | --- | --- |
| `GET` | `/v1/admin/partners`, `/v1/admin/partners/:id` | liste; détail avec clés (préfixes) et registre |
| `POST` | `/v1/admin/partners` | `{ businessId, name?, creditPerMinute? }` : l'entreprise devient partenaire |
| `PATCH` | `/v1/admin/partners/:id` | `name`, `status` (`active`/`suspended`), `creditPerMinute` (null = défaut) |
| `POST` | `/v1/admin/partners/:id/keys` | nouvelle clé (montrée une fois) |
| `POST` | `/v1/admin/partners/:id/keys/:keyId/rotate` | nouvelle clé + révocation de l'ancienne |
| `DELETE` | `/v1/admin/partners/:id/keys/:keyId` | révocation |
| `PUT` | `/v1/admin/partners/:id/webhook` | `{ url, rotateSecret? }` |
| `POST` | `/v1/admin/partners/:id/credits` | `{ credits, idempotencyKey, note? }` : recharge |

Le propriétaire de l'entreprise a les mêmes gestes (clés, webhook) dans l'app Web, section **Partenaire** du portail
Affaires (`/v1/business/:id/partner*`, rôle propriétaire seulement), avec le solde et les 20 derniers appels.

## Mise en place : besoinavocat.ca

1. **Entreprise** : le compte de besoinavocat prend le forfait **MIMT Affaires Pro** (groupes d'appel +
   enregistrement), crée son standard (app Web, `/affaires/nouvelle`) et obtient le numéro public, par exemple
   `+1 514 555-0100`. Adresse 9-1-1 enregistrée comme pour toute entreprise.
2. **Enregistrement** (si voulu) : Affaires › Enregistrements, politique « tous les appels »; l'avis de consentement
   (« Cet appel peut être enregistré… », français d'abord) est lu à chaque appelant avant la sonnerie.
3. **Partenaire** (MIMT) : `POST /v1/admin/partners {"businessId":"…","creditPerMinute":2}`, puis une recharge
   `POST /v1/admin/partners/:id/credits {"credits":5000,"idempotencyKey":"besoinavocat-2026-11"}`.
4. **Clé et webhook** (propriétaire, section Partenaire) : créer la clé « Site besoinavocat.ca » et la mettre dans les
   secrets du serveur de besoinavocat; adresse du webhook `https://besoinavocat.ca/api/mimt/webhook`, garder le secret.
5. **Avocats** : le serveur de besoinavocat pousse chaque avocat avec **son propre identifiant** :
   `PUT /v1/partner/members/<id avocat>` (nom, courriel, cellulaire, langue). À refaire à chaque changement (idempotent);
   `DELETE` quand un avocat quitte.
6. **Groupe « Trouver un avocat »** : `PUT /v1/partner/hunt-groups/trouver-un-avocat` avec les avocats disponibles,
   `simultaneous` (le premier qui appuie sur 1 prend l'appel) ou `sequential`, et `did` = le numéro public. Pour changer
   qui est disponible, renvoyer la liste.
7. **Retour dans la base de besoinavocat** : recevoir les webhooks (vérifier la signature, dédoublonner sur `id`),
   enregistrer par `member_external_id` : `call.answered` (qui a répondu), `call.completed` (durée, crédits),
   `recording.ready` (puis `GET /v1/partner/recordings/:id` pour écouter). Rattrapage ou réconciliation :
   `GET /v1/partner/calls?since=…`.
8. **Plus tard** : appels vidéo avec les Réunions MIMT (LiveKit) existantes.

## Loi 25 (Québec) et protection des renseignements

- **besoinavocat est notre client**; ses appelants sont les clients de besoinavocat. Pour ces appels, **MIMT agit comme
  fournisseur de services** (sous-traitant) de besoinavocat, qui reste responsable des renseignements de ses appelants
  et de ses avocats.
- **Une entente de traitement (DPA) est nécessaire** avant la mise en service : finalités (acheminement, facturation,
  enregistrement si activé), mesures de sécurité, sous-traitants (Twilio, hébergement de l'API),
  conservation (enregistrements : durée de la politique de l'entreprise, puis suppression), avis d'incident,
  retour ou destruction en fin de contrat. Évaluation des facteurs relatifs à la vie privée si des renseignements
  sortent du Québec (Twilio).
- **Données minimales** : les webhooks et l'API ne portent que des identifiants, numéros, heures, durées et crédits.
  Pas d'audio dans les webhooks; les enregistrements passent par des liens signés de 15 minutes. Pas de transcription.
  Les clés d'API sont hachées, le secret de webhook est chiffré, les numéros des membres servent seulement à les faire
  sonner.
- **Consentement à l'enregistrement** : l'avis existant est lu à chaque appelant avant toute sonnerie quand
  l'enregistrement est actif. besoinavocat doit aussi l'indiquer dans sa politique de confidentialité.
- Le secret professionnel des avocats : MIMT n'écoute pas les conversations. Les résumés IA des enregistrements
  (Affaires Pro) ne s'exécutent qu'avec le consentement IA du propriétaire : à laisser désactivés pour besoinavocat,
  sauf entente écrite.

## Reporté (pas dans la v1)

- Recharge par Stripe (la fonction `topUpCredits` est prête), alerte par courriel au partenaire quand le solde est vide.
- Appels sortants des membres au nom du partenaire, et appels d'un client depuis l'app MIMT vers le numéro du
  partenaire (non suivis en v1 : seuls les appelants de l'extérieur créent un appel partenaire).
- Transcriptions dans les webhooks (seulement avec IA activée et consentement), vidéo (Réunions LiveKit).
- Disponibilité des avocats gérée chez MIMT (horaires par membre) : en v1, le partenaire renvoie la liste du groupe.

---

## English summary

**MIMT Connect** turns an existing MIMT business account into a *partner* that a client's own system drives with API
keys and signed webhooks. besoinavocat.ca (lawyer referrals) is the first partner; nothing is specific to it. Kill
switch `PARTNERS=on|off`, default **off** (every route 404, call routing unchanged, no webhooks).

- **Mapping**: member (`externalId`) → PBX extension (auto-numbered from 2000; rings a mobile with the press-1 whisper
  or the MIMT apps of an existing business member by @handle); hunt group (`key`) → ring group
  (simultaneous/sequential, timeout, voicemail or hang-up fallback), optionally routing a business number (`did`).
- **Auth**: `Authorization: Bearer mimt_pk_…`, shown once, stored as SHA-256 + 14-char prefix, revoke/rotate,
  120 req/min per key. Admin routes use the `/v1/admin/affiliates` allowlist (`CATALOG_ADMIN_USER_IDS`); owners manage
  keys and the webhook in the web app's **Partenaire** section.
- **API**: `PUT/GET/DELETE /v1/partner/members[/:externalId]` (idempotent upsert, delete = deactivate),
  `PUT/GET /v1/partner/hunt-groups[/:key]`, `GET /v1/partner/calls?since=&member=` (talk seconds, credits, billing,
  signed recording URL through our API, never Twilio's), `GET /v1/partner/recordings/:id`, `GET /v1/partner/credits`.
- **Credits**: append-only ledger with idempotency keys and a locked, never-negative balance (0018 points pattern);
  answered calls debit `ceil(talk s / 60) × rate` once, at the end of the call; rate per partner or
  `PARTNER_CREDIT_PER_MINUTE`; admin-only, audited top-up. **With no credits the caller still rings** (we never drop a
  caller): the call is `partial` or `unbilled`, the balance stops at zero, one alert per empty balance.
- **Webhooks**: `call.ringing`, `call.answered`, `call.completed`, `recording.ready`; ids and metadata only (no audio,
  no transcript); `X-MIMT-Signature: t=<ts>,v1=<hex HMAC-SHA256 of "<ts>.<body>">`; outbox with backoff 30 s → 4 h,
  dead after 10 attempts, https public hosts only, redirects refused. Node verification code above.
- **PBX hooks**: `pbxInbound` (ringing), a new leg status webhook `/webhooks/twilio/pbx/leg` plus the whisper press-1
  (who answered, talk time), the parent call status callback (debit + completed) and the recording webhook. Partner
  businesses only; others get byte-identical TwiML.
- **Law 25**: the partner is our client and MIMT acts as its service provider; a DPA is required before go-live; data
  is kept minimal; the existing consent prompt is played whenever recording is on.
