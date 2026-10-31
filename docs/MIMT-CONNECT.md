# MIMT Connect (plateforme partenaire)

Demande du propriétaire (2026-10-29) : besoinavocat.ca, client de TAKATAK et site de référence d'avocats, veut faire
rouler tout son téléphone sur MIMT. Un seul numéro public sur le site « chasse » un groupe d'avocats; chaque avocat a son
identifiant chez besoinavocat, et les minutes, les enregistrements (avec l'avis de consentement existant) et les
métadonnées de chaque appel reviennent dans la base de données de besoinavocat, par identifiant d'avocat. MIMT gagne
le revenu en crédits. **MIMT Connect est générique** : besoinavocat est le premier partenaire, d'autres entreprises
clientes de TAKATAK suivront avec le même code. Aucun service tiers payant : les crédits sont internes à MIMT.

Code : `apps/api/src/routes/partners.ts` (API), `apps/api/src/services/partners.ts` (règles, crochets du standard,
webhooks), `apps/api/src/services/partnerLinks.ts` (liaison de compte, ligne, appel au nom d'un membre),
`apps/api/src/services/partnerMembers.ts` (lot B : forfait, transferts de numéro, disponibilité),
`apps/api/src/repo/partners*.ts` (stockage), `supabase/migrations/0023_partners.sql`, `0027_partner_links.sql` et `0028_partner_member_status.sql`
(tables et contraintes), `packages/shared/src/partners.ts` (contrat), `apps/webphone/src/pages/business/Partner.tsx`
(section « Partenaire »), `apps/webphone/src/pages/PartnerLink.tsx` (page de consentement `/lier`) et la carte
« Partenaires » de `apps/webphone/src/pages/Integrations.tsx`.
Tests : `apps/api/test/partners.test.ts`, `apps/api/test/partnerLinks.test.ts`, `apps/api/test/partnerMembers.test.ts`, `apps/api/test/partners.repo.contract.test.ts`
(mémoire et Postgres), `apps/webphone/src/pages/business/Partner.test.tsx`, `apps/webphone/src/pages/PartnerLink.test.tsx`.

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
répond jamais à sa place) ou dans ses applications MIMT : soit par `handle` @nom (la personne doit déjà être membre
active de l'entreprise), soit, depuis le lot A, par **liaison de compte** (la personne a approuvé le lien elle-même,
voir plus bas). Un partenaire ne peut jamais faire sonner un inconnu. Quand un membre est relié, ses applications MIMT
sonnent (identité client = identifiant de l'utilisateur MIMT), à la place du @nom; le cellulaire reste tel quel. Un membre désactivé garde son poste et son
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

### Liaison de compte (lot A, issue #97)

Chaque avocat a **son propre compte MIMT**, choisit son numéro et paie son forfait dans app.mimt.ca. Le partenaire ne
relie un membre (`externalId`) à un vrai compte MIMT **qu'avec la preuve et le consentement de cette personne**.

#### `POST /v1/partner/members/:externalId/link-requests` — demander la liaison

```bash
curl -X POST https://api.mimt.ca/v1/partner/members/avocat-42/link-requests -H "$H"
```

Réponse `201` :

```json
{ "requestId": "8a1e…", "code": "K7QM4XPA", "url": "https://app.mimt.ca/lier?code=K7QM4XPA&r=8a1e…",
  "expiresAt": "2026-10-30T15:15:00.000Z" }
```

- **Code à usage unique** : 8 caractères sans caractères ambigus (pas de 0/O, 1/I/L), valide **15 minutes**, gardé
  **haché** (SHA-256) chez MIMT. Une nouvelle demande pour le même membre annule la précédente.
- Le portail montre le code et le lien à l'avocat (bouton « Relier mon compte MIMT »). Base de l'URL : `APP_BASE_URL`.
- `409 member_already_linked` si le membre est déjà relié (le délier d'abord), `409 member_inactive` s'il est désactivé.

Côté MIMT, la personne **connectée** ouvre `/lier?code=…`. La page affiche « {partenaire} veut relier votre compte MIMT
à votre profil (identifiant …) » et ce que le partenaire pourra voir et faire : les appels de ses lignes, les appels
lancés en son nom, le numéro qu'elle choisit. **Autoriser exige une confirmation récente** (clé d'accès ou code par
texto, `requireRecentAuth`, docs/MIMT-SECURITY.md), puis appelle `POST /v1/me/partner-links/approve {code, requestId}`.

- **Unicité** : un compte MIMT est relié à au plus **un** membre par partenaire (`409 already_linked_to_partner`), et un
  membre à au plus un compte (`409 member_already_linked`). Garanti par des index uniques partiels (0027).
- **Force brute** : approve et preview limités par utilisateur (10 / 15 min) et par adresse IP (30 / 15 min), `429
  rate_limited`. Avec l'identifiant de la demande (`r=` dans le lien), **5 mauvais codes tuent la demande** (`410
  link_code_expired`). Code inconnu : `400 invalid_link_code`; expiré, déjà utilisé ou annulé : `410 link_code_expired`.
- Webhook `member.linked` `{ member_external_id, linked_at }` (aucun identifiant d'utilisateur MIMT).

#### `DELETE /v1/partner/members/:externalId/link` — délier (côté partenaire)

```bash
curl -X DELETE https://api.mimt.ca/v1/partner/members/avocat-42/link -H "$H"   # 204, 404 link_not_found si pas relié
```

La personne peut aussi retirer le lien elle-même, en tout temps, dans **Compte › Intégrations › Partenaires**
(`GET /v1/me/partner-links`, `DELETE /v1/me/partner-links/:id`, sans confirmation renforcée : retirer un accès ne
demande pas de preuve). Dans les deux cas : ses applications ne sonnent plus pour le partenaire (le @nom ou le
cellulaire du membre restent), la ligne est détachée, webhook `member.unlinked` `{ member_external_id, by:
"user"|"partner", unlinked_at }`.

### La ligne de l'avocat

#### `GET /v1/partner/members/:externalId/numbers`

Les numéros MIMT **actifs** de la personne reliée. Exige un lien actif (sinon `409 member_not_linked`).

```bash
curl https://api.mimt.ca/v1/partner/members/avocat-42/numbers -H "$H"
```

```json
{ "numbers": [ { "e164": "+15145550177" } ], "current": null,
  "chooseNumberUrl": "https://app.mimt.ca/numero?partner=besoinavocat" }
```

#### `PUT /v1/partner/members/:externalId/number`

```bash
curl -X PUT https://api.mimt.ca/v1/partner/members/avocat-42/number -H "$H" -H "content-type: application/json" \
  -d '{"e164":"+15145550177"}'
```

Rattache **un des numéros de la personne reliée elle-même** comme « ligne BesoinAvocat » du membre (`null` la
détache) : afficheur des appels lancés en son nom et `from` dans les registres d'appels. Tout autre numéro est refusé
(`403 number_not_owned`). La propriété est revérifiée à chaque lecture et à chaque appel : un numéro abandonné ou
transféré cesse aussitôt d'être la ligne. Webhook `member.number_changed` `{ member_external_id, number }`.

**Sans lien ou sans numéro**, les réponses donnent `chooseNumberUrl` (`https://app.mimt.ca/numero?partner=<slug>`) :
le portail y envoie l'avocat pour choisir et payer son numéro dans MIMT. **MIMT n'achète jamais un numéro sur la
demande d'un partenaire.** Le membre (`GET /v1/partner/members/:externalId`) donne aussi `linked`, `lineNumber` et
`chooseNumberUrl`.

### `POST /v1/partner/members/:externalId/calls` — appeler au nom d'un membre (click-to-call)

```bash
curl -X POST https://api.mimt.ca/v1/partner/members/avocat-42/calls -H "$H" -H "content-type: application/json" \
  -d '{"to":"+14385550199","reference":"dossier-881"}'
# 201 {"callId":"…"}
```

1. Exige un lien actif et une ligne (`409 member_not_linked` ou `409 member_number_required`, avec `chooseNumberUrl`).
2. `to` : Canada/É.-U. seulement; **jamais** le 9-1-1, un code N11 (2-1-1 à 9-1-1), un numéro surtaxé 900/976 ni un
   indicatif NANP coûteux (Antilles…) : `400 destination_not_allowed` (mêmes règles que `fraud/destinations.ts`).
   Limite par membre : 6 appels par minute et 60 par heure (`fraud/policy.ts`, `429 rate_limited`), un seul appel à la
   fois (`409 call_in_progress`). Comptes suspendus ou garde de dépense quotidienne : `403 account_restricted`.
3. MIMT fait d'abord sonner l'avocat : ses applications MIMT (`via: "app"`, défaut), ou son cellulaire (`via:
   "mobile"`) avec le « appuyez sur 1 » (une boîte vocale ne lance jamais l'appel).
4. Quand l'avocat répond, MIMT compose `to` avec **l'afficheur = sa ligne**.
5. Webhooks `call.ringing`, `call.answered` (quand `to` répond), `call.completed`, avec `direction: "outbound"`,
   `member_external_id` et `reference`.
- **Facturation : crédits du partenaire**, comme les appels du groupe de chasse (par minute commencée de conversation
  avec `to`, une seule fois, au tarif du partenaire). Les minutes du forfait de l'avocat ne sont pas touchées. Choix :
  cohérence avec les appels entrants; le partenaire paie l'usage qu'il déclenche.
- **Sans crédit : refusé** (`402 insufficient_credits` si le solde ne paie pas une minute). Contrairement aux appels
  entrants, personne n'attend au bout du fil. La durée maximale de l'appel suit le solde (`timeLimit`).
- Twilio : `calls.create` vers l'avocat, TwiML d'étapes PBX signées (`/webhooks/twilio/pbx/c2c-answer`, `c2c-connect`,
  `c2c-leg`, `c2c-status`), toutes sous la vérification `X-Twilio-Signature`.

### Statut du membre (lot B, issue #97, points 3, 4 et 7)

Trois lectures sur l'avocat relié, et sa disponibilité pour les groupes de chasse. **Le forfait et les transferts
exigent un lien actif** (`409 member_not_linked` avec `chooseNumberUrl`, sinon `404 member_not_found`). Comme le reste
de ce document : `PARTNERS=off` = 404.

#### `GET /v1/partner/members/:externalId/subscription` — forfait MIMT de la personne reliée

```bash
curl https://api.mimt.ca/v1/partner/members/avocat-42/subscription -H "$H"
```

```json
{ "plan": "premium", "status": "active", "currentPeriodEnd": "2026-11-30T15:00:00.000Z", "canCall": true,
  "planUrl": "https://app.mimt.ca/compte?partner=besoinavocat#forfait" }
```

- `plan` : le forfait en vigueur (`free` si aucun). `status` : `active`, `trialing`, `past_due` (paiement en retard, le
  service continue), `canceled` (un forfait a existé et a pris fin) ou `none` (jamais acheté). `currentPeriodEnd` : fin
  de la période en cours (ou de la dernière). `canCall` : le compte peut faire et recevoir des appels (ni suspendu ni
  fermé).
- **Minimal (Loi 25)** : jamais de carte, de montant payé, de facture, d'identifiant Stripe ni de canal d'achat.
- `planUrl` : la page Compte › Forfait de l'app (`/compte#forfait`, avec `?partner=<slug>`). Le portail y envoie
  l'avocat pour choisir et payer son forfait lui-même. **MIMT ne facture jamais sur la demande d'un partenaire.**
- Webhook `member.subscription_changed` `{ member_external_id, plan, status, current_period_end, can_call }`, envoyé
  quand le forfait, le statut ou `can_call` change, **seulement pour une personne reliée** : branché là où l'abonnement
  est écrit (webhooks Stripe `customer.subscription.*` et `checkout.session.completed`, App Store, Google Play, mois
  Premium de parrainage). La dernière vue envoyée est gardée par lien (`partner_member_links.subscription_state`, 0028)
  : un même état reçu deux fois n'envoie rien; la vue au moment de l'approbation du lien sert de point de départ. Un
  renouvellement (seule la date change) n'envoie rien : relire `GET …/subscription` au besoin.

#### `GET /v1/partner/members/:externalId/port-ins` — transferts de numéro de la personne reliée

```bash
curl https://api.mimt.ca/v1/partner/members/avocat-42/port-ins -H "$H"
```

```json
{ "portIns": [ { "id": "6f1c…", "e164": "+14505550123", "numbers": [ { "e164": "+14505550123", "status": "foc_scheduled" } ],
                 "status": "foc_scheduled", "updatedAt": "2026-10-30T15:02:11.000Z", "expectedDate": "2026-11-18" } ],
  "portUrl": "https://app.mimt.ca/services/transfert?partner=besoinavocat" }
```

- Les demandes du compte MIMT de la personne, de la plus récente à la plus ancienne. `expectedDate` : la date
  confirmée par l'ancien fournisseur (FOC), sinon la date demandée, sinon `null`.
- **Jamais** le numéro de compte chez l'ancien fournisseur, le NIP, la signature de la lettre d'autorisation, l'adresse
  de service ni les noms.
- `portUrl` : la page Services › Transfert de numéro de l'app (`/services/transfert`).
- Webhook `member.port_in_updated` `{ member_external_id, port_in_id, e164, numbers, status, updated_at,
  expected_date }` quand le statut de la demande, le statut d'un numéro ou une date change : signature et envoi,
  nouvel envoi, annulation, webhook de portage Twilio (`porting/service.ts` `applySnapshot` puis `settle`). Le même
  état reçu deux fois de Twilio n'envoie rien.

#### `GET` et `PUT /v1/partner/members/:externalId/availability` — disponibilité pour les groupes de chasse

```bash
# Occupé jusqu'à 17 h (heure de Montréal = 21 h UTC en heure avancée)
curl -X PUT https://api.mimt.ca/v1/partner/members/avocat-42/availability -H "$H" -H "content-type: application/json" \
  -d '{"status":"busy","until":"2026-10-30T21:00:00Z"}'
# Disponible, mais seulement du lundi au vendredi de 9 h à 17 h (America/Montreal)
curl -X PUT https://api.mimt.ca/v1/partner/members/avocat-42/availability -H "$H" -H "content-type: application/json" \
  -d '{"status":"available","weekly":{"mon":[{"open":"09:00","close":"17:00"}],"tue":[{"open":"09:00","close":"17:00"}],
       "wed":[{"open":"09:00","close":"17:00"}],"thu":[{"open":"09:00","close":"17:00"}],"fri":[{"open":"09:00","close":"17:00"}],
       "sat":[],"sun":[]}}'
```

```json
{ "externalId": "avocat-42", "status": "available", "weekly": { "mon": [ { "open": "09:00", "close": "17:00" } ], "…": [] },
  "until": null, "userStatus": null, "effectiveStatus": "available", "source": "partner", "updatedAt": "…" }
```

- `status` : `available`, `busy` ou `offline` (obligatoire). `weekly` (facultatif) : **la même forme que les heures
  d'ouverture du standard** (`PUT /v1/business/:id/hours`, 7 jours, 6 plages par jour au plus, `close` exclue),
  heure de Montréal. `until` (facultatif) : dans le futur, au plus un an. `PUT` **remplace** le réglage du partenaire :
  un champ omis est effacé. Il ne touche jamais au choix de l'avocat. Aucun lien n'est exigé (un membre sans compte
  MIMT, sonné sur son cellulaire, a aussi une disponibilité).
- **Règle (dans l'ordre)** :
  1. aucun réglage : disponible (comportement d'avant le lot B);
  2. **le choix de l'avocat l'emporte** : s'il a choisi un statut dans l'app (Compte › Intégrations › Partenaires),
     celui-ci remplace le statut du partenaire et son `until`, jusqu'à ce qu'il revienne à « Selon le partenaire »;
  3. sinon le statut du partenaire, jusqu'à `until`; après `until`, disponible;
  4. un statut « disponible » reste borné par `weekly` : hors des plages, hors ligne (`source: "schedule"`), que le
     statut vienne du partenaire ou de l'avocat.
  `effectiveStatus` et `source` (`user`, `partner`, `schedule`, `default`) disent ce qui s'applique maintenant.
- **Groupes de chasse** : à chaque appel (et à chaque étape d'un groupe séquentiel), les membres qui ne sont pas
  disponibles à ce moment **ne sonnent pas**. Si personne n'est disponible, l'appel suit tout de suite le repli du
  groupe en cas de non-réponse (messagerie du groupe par défaut, ou au revoir si `fallback: "hangup"`), sans faire
  sonner personne : **on ne laisse jamais tomber un appelant**. `call.ringing` part quand même. Les entreprises qui ne
  sont pas partenaires, un partenaire suspendu et `PARTNERS=off` sonnent exactement comme avant (testé).
- Côté avocat : `PUT /v1/me/partner-links/:id/availability {"status":"busy"|"available"|"offline"|null}` (session
  MIMT, propriétaire du lien seulement, sans confirmation renforcée : ce réglage ne donne aucun accès). La carte
  Partenaires montre « Ma disponibilité pour ce partenaire » (Selon le partenaire, Disponible, Occupé, Hors ligne) et
  ce qui s'applique en ce moment; `GET /v1/me/partner-links` donne `userStatus` et `effectiveStatus`.
- Webhook `member.availability_changed` `{ member_external_id, effective_status, source, partner_status,
  user_status, until, has_schedule, changed_by: "partner"|"user" }` à chaque changement de réglage (pas quand une
  plage horaire commence ou finit, ni à l'échéance de `until` : `effective_status` est calculé au moment du
  changement).

### `GET /v1/partner/calls?since=&member=&limit=`

```bash
curl "https://api.mimt.ca/v1/partner/calls?since=2026-10-29T00:00:00Z&member=avocat-42" -H "$H"
```

Du plus ancien au plus récent, `startedAt` strictement après `since`; `limit` 1 à 200 (défaut 100). Pour suivre :
repasser `nextSince` comme `since` (null = fin).

```json
{ "calls": [ { "id": "…", "direction": "inbound", "reference": null, "huntGroup": "trouver-un-avocat", "externalId": "avocat-42",
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

Événements : `call.ringing`, `call.answered` (avec `member_external_id`), `call.completed` (durée, crédits),
`recording.ready`, depuis le lot A `member.linked`, `member.unlinked` et `member.number_changed`, et depuis le lot B
`member.subscription_changed`, `member.port_in_updated` et `member.availability_changed` (champs plus haut, « Statut
du membre »). Les événements
d'appel portent `direction` (`inbound` ou `outbound`); un appel lancé au nom d'un membre ajoute `reference`. Corps :

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
- `member.linked` : `member_external_id`, `linked_at`. `member.unlinked` : `member_external_id`, `by` (`user` ou
  `partner`), `unlinked_at`. `member.number_changed` : `member_external_id`, `number` (E.164 ou `null`).
- **Adresse configurable** : n'importe quelle URL https publique, sous-domaines compris (par exemple
  `https://portail.besoinavocat.ca/api/mimt/webhook`). Elle se change en tout temps (section Partenaire ou
  `PUT …/webhook`).
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
| `POST` | `/v1/admin/partners` | `{ businessId, name?, slug?, creditPerMinute? }` : l'entreprise devient partenaire (`slug` par défaut tiré du nom, unique) |
| `PATCH` | `/v1/admin/partners/:id` | `name`, `slug`, `status` (`active`/`suspended`), `creditPerMinute` (null = défaut) |
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
3. **Partenaire** (MIMT) : `POST /v1/admin/partners {"businessId":"…","slug":"besoinavocat","creditPerMinute":2}`, puis une recharge
   `POST /v1/admin/partners/:id/credits {"credits":5000,"idempotencyKey":"besoinavocat-2026-11"}`.
4. **Clé et webhook** (propriétaire, section Partenaire) : créer la clé « Site besoinavocat.ca » et la mettre dans les
   secrets du serveur de besoinavocat; adresse du webhook `https://portail.besoinavocat.ca/api/mimt/webhook` (le
   portail des avocats; l'adresse est configurable et peut changer en tout temps), garder le secret.
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
8. **Avocats reliés** (lot A) : pour chaque avocat, le portail lance `POST …/link-requests` et l'avocat approuve dans
   MIMT (voir « Parcours avocat »); puis `PUT …/number` avec la ligne qu'il a choisie, et les boutons « Appeler » du
   portail appellent `POST …/calls`.
9. **Plus tard** : appels vidéo avec les Réunions MIMT (LiveKit) existantes.

## Parcours avocat

1. **Inscription dans MIMT** : l'avocat crée son propre compte sur app.mimt.ca (ou depuis le lien `chooseNumberUrl`
   que lui donne le portail).
2. **Numéro** : il choisit son numéro dans MIMT (`/numero?partner=besoinavocat`).
3. **Forfait** : il choisit son forfait MIMT.
4. **Paiement** : il paie lui-même, dans MIMT (Stripe). BesoinAvocat ne paie ni ne choisit à sa place.
5. **Liaison** : dans le portail BesoinAvocat, « Relier mon compte MIMT » → code et lien `/lier` → il approuve dans
   MIMT, avec une confirmation (clé d'accès ou code par texto). Le portail reçoit `member.linked`, lit
   `GET …/numbers` et attache sa ligne (`PUT …/number`, webhook `member.number_changed`).
6. **Appels dans le portail** : les appels du groupe de chasse sonnent dans ses applications MIMT; « Appeler » dans le
   portail fait sonner son application, puis compose le client avec sa ligne comme afficheur. Il retire le lien quand
   il veut (Compte › Intégrations › Partenaires).

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
- **Liaison de compte (lot A)** : la personne voit, avant d'accepter, **ce que le partenaire verra et fera** : les
  appels de ses lignes qui lui sont acheminés (numéros, heures, durées, enregistrements si l'entreprise enregistre),
  les appels lancés en son nom (son application sonne d'abord; elle décide de répondre), et le numéro qu'elle choisit
  comme ligne. Depuis le lot B, la page le dit aussi : le statut de son forfait MIMT (jamais carte, montants
  ni factures), l'avancement de ses transferts de numéro (jamais numéro de compte ni NIP) et le réglage de sa
  disponibilité pour les groupes d'appel (son propre choix l'emporte). Les liens approuvés avant le lot B couvrent
  déjà la ligne et les appels; **à décider par le propriétaire** : redemander le consentement aux personnes reliées
  avant le lot B, ou les en informer (aucun lien n'existait en production au moment du lot B). Le partenaire **ne voit pas** ses textos, ses messages vocaux personnels, ses autres appels, ni son
  identifiant MIMT, et ne peut rien acheter en son nom. Le consentement est donné par la personne elle-même
  (connectée + confirmation récente), il est **révocable en tout temps** (Compte › Intégrations › Partenaires), et la
  révocation prend effet immédiatement. Les journaux d'audit ne portent que des identifiants internes (pas de code,
  pas de numéro). Le code n'est jamais gardé en clair.
- Le secret professionnel des avocats : MIMT n'écoute pas les conversations. Les résumés IA des enregistrements
  (Affaires Pro) ne s'exécutent qu'avec le consentement IA du propriétaire : à laisser désactivés pour besoinavocat,
  sauf entente écrite.

## Reporté (pas dans la v1)

- Recharge par Stripe (la fonction `topUpCredits` est prête), alerte par courriel au partenaire quand le solde est vide.
- Appels d'un client depuis l'app MIMT vers le numéro du partenaire (non suivis : seuls les appelants de l'extérieur
  et les appels lancés par l'API créent un appel partenaire).
- Click-to-call : pas d'enregistrement ni d'avis d'enregistrement sur ces appels pour l'instant; leur coût Twilio
  n'entre pas encore dans la garde de dépense quotidienne (qui ne lit que la table `calls`); bannière « Choisissez
  votre numéro pour {partenaire} » sur `/numero?partner=` (le paramètre est accepté mais pas encore affiché).
- Transcriptions dans les webhooks (seulement avec IA activée et consentement), vidéo (Réunions LiveKit).
- ~~Disponibilité des avocats gérée chez MIMT (horaires par membre)~~ : **fait (lot B)**, avec le statut du forfait et
  des transferts de numéro (« Statut du membre »).
- Lot B, limites connues : `member.subscription_changed` ne part pas quand seul le statut du compte change (suspension
  par la garde de dépense ou un administrateur, sans écriture d'abonnement) : `GET …/subscription` le montre;
  `member.availability_changed` ne part pas quand une plage horaire ou `until` arrive à échéance.
- Lot C : jeton vidéo (point 6), recharge Stripe des crédits et commission (point 8).

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
- **Account link (lot A, issue #97)**: `POST /v1/partner/members/:externalId/link-requests` returns an 8-character
  one-time code (no look-alikes, 15 min, stored hashed, single use, a newer request voids the older one) and
  `https://app.mimt.ca/lier?code=…&r=…`. The signed-in MIMT user approves on `/lier` with a step-up
  (`POST /v1/me/partner-links/approve`), seeing what the partner will see and do. One user ↔ one member per partner.
  Brute force: 10 attempts / 15 min per user, 30 per IP, 5 wrong codes on a request kill it. Revocable by the user
  (Account › Integrations › Partners, `GET/DELETE /v1/me/partner-links`) or the partner
  (`DELETE …/link`). Linked members ring the user's MIMT apps (client identity = user id); the cellphone stays.
  Webhooks `member.linked`, `member.unlinked`, `member.number_changed`.
- **Line**: `GET …/numbers` (the linked user's active numbers), `PUT …/number {e164}` attaches one of the user's OWN
  numbers (else `403 number_not_owned`); without a link or number, responses carry
  `chooseNumberUrl: https://app.mimt.ca/numero?partner=<slug>`. MIMT never buys a number for a partner.
- **Click-to-call**: `POST …/calls {to, reference?, via?}` rings the member's apps (or cellphone with press-1), then
  dials `to` with the line as caller ID. Canada/US only, never 9-1-1/N11/900/976/high-cost NANP; 6/min and 60/h per
  member, one at a time. Billed in **partner credits** like hunt-group calls (the member's plan minutes are untouched);
  `402 insufficient_credits` when the balance cannot pay a minute (nobody is waiting on the line); call events carry
  `direction: "outbound"`, `member_external_id`, `reference`. Signed PBX steps `c2c-answer|connect|leg|status`.
- **Member status (lot B, issue #97 points 3, 4, 7)**: `GET …/subscription` (plan, status
  active|trialing|past_due|canceled|none, period end, canCall, `planUrl` = `/compte?partner=<slug>#forfait`; never
  cards, amounts or invoices) and `GET …/port-ins` (id, e164, per-number status, updatedAt, expectedDate, `portUrl` =
  `/services/transfert?partner=<slug>`; never the carrier account number or PIN) need an active link (409).
  `GET/PUT …/availability {status available|busy|offline, weekly? (business-hours shape, America/Montreal), until?}`;
  the linked person's own status (`PUT /v1/me/partner-links/:id/availability`, Account › Integrations › Partners)
  wins over the partner's; « available » stays bounded by the weekly windows. Hunt groups skip members who are not
  available now; with nobody available the group's no-answer fallback (voicemail) runs without ringing anyone.
  Non-partner businesses, suspended partners and PARTNERS=off ring as before. Webhooks
  `member.subscription_changed` (plan/status/can_call changes only, deduped per link), `member.port_in_updated`,
  `member.availability_changed`. Migration 0028.
- **Webhook address**: any public https host incl. subdomains, e.g. `https://portail.besoinavocat.ca/api/mimt/webhook`;
  configurable at any time.
- **PBX hooks**: `pbxInbound` (ringing), a new leg status webhook `/webhooks/twilio/pbx/leg` plus the whisper press-1
  (who answered, talk time), the parent call status callback (debit + completed) and the recording webhook. Partner
  businesses only; others get byte-identical TwiML.
- **Law 25**: the partner is our client and MIMT acts as its service provider; a DPA is required before go-live; data
  is kept minimal; the existing consent prompt is played whenever recording is on. Account links are consented to by
  the person (signed in + step-up), state what the partner sees (calls of its lines, click-to-call, the chosen
  number; never texts, personal voicemail, other calls or the MIMT user id) and are revocable at any time.
