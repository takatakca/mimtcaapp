# MIMT : revente Internet et mobile (phase 3)

Rédigé le **2026-10-10** par l'agent MIMT. Document de référence pour le catalogue, les commandes, la SIM/eSIM, le transfert de numéro, les codes du CRTC et l'adaptateur Vidéotron.

> **Ce n'est pas un avis juridique.** Les règles des codes (durées, plafonds, frais) sont des constantes configurables dans `packages/shared/src/consumerCodes.ts`, chacune marquée « à valider par l'avocat ». Voir aussi [MIMT-REGULATORY.md](MIMT-REGULATORY.md) §12.

## État actuel

| Pièce | État |
| --- | --- |
| Contrat partagé (offres, commandes, machine à états) | Fait : `packages/shared/src/catalog.ts`, `catalogApi.ts` |
| Résumé des renseignements essentiels, frais de résiliation, plafonds de facture | Fait : `packages/shared/src/consumerCodes.ts` (à valider par l'avocat) |
| Base de données | Fait : `supabase/migrations/0005_catalog.sql` |
| Routes REST | Fait : `apps/api/src/routes/catalog.ts`, logique dans `apps/api/src/catalog/orders.ts` |
| Fournisseur « sandbox » (faux grossiste, pour dev et tests) | Fait : `apps/api/src/catalog/providers/sandbox.ts` |
| Adaptateur Vidéotron | **Squelette seulement** : `apps/api/src/catalog/providers/videotron.ts`. Les chemins, champs et statuts sont des **suppositions** marquées `TODO(videotron)`. Rien n'a été testé contre Vidéotron. |
| Facturation (abonnement Stripe à l'activation, frais de résiliation) | À faire : `TODO(billing)` dans `orders.ts` |
| Vérification de crédit automatique | À faire : aujourd'hui un administrateur approuve ou refuse |
| Synchronisation périodique (tâche planifiée) | À faire : aujourd'hui par webhook, par `POST .../sync` ou par l'admin |

## Le parcours d'une commande

```
draft ──submit──▶ submitted ──credit_approved (sans engagement)──▶ pending_provider ──▶ scheduled ──▶ active ⇄ suspended
                     │                                                  │                  │            │
                     └─credit_check_started (contrat à terme)─▶ credit_check ─credit_approved┘            │
                                                                                                          ▼
 draft / submitted / credit_check ──annulation──▶ cancelled        pending_provider…suspended ──▶ cancel_requested ──▶ cancelled
 n'importe quel état actif ──refus / échec──▶ failed
```

1. **Catalogue** : `GET /v1/catalog/offers?postalCode=H2X1Y4` (public). Les offres actives vendues dans cette zone (préfixes de code postal), de la moins chère à la plus chère. `GET /v1/catalog/availability?postalCode=` interroge le grossiste.
2. **Brouillon** : `POST /v1/catalog/orders` `{ offerId, serviceAddress?, simKind? }`. Le prix, la durée et le rabais sont **figés** sur la commande. Internet exige l'adresse de service ; le mobile exige `simKind` (`sim` ou `esim`).
3. **Résumé du contrat** : `GET /v1/catalog/orders/:id/contract-summary`. Le client lit le résumé (français d'abord, anglais ensuite) ; sa `version` dépend du texte exact et des conditions figées.
4. **Soumission** : `POST /v1/catalog/orders/:id/submit` avec
   `{ contractSummaryVersion, acceptContractSummary: true, acceptConsumerCode: true, creditCheckConsent? }`.
   - Sans acceptation : `400 contract_summary_required`. Version différente : `409 contract_summary_outdated`.
   - Mobile : acceptation du Code sur les services sans fil ; Internet : du Code sur les services Internet (`400 consumer_code_required` sinon).
   - Contrat à terme (`termMonths > 0`) : consentement à la vérification de crédit (`400 credit_check_consent_required` sinon).
   - Les consentements sont enregistrés dans `consents` (`contract_summary`, `wireless_code` / `internet_code`, `credit_check`) avec la version du résumé, l'IP et l'heure.
   - Sans engagement : la commande part tout de suite chez le grossiste (`pending_provider`). Avec engagement : elle attend en `credit_check` qu'un administrateur l'approuve.
5. **Chez le grossiste** :
   - Internet : `GET .../appointment-slots`, puis `POST .../appointment` `{ startsAt, endsAt }` → `scheduled`. Après l'installation, le grossiste signale la fin → `active`.
   - Mobile : `POST .../sim` `{ iccid }` (carte physique) ou `POST .../esim` `{ eid? }` (renvoie le code d'activation LPA à afficher en code QR ; `GET .../esim` le réaffiche au titulaire). Le code eSIM est **chiffré** (AES-256-GCM) en base et n'apparaît jamais dans le détail de la commande.
   - Transfert de numéro : `POST .../porting` `{ phoneNumber, losingCarrier, authorizedName, accountNumber, pin | imei }` dès que la commande est soumise. Le numéro de compte, le NIP et l'IMEI sont chiffrés et transmis seulement au grossiste ; ils ne sont jamais renvoyés ni journalisés.
6. **Activation** : à l'état `active`, un `service_instance` est créé (numéro de téléphone, fin d'engagement). Les appareils passent à `active`, le rendez-vous à `completed`, le transfert à `completed`.
7. **Annulation** : `GET .../cancellation-quote` affiche les frais ; `POST .../cancel` annule. Avant que le grossiste ait la commande : annulée tout de suite. Après : `cancel_requested` (l'avis prend effet le jour de sa réception), puis `cancelled` quand le grossiste confirme. Les frais suivent les codes : période d'essai (15 jours sans fil, 30 jours Internet à terme) sans frais ; ensuite le solde du rabais, réduit chaque mois ; sans rabais, le moindre de 50 $ ou 10 % des frais mensuels restants.
8. **Suivi** : `GET /v1/catalog/orders`, `GET /v1/catalog/orders/:id` (commande, historique, offre, service, rendez-vous, appareils, transfert). `POST .../sync` va chercher l'état chez le grossiste.

Chaque transition passe par la machine à états pure (`nextOrderState`), est une écriture conditionnelle sur l'état (pas de course entre une route et un webhook) et ajoute une ligne à `order_events` (qui, quand, de quel état à quel état).

## Administration

Seuls les identifiants MIMT listés dans `CATALOG_ADMIN_USER_IDS` (séparés par des virgules) ont accès ; sinon `403 admin_only`. Liste vide = personne.

| Route | Rôle |
| --- | --- |
| `GET /v1/admin/catalog/offers` | Toutes les offres (brouillon, active, retirée) |
| `POST /v1/admin/catalog/offers` | Créer une offre (brouillon par défaut ; engagement ≤ 24 mois) |
| `PATCH /v1/admin/catalog/offers/:id` | Modifier prix, zones, statut… (le code ne change pas ; les commandes déjà créées gardent leur prix figé) |
| `GET /v1/admin/catalog/orders?state=credit_check` | File de travail |
| `POST /v1/admin/catalog/orders/:id/events` | `credit_approved`, `credit_declined`, `suspended`, `restored`, `cancel_requested`, `cancel_confirmed`, `fail` |
| `POST /v1/admin/catalog/orders/:id/sync` | Relancer l'envoi ou la synchronisation avec le grossiste |

## Webhooks du grossiste

`POST /webhooks/provisioning/:provider` (`videotron` ou `sandbox`, seulement le fournisseur actif). Le corps brut est vérifié par l'adaptateur **avant** toute lecture :

- Vidéotron (squelette) : HMAC-SHA256 du corps avec `VIDEOTRON_WEBHOOK_SECRET`, en hexadécimal, dans l'en-tête `x-videotron-signature`. **Le vrai schéma de signature et le nom de l'en-tête sont à confirmer avec Vidéotron.** Sans secret configuré : `503`.
- Sandbox : en-tête `x-sandbox-signature`, secret de test fixe.
- Signature invalide : `401 invalid_signature`. Références inconnues : ignorées (`200 { received, applied }`). Rejouer un même événement ne change rien.

## Configuration

| Variable | Rôle |
| --- | --- |
| `PROVISIONING_PROVIDER` | `sandbox` ou `videotron`. Non définie : `sandbox` hors production, **aucun** en production (les commandes répondent `503 not_configured`, rien de faux n'est créé). |
| `VIDEOTRON_API_BASE_URL`, `VIDEOTRON_CLIENT_ID`, `VIDEOTRON_CLIENT_SECRET`, `VIDEOTRON_RESELLER_ID`, `VIDEOTRON_TOKEN_URL` | Accès à l'API Vidéotron (OAuth 2 « client credentials » supposé). Manquants : les appels répondent `503`, les commandes restent en `pending_provider` et seront renvoyées. |
| `VIDEOTRON_WEBHOOK_SECRET` | Secret partagé des webhooks Vidéotron. |
| `CATALOG_ADMIN_USER_IDS` | Administrateurs du catalogue. |
| `MESSAGE_ENCRYPTION_KEY` | Clé AES-256-GCM (déjà utilisée pour les messages) : chiffre aussi les codes eSIM et les NIP de transfert. Obligatoire en production. |

Aucun secret dans le code, les journaux ou les URL.

## Ce qu'il faut demander à Vidéotron

L'entente commerciale est signée, mais **l'interface technique n'est pas connue**. Pour remplacer le squelette par un vrai adaptateur, le propriétaire doit obtenir et nous transmettre (par un canal sûr, jamais dans le dépôt ni dans le clavardage) :

1. **La documentation de l'interface revendeur** : API REST (spécification OpenAPI idéalement), portail web seulement, ou échanges de fichiers (SFTP). Si c'est un portail ou des fichiers, l'adaptateur deviendra une file de travail (commandes exportées, statuts importés par une tâche), sans changer le reste.
2. **Un environnement de test (bac à sable)** et ses identifiants, séparés de la production.
3. **Les identifiants de production** : URL de base, identifiant client et secret OAuth (ou autre méthode d'authentification), identifiant de revendeur. À mettre dans les secrets Coolify, pas ailleurs.
4. **Les webhooks** : la liste des événements (statut de commande, rendez-vous, transfert, suspension, consommation), le schéma de signature, le nom de l'en-tête, la politique de reprise, et le secret partagé.
5. **Le catalogue grossiste** : codes de produits et de forfaits, familles de produits, prix de gros, zones desservies (pour remplir `providerProductCode` et `availableFsas`).
6. **La vérification d'adresse** (qualification / « serviceability ») : entrée attendue et réponse.
7. **Les rendez-vous d'installation** : comment obtenir les plages et réserver.
8. **SIM et eSIM** : activation par ICCID, fournisseur SM-DP+ pour l'eSIM, logistique des cartes physiques (qui les expédie).
9. **Le transfert de numéro mobile** : qui le soumet, champs exigés (numéro de compte, NIP, IMEI), délais, codes de refus.
10. **Les données de consommation** (API ou fichiers quotidiens) pour les avis à 50/75/100 % et les plafonds de facture du Code sans fil.
11. **Suspension, rétablissement, annulation** de service, et les délais de confirmation.
12. **Le 9-1-1 mobile** : confirmation que Vidéotron l'assure sur son réseau pour nos abonnés.
13. Volumes minimaux, dépôt, limites d'appels à l'API et contact technique.

## Conformité

- **Code sur les services sans fil** (CRTC 2013-271, révisé 2017-200) et **Code sur les services Internet** (CRTC 2019-269), plus la **Loi sur la protection du consommateur** du Québec (art. 214.1 et suivants). Constantes dans `CONSUMER_CODE_RULES` : durée maximale 24 mois, période d'essai, plafonds de 50 $ (données) et 100 $ (itinérance) par mois sans consentement, avis à 50/75/100 %, copie permanente du contrat dans les 15 jours, taxe municipale 9-1-1 du Québec. **Toutes à valider par l'avocat avant le lancement.**
- **CPRST** : le résumé indique la marche à suivre pour une plainte non réglée.
- **Loi 25** : données de transfert et codes eSIM chiffrés ; tables sensibles (`devices`, `porting_requests`, `order_events`) sans accès direct pour les utilisateurs Supabase (RLS).
- **Enregistrement au CRTC comme revendeur** avant de vendre (voir MIMT-REGULATORY.md §1).

## Tests

- `apps/api/test/catalog.test.ts` : parcours complets avec le fournisseur sandbox et le dépôt en mémoire (mobile eSIM, transfert + SIM physique, Internet à terme avec approbation de crédit et rendez-vous, annulations et frais, refus de transfert, contrôle d'accès admin, signatures de webhook sandbox et Vidéotron, `503` sans fournisseur).
- `apps/api/test/catalog.repo.contract.test.ts` : même comportement du dépôt en mémoire et de Postgres. La partie Postgres roule avec `TEST_DATABASE_URL` pointant vers une base de travail où toutes les migrations sont appliquées.
