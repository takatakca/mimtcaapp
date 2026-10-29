# Points MIMT (portefeuille et boutique)

Demande du propriétaire (2026-10-28) : « Les clients accumulent des points (parrainage, missions…) et échangent les
points contre ce qu'ils veulent : minutes, textos, options. On va faire nos propres campagnes marketing avec des cibles
de ventes. » Un serveur « vraiment sérieux » : chaque point vient d'un événement vérifié par le serveur, chaque
mouvement est écrit une seule fois dans un registre qu'on ne peut pas réécrire, et le solde ne descend jamais sous zéro.

Code : `packages/shared/src/points.ts` (taux, catalogue, règle économique, types d'API),
`apps/api/src/services/points.ts` (règles), `apps/api/src/repo/points*.ts` (registre),
`supabase/migrations/0018_points.sql` (tables et contraintes), `supabase/migrations/0021_points_clawback.sql` (reprise
des points remboursés, points dus), `apps/api/src/routes/points.ts` (API),
`apps/api/src/jobs/pointsExpiry.ts` (expiration), `apps/webphone/src/pages/Points.tsx` (page `/points`, « Portefeuille »).
Économie : `docs/MIMT-UNIT-ECONOMICS.md`, section « Points ».

## Gagner des points

Aucune route ne permet au client de réclamer des points. Les points sont crédités par les routes et les webhooks qui
voient l'événement, avec **une clé d'idempotence par événement** (un webhook rejoué ou un double clic ne paie jamais
deux fois).

| Source | Déclencheur vu par le serveur | Points | Clé (une fois) |
| --- | --- | ---: | --- |
| Mission « Vérifiez votre cellulaire » | Connexion par texto approuvée par Twilio Verify | 150 | `mission:<compte>:verify_phone` |
| Mission « Choisissez votre @nom » | Premier @nom enregistré | 300 | `mission:<compte>:choose_handle` |
| Mission « Activez les notifications » | Abonnement Web Push vers un vrai service | 150 | `mission:<compte>:enable_push` |
| Mission « Installez l'app mobile » | Appareil attesté (App Attest / Play Integrity) | 300 | `mission:<compte>:install_app` |
| Mission « Obtenez votre numéro » | Numéro acheté sur un forfait payant | 600 | `mission:<compte>:first_number` |
| Missions « Un ami s'abonne » et « Passez à l'annuel » | (inchangé) | 0 : leur récompense est le mois Premium et le mois gratuit | |
| Parrainage converti (parrain) | Première facture payée de l'ami, contrôles anti-fraude existants (même appareil, même carte) | 1 000 | `referral:<parrainage>` |
| Facture Stripe payée | Webhook `invoice.paid` signé | 10 par dollar payé **avant taxes** | `invoice:<id de facture>` |
| Renouvellement App Store | Achat vérifié (`/v1/billing/iap/verify`) ou notification signée `SUBSCRIBED` / `DID_RENEW` | 10 par dollar du prix MIMT du produit | `store:ios:<transactionId>` |
| Renouvellement Google Play | Achat vérifié auprès de Google, ou RTDN `PURCHASED` (4) / `RENEWED` (2) relue auprès de Google | 10 par dollar du prix MIMT du produit | `store:android:<jeton>:<fin de période>` |
| Campagne (propriétaire) | Au moment du gain, si une campagne active vise l'événement | multiplicateur ou bonus fixe | voir plus bas |

- **Missions** : 10 points = 1 minute d'équivalence. Les 150 minutes d'avant deviennent **1 500 points au plus par
  compte** (`MISSION_POINTS_CAP`). Les missions déjà récompensées en minutes **gardent leurs minutes** (affichées
  « +30 min (avant les points) ») et comptent dans le plafond à 10 points par minute. Une mission accordée pendant que
  `POINTS=off` est créditée à la lecture suivante (`GET /v1/points` ou `/v1/missions`) une fois les points rallumés.
- **Avant taxes** : MIMT facture TPS, TVQ et la taxe 9-1-1 sur des lignes à part; le montant payé est réparti au prorata
  des lignes hors taxes. Un crédit au solde Stripe (mois de parrainage, crédit acheté avec des points) diminue le montant
  payé, donc les points. Sans lignes : montant payé ÷ 1,14975.
- **Magasins** : pas de points pour une offre gratuite (`price = 0` chez Apple), une période de grâce, une expiration
  ou un remboursement (et les points d'une période remboursée sont repris : voir « Remboursements et
  rétrofacturations »). La commission d'Apple ou de Google n'est pas retirée : le client gagne sur le prix qu'il voit.
- **Parrainage : le mois Premium est conservé** pour les deux. Raisons : c'est la promesse déjà affichée sur mimt.ca et
  dans l'app (des codes circulent déjà), son coût est déjà compté dans `docs/MIMT-UNIT-ECONOMICS.md`, et le parrainage
  ne se déclenche qu'avec une première facture payée par l'ami. Les 1 000 points du parrain s'ajoutent (coût au pire
  2,52 $, voir l'économie).

## Remboursements et rétrofacturations (reprise des points)

Un client ne peut pas payer, échanger ses points, puis se faire rembourser en gardant la valeur : les points gagnés
par un paiement remboursé ou contesté sont **repris** par une ligne de débit `clawback` du registre, avec une clé
d'idempotence (un webhook rejoué ne reprend jamais deux fois). Code : `clawbackInvoicePoints`, `clawbackStorePoints`
et `clawbackPoints` dans `apps/api/src/services/points.ts`; `clawback` dans `apps/api/src/repo/points*.ts`.

| Événement | Où | Points repris | Clé (une fois) |
| --- | --- | --- | --- |
| Stripe `charge.refunded` (avec la reprise de commission d'affilié) | `routes/billing.ts` | au prorata : points de la facture × `amount_refunded ÷ amount` (montant cumulatif de Stripe), moins ce qui a déjà été repris | `clawback:<facture>:<cents remboursés>` |
| Stripe `charge.dispute.created` (rétrofacturation) | `routes/billing.ts` | tous les points de la facture, moins ce qui a déjà été repris | `clawback:<facture>:dispute` |
| App Store `REFUND` (notification signée V2) | `routes/billing.ts` | tous les points de la transaction remboursée (`store:ios:<transactionId>`) | `clawback:store:ios:<transactionId>` |
| Google Play `voidedPurchaseNotification` (remboursement ou rétrofacturation) | `routes/billing.ts` | tous les points de la **dernière période payée** du jeton d'achat | `clawback:store:android:<jeton>:<fin de période>` |

- **Ce qui est repris** : les points de base du paiement (clé `invoice:<id>` ou `store:…`), les extras de campagne
  multiplicatrice (`<clé>:c:<campagne>`) et un bonus fixe de campagne déclenché par ce paiement (`meta.trigger`). Le
  budget déjà dépensé d'une campagne n'est pas rendu (prudent). Un remboursement partiel puis total, ou une
  contestation après un remboursement partiel, ne reprend que la différence (somme des reprises par paiement,
  `meta.source`).
- **Solde jamais négatif** (règle du registre, `CHECK balance >= 0` inchangé) : si le solde est plus bas que les
  points à reprendre, il est débité jusqu'à 0 et **le reste est noté comme dû** (`points_accounts.owed`). La ligne
  `clawback` est écrite même à 0 (trace, et la clé empêche une deuxième reprise).
- **Points dus : retenus sur les gains suivants, et aucun échange d'ici là.** Choix fait parce qu'il garde les deux
  règles du registre : pas de solde négatif, et chaque mouvement est une ligne. Après chaque crédit (gain, ou points
  remis après un échange raté), dans la même transaction, une ligne `clawback` (référence `owed`, clé
  `owed:<clé du crédit>`) retire du solde ce qui est dû. Tant qu'il reste des points dus, le solde est donc à 0 et
  `POST /v1/points/redeem` répond `409 points_owed` (vérifié dans la transaction d'échange, sous le verrou du solde). Bloquer les échanges seul ne réglerait jamais la dette; retenir sur les gains seul la règle automatiquement.
- **`POINTS=off`** n'empêche pas la reprise (reprendre des points d'un paiement remboursé n'attend jamais).
- **Journal** : `points.clawed_back` avec identifiants internes seulement (compte, ligne du registre, type
  `invoice`/`store`, `refund`/`chargeback`, points, débités, ajoutés aux points dus, solde) : aucun identifiant Stripe,
  Apple ou Google. Un gain qui rembourse des points dus ajoute `repaidOwed` à `points.earned`.
- **Client** : `GET /v1/points` renvoie `owed`; la page `/points` affiche les points dus, et l'historique « Paiement
  remboursé : points retirés » ou « Points dus repris ».
- **Limites connues** : (1) Google Play ne dit pas quelle période d'un abonnement est remboursée (le jeton suffit
  pour annuler l'accès) : la dernière période payée est reprise (cas de loin le plus courant); un remboursement
  partiel Play (`refundType` 2) est traité comme total. (2) Une contestation gagnée (`charge.dispute.closed`,
  `won`) ou un `REFUND_REVERSED` d'Apple ne rend pas les points : à rendre à la main (crédit au besoin) si cela
  arrive. (3) `REVOKE` d'Apple (partage familial retiré) n'est pas un remboursement : rien n'est repris.

## Échanger des points (catalogue)

`POINTS_CATALOG` (`packages/shared/src/points.ts`), modifiable par `POINTS_CATALOG_JSON` (voir les variables).

| id | Récompense | Prix | Qui | Limite / mois | Livraison réelle |
| --- | --- | ---: | --- | ---: | --- |
| `minutes_out_30` | 30 minutes sortantes en prime | 300 | forfait payant | 4 | `usage_ledger.bonus_minutes_out` du mois en cours |
| `minutes_out_100` | 100 minutes sortantes en prime | 1 000 | forfait payant | 2 | idem |
| `minutes_on_net_60` | 60 minutes entre apps MIMT | 150 | forfait Gratuit | 4 | `usage_ledger.bonus_minutes_on_net`, **budget du Gratuit** vérifié avant |
| `texts_50` | 50 textos en prime | 250 | forfait payant | 4 | `usage_ledger.bonus_messages` (nouvelle colonne) : hausse du quota de textos du mois, MMS non compris |
| `ad_free_week` | 1 semaine sans pub | 200 | sans pub autrement (Gratuit, Essentiel) | 4 | abonnement manuel « Sans pub » `points:<échange>` avec date de fin (empilé) |
| `invoice_credit_5` | 5 $ sur la prochaine facture | 2 000 | forfait payé par Stripe (pas un essai) | 1 | crédit au solde client Stripe (CAD), clé `points:<échange>` |

À venir (pas fait, volontairement) : **1 mois du numéro supplémentaire**. Un numéro coûte à Twilio dès qu'il est
attribué et doit être relâché proprement à la fin du mois (cycle de vie, 9-1-1, avis au client) : à faire avec le cycle
de vie des numéros, pas comme un simple droit.

### `POST /v1/points/redeem { rewardId, idempotencyKey }`

1. Refus sans rien débiter : points en pause, compte fermé, récompense inconnue, forfait non admissible, budget du
   Gratuit atteint, points dus après un remboursement (`points_owed`), limite du mois, solde insuffisant.
2. **Une transaction** : verrou sur le solde (`select … for update`), clé du client déjà vue → rejeu (rien de débité,
   même réponse), limite du mois, débit (`CHECK balance >= 0`), échange « en attente ».
3. Livraison (minutes, textos, semaine sans pub, crédit Stripe).
4. Si la livraison échoue : **crédit compensatoire** (`refund`, clé `refund:<échange>`) et échange « remboursé »; la
   réponse est `502 fulfilment_failed` et les points sont revenus.
5. Journal : `points.redeemed`, `points.fulfilled` ou `points.refunded` (identifiants internes seulement).

Limites de débit : 20 requêtes par minute par adresse IP, et 5 échanges d'un coup puis un toutes les 12 s par compte.

## Campagnes (propriétaire)

API réservée aux administrateurs (même liste que `/v1/admin/costs` : `CATALOG_ADMIN_USER_IDS`) :

| Méthode | Route | Effet |
| --- | --- | --- |
| `GET` | `/v1/admin/points/campaigns` | toutes les campagnes, avec budget et dépense |
| `POST` | `/v1/admin/points/campaigns` | crée : `name`, `kind` (`multiplier` ou `bonus`), `target`, `multiplier` (×1,01 à ×3) ou `bonusPoints` (1 à 2 000), `startsAt`, `endsAt`, `budgetPoints` |
| `PATCH` | `/v1/admin/points/campaigns/:id` | change `name`, `endsAt`, `budgetPoints` (jamais sous la dépense), `active` |
| `DELETE` | `/v1/admin/points/campaigns/:id` | arrête la campagne (gardée pour l'historique, jamais effacée) |

Cibles : `purchase` (toute facture ou renouvellement), `purchase_yearly` (forfaits annuels), `referral`, `mission`
(toutes) ou `mission:<id>`. Exemples :

```json
{ "name": "Double points sur l'annuel", "kind": "multiplier", "target": "purchase_yearly", "multiplier": 2,
  "startsAt": "2026-11-02T05:00:00Z", "endsAt": "2026-11-09T05:00:00Z", "budgetPoints": 200000 }
{ "name": "500 points pour le premier numéro", "kind": "bonus", "target": "mission:first_number", "bonusPoints": 500,
  "startsAt": "2026-11-01T04:00:00Z", "endsAt": "2026-12-01T05:00:00Z", "budgetPoints": 100000 }
```

- Appliquée **au moment du gain**, dans la même transaction que le gain : une ligne `campaign` par campagne, liée à la
  campagne. Multiplicateur : extra = points × (multiplicateur − 1). Bonus fixe : une fois par compte et par campagne.
- **Budget** : la campagne s'arrête quand `spent_points` atteint `budget_points` (contrainte de la base : jamais
  dépassé, même avec deux gains simultanés). Le dernier gain est réduit au reste du budget.
- **Chaque changement est journalisé** (`points.campaign_created`, `_updated`, `_stopped`) avec l'administrateur,
  l'adresse IP, et la campagne avant et après.
- Les campagnes actives sont affichées aux clients sur `/points` (nom, multiplicateur ou bonus, date de fin).

## Règles et fraude

- **Aucune valeur en argent**, non transférables, **impossibles à acheter** (aucune route, aucun produit). Le crédit
  sur facture est une remise sur un service MIMT, plafonnée, jamais un versement.
- **Plafonds de gains par compte** : `POINTS_DAILY_EARN_CAP` (5 000 par jour UTC) et `POINTS_MONTHLY_EARN_CAP`
  (20 000 par mois). Au-delà, l'événement est quand même écrit avec 0 point (trace, et la même clé ne paie jamais
  plus tard). Les remboursements d'échanges ratés ne comptent pas.
- **Registre en ajout seulement** : un déclencheur refuse `UPDATE` et `DELETE` sur `points_ledger`; chaque ligne porte
  le solde après mouvement (`CHECK balance_after >= 0`). Une ligne `clawback` est toujours un débit ou 0 (contrainte
  de la base), et `owed` n'est jamais négatif.
- **Conservé à la suppression du compte** (comme les missions, la fraude et le journal) : c'est la trace comptable et
  anti-abus. Aucune donnée personnelle dans ces tables.
- Le parrainage garde ses contrôles (même appareil, même carte) : un parrainage refusé ne donne aucun point.
- Le forfait Gratuit respecte son budget mensuel (`FREE_TIER_MONTHLY_BUDGET_CAD`) : l'échange de minutes entre apps est
  refusé (sans débit) quand le budget est atteint.
- **Expiration après inactivité** : désactivée par défaut. Avec `POINTS_EXPIRY=on`, une tâche quotidienne retire le
  solde des comptes **sans aucun gain ni échange** depuis `POINTS_EXPIRY_MONTHS` mois (12 par défaut), une seule fois
  (`expiry:<compte>:<dernière activité>`), journalisé `points.expired`. À prévoir avant de l'activer : un avis au client
  30 jours avant (courriel ou notification), et la mention dans les conditions.
- **Coupe-circuit** : `POINTS=off` : rien n'est gagné ni échangé, l'expiration est suspendue, les soldes et l'historique
  restent visibles; la page affiche que les points sont en pause.

## Lignes juridiques à ne pas franchir

- Aucun point pour un **avis, une note, un « j'aime », un abonnement ou un partage** sur un réseau social (règles
  d'Apple, de Google et de Meta; Bureau de la concurrence). Seul un **ami qui s'abonne** rapporte des points; le bouton
  « Inviter un ami » ne rapporte rien en soi. Testé (`points.test.ts`, `missions.test.ts`).
- Aucun **tirage ni hasard** (concours au Québec, art. 206 du Code criminel) : chaque récompense et chaque prix sont
  fixes et affichés d'avance.
- Textes en **français d'abord** (Charte de la langue française), anglais ensuite. Règlement affiché sur `/points`.

## Variables d'environnement (API)

| Variable | Défaut | Effet |
| --- | --- | --- |
| `POINTS` | `on` | `off` : coupe-circuit (rien gagné, rien échangé, expiration suspendue) |
| `POINTS_DAILY_EARN_CAP` | `5000` | points gagnés au plus par compte et par jour UTC |
| `POINTS_MONTHLY_EARN_CAP` | `20000` | par mois (jamais sous le plafond du jour) |
| `POINTS_EXPIRY` | `off` | `on` : expiration après inactivité |
| `POINTS_EXPIRY_MONTHS` | `12` | mois sans activité avant expiration (6 à 60) |
| `POINTS_INVOICE_CREDIT_MAX_CENTS_PER_MONTH` | `500` | crédits sur facture achetés avec des points, par compte et par mois |
| `POINTS_CATALOG_JSON` | (vide) | `[{"id":"texts_50","points":300,"monthlyLimit":2,"enabled":true,"quantity":50}]` : prix, quantité, limite, activation |

**L'API refuse de démarrer** si un prix du catalogue casse la règle économique (même modèle que les forfaits), avec la
récompense et les chiffres dans l'erreur.

## API (client)

- `GET /v1/points` : solde, cumul gagné, points dus (`owed`), 30 derniers mouvements, campagnes actives, règles (taux, plafonds, expiration).
- `GET /v1/points/catalog` : récompenses, prix, disponibilité pour ce compte (`balance`, `plan`, `monthly_limit`,
  `paused`) et utilisation du mois.
- `POST /v1/points/redeem` : voir plus haut. Types : `packages/shared/src/points.ts`.

## Tests

- `packages/shared/src/points.test.ts` : la règle économique du catalogue (échoue si un prix la casse), taux, cibles.
- `apps/api/test/points.test.ts` : gains par événement vérifié, idempotence, plafonds, campagnes (admin, budget,
  journal), échanges (rejeu, limite, budget du Gratuit, remboursement), coupe-circuit, configuration, expiration;
  reprise : remboursement partiel au prorata, rétrofacturation totale (extras de campagne compris), webhooks rejoués
  sans effet, solde insuffisant (points dus, échange refusé, retenue sur les gains suivants), App Store `REFUND` et
  Google Play annulé.
- `apps/api/test/points.repo.contract.test.ts` : même comportement en mémoire et sur Postgres (verrou, concurrence,
  solde jamais négatif, déclencheur d'ajout seulement, reprise et points dus), lancé par la tâche CI
  `repo-contract-tests`.
- `apps/webphone/src/pages/Points.test.tsx` : page Portefeuille en mode démo.
