# MIMT : économie par client (marges au pire cas)

Règle du propriétaire (2026-10-20) : **le coût Twilio au pire cas d'un forfait ne dépasse jamais 70 % du prix,
une fois les frais Stripe retirés.** On ne perd jamais d'argent par client.

Source de vérité du calcul : `packages/shared/src/unitEconomics.ts` (testé dans `unitEconomics.test.ts` : un forfait
qui casse la règle fait échouer la CI). Ce document en est le résumé lisible.

## Hypothèses

| Élément | Valeur | Note |
| --- | --- | --- |
| Numéro local canadien | 1,15 USD / mois | Twilio |
| Inscription 9-1-1 du numéro | 0,75 USD / mois | Twilio Emergency Calling |
| Appel sortant vers le réseau | 0,014 USD / min | + volet app 0,004 |
| Appel entrant du réseau | 0,0085 USD / min | + volet app 0,004 |
| Volet app ou navigateur | 0,004 USD / min | sur **chaque** appel, même entre apps MIMT |
| Texto (envoyé ou reçu) | 0,0083 USD | les deux sens comptent dans le quota |
| MMS | 0,022 USD | plafonné à 50 par mois dans les forfaits qui l'incluent |
| Code de connexion par texto (Verify) | 0,05 USD | 2 par mois au pire cas; la connexion TAKATAK ne coûte rien |
| Transcription de messagerie vocale | 0,05 USD / min | plafonnée à 20 min |
| Enregistrement d'appel | 0,0025 USD / min | Affaires Pro seulement |
| Taux de change | 1,40 CAD / USD | prudent exprès |
| Stripe | 2,9 % + 0,30 $ | cartes canadiennes; taxes perçues en plus du prix |

« Pire cas » = chaque quota utilisé jusqu'à la dernière unité, sous sa forme la plus chère.

## Forfaits actuels (en ligne aujourd'hui) : ils perdent de l'argent au pire cas

| Forfait | Prix | Stripe | Net | Numéro | Min. sortie / entrée | Textos | Coût pire cas | Coût / net | Règle |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | --- |
| Gratuit | 0,00 | 0,00 | 0,00 | oui | 30 / 60 | 100 | 5,77 | — | pub |
| Verrouillage | 4,99 | 0,44 | 4,55 | oui | 30 / 60 | 100 | 5,77 | 127 % | ❌ |
| Premium | 19,99 | 0,88 | 19,11 | oui | 500 / 1000 | 1000 | 44,52 | 233 % | ❌ |
| Affaires (par ligne) | 34,99 | 1,31 | 33,68 | oui | 1000 / 2000 | 1000 | 74,62 | 222 % | ❌ |
| Affaires Pro (par ligne) | 44,99 | 1,60 | 43,39 | oui | 1000 / 2000 | 2000 | 86,24 | 199 % | ❌ |

Le numéro gratuit seul coûte 2,66 $ par mois (location + 9-1-1) avant le moindre appel. Le garde-fou du forfait
gratuit (`FREE_*`, PR #16) limite la perte totale, mais chaque client payant qui utilise tout son forfait coûte plus
qu'il ne rapporte.

## Gamme de lancement proposée (respecte la règle)

| Forfait | Prix | Stripe | Net | Numéro | Min. sortie / entrée | Textos | Coût pire cas | Coût / net | Règle |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | --- |
| Gratuit (avec pub) | 0,00 | 0,00 | 0,00 | non | 0 / 0 | 0 | 0,81 | — | pub |
| Essentiel | 12,99 | 0,68 | 12,31 | oui | 60 / 120 | 150 | 8,15 | 66 % | ✅ |
| Premium | 29,99 | 1,17 | 28,82 | oui | 200 / 300 | 400 (≤ 50 MMS) | 20,10 | 70 % | ✅ |
| Affaires (par ligne) | 34,99 | 1,31 | 33,68 | oui | 300 / 400 | 300 (≤ 50 MMS) | 23,21 | 69 % | ✅ |
| Affaires Pro (par ligne) | 44,99 | 1,60 | 43,39 | oui | 350 / 450 | 400 (≤ 50 MMS) | 29,13 | 67 % | ✅ |
| Essai 7 jours (carte au dossier) | 0,00 | — | — | oui | 20 / 20 | 20 | 3,89 | — | perte si non converti |

Ce qui change par rapport à la suggestion du propriétaire :

- **Premium** : 250 / 400 minutes donnait 80 % (❌). Ramené à **200 sortantes / 300 entrantes** pour 29,99 $. Autre
  option équivalente : garder 250 / 400 et monter le prix à 34,99 $.
- **Affaires** : 300 / 400 minutes et 300 textos par ligne à 34,99 $ (prix inchangé). Les anciens 1000 / 2000 coûtaient
  2,2 fois le prix.
- **Affaires Pro** : 350 / 450 minutes, 400 textos, 750 min d'enregistrement par ligne à 44,99 $.

### Gratuit

- Pas de numéro du réseau téléphonique. Textos entre apps MIMT illimités (base de données, aucun frais Twilio).
- Appels entre apps MIMT : 120 min par mois (usage raisonnable). Coût au pire cas 0,67 $ + 2 codes de connexion
  0,14 $ = **0,81 $ par utilisateur gratuit et par mois**, payé par la publicité. Pour le réduire : connexion TAKATAK
  seulement pour le gratuit (0 $ de Verify), ou faire passer ces appels par LiveKit (déjà en place pour les réunions)
  au lieu de Twilio.
- Le 9-1-1 n'est jamais bloqué, sur aucun forfait.

### Vrai numéro et essai

- Le numéro se paie d'avance (Stripe), puis il est attribué tout de suite.
- Essai de 7 jours : **désactivé par défaut**. S'il est activé, carte au dossier obligatoire et quota de 20 min / 20
  textos. Twilio facture le numéro au mois complet dès l'achat : un essai non converti coûte environ 3,89 $.

## Garde-fous côté serveur (livrés avec la gamme de lancement)

- `packages/shared/src/plans.ts` porte la gamme ci-dessus; un test fait échouer la CI si un forfait payant casse la
  règle. Le code interne `lock` désigne **Essentiel** (contraintes de base de données et SKU des magasins inchangés).
- Prix et quotas modifiables par variables d'environnement de l'API (`apps/api/src/plansConfig.ts`) :
  `PLAN_<CODE>_PRICE_CENTS`, `_OUT_MIN`, `_IN_MIN`, `_MESSAGES`, `_MMS` (`<CODE>` : `LOCK`, `PREMIUM`, `BUSINESS`,
  `BUSINESS_PRO`), `FREE_ON_NET_MINUTES`, tarifs `TWILIO_USD_*` et `USD_TO_CAD`. **L'API refuse de démarrer** si un
  forfait payant dépasse 70 %, avec le forfait et les chiffres dans l'erreur.
- Minutes sortantes et entrantes vérifiées avant de connecter l'appel; textos **envoyés et reçus** comptés ensemble;
  MMS plafonnés à part; appels entre applications : réserve de 120 min au Gratuit, minutes sortantes aux forfaits payants.
- Les textos reçus au-delà du quota coûtent quand même (Twilio facture à la réception) : ils sont comptés et livrés,
  jamais refusés; suivi par client dans `/v1/admin/costs`.
- Gratuit : aucune attribution de numéro (`402 number_requires_paid_plan`). `PLAN_FREE_NUMBER=true` réactive
  l'ancien gratuit avec numéro (numéros déjà donnés, promotion décidée par le propriétaire), plafonné par `FREE_*`.
- Essai de 7 jours : `TRIAL_ENABLED=true`, Essentiel mensuel seulement, carte exigée par Stripe, une fois par compte,
  quota de 20 min / 20 textos.
- Module « 250 minutes de plus » : 9,99 $ (7,99 $ donnait 84 %). Numéro supplémentaire 4,99 $ : 58 %.
- Plafonds `FREE_*` conservés; 9-1-1 jamais bloqué.

## Forfaits annuels : 12 mois pour le prix de 11 (décision du propriétaire, 2026-10-27)

Ordre du propriétaire : « un mois gratuit si t'achètes pour un an ». `yearlyPriceCents = 11 × monthlyPriceCents` pour
Essentiel, Premium, Affaires et Affaires Pro (`packages/shared/src/plans.ts`, `YEARLY_MONTHS_PAID`). Les quotas restent
**mensuels** (remis à zéro chaque mois). Le client paie une fois par an : **un seul** frais Stripe (2,9 % + 0,30 $) sur
le prix annuel, donc le net par mois n'est pas simplement 11/12 du net mensuel.

| Forfait | Prix annuel | Équivalent / mois | Stripe (1 fois) | Net / an | Net / mois | Coût pire cas / mois | Coût / net (annuel) | Coût / net (mensuel) | Marge / mois perdue |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Essentiel | 142,89 | 11,91 | 4,44 | 138,45 | 11,54 | 8,15 | **70,6 %** | 66,2 % | 0,77 $ |
| Premium | 329,89 | 27,49 | 9,87 | 320,02 | 26,67 | 20,10 | **75,4 %** | 69,7 % | 2,15 $ |
| Affaires (par ligne) | 384,89 | 32,07 | 11,46 | 373,43 | 31,12 | 23,21 | **74,6 %** | 68,9 % | 2,56 $ |
| Affaires Pro (par ligne) | 494,89 | 41,24 | 14,65 | 480,24 | 40,02 | 29,13 | **72,8 %** | 67,1 % | 3,37 $ |

Les quatre dépassent 70 % au pire cas : c'est le coût du mois gratuit, accepté par le propriétaire. La règle mensuelle
de 70 % **n'est pas assouplie**. L'annuel a son propre plafond explicite, `MAX_COST_SHARE_YEARLY = 0,80`
(`packages/shared/src/unitEconomics.ts`), jamais appliqué au-delà de `NEVER_A_LOSS = 100 %` (coût = net : perte) :

- 0,80 parce qu'un forfait qui respecte tout juste la règle mensuelle atteint au plus ≈ 76,4 % en annuel
  (0,70 × 12 / (11 × 0,971)); le plafond annuel ne bloque donc jamais un prix accepté au mois, et reste loin d'une perte;
- `apps/api/src/plansConfig.ts` : le prix annuel suit le prix mensuel modifié par `PLAN_<CODE>_PRICE_CENTS` (toujours
  11 ×), et l'API **refuse de démarrer** si un prix annuel dépasse 80 %, avec les chiffres;
- tests : `unitEconomics.test.ts` fixe les quatre pourcentages ci-dessus (un changement de tarif Twilio ou de prix les
  fait échouer, à revoir consciemment).

Magasins (App Store, Google Play) : le prix annuel est saisi dans App Store Connect / Play Console, pas par le code.
Le fixer à 11 × le prix mensuel du magasin. Avec la commission de 15 %, l'annuel Essentiel passerait à ≈ 80,5 % :
préférer l'annuel sur le Web (Stripe).

## Missions MIMT : coût des minutes en prime (2026-10-27)

Détails et règles : `docs/MIMT-MISSIONS.md`. Au plus **150 minutes une seule fois par compte** (et par cellulaire ou
appareil), ajoutées au mois en cours, sans report.

| Cas | Minutes | Coût pire cas (une fois) |
| --- | ---: | ---: |
| Forfait payant (minutes sortantes : réseau + volet app, 0,018 USD/min) | 150 | 3,78 $ |
| Gratuit (minutes entre applications : volet app, 0,004 USD/min) | 150 | 0,84 $ (dans le budget `FREE_TIER_MONTHLY_BUDGET_CAD`) |

Ce coût est ponctuel, pas mensuel. Au pire, le **premier mois** d'un Essentiel mensuel qui fait toutes les missions et
utilise tout coûte 8,15 + 3,78 = 11,93 $ pour 12,31 $ net (96,9 %, pas une perte). Pour un Essentiel annuel, ce premier
mois dépasse son douzième de net (103 %), mais l'année entière reste à (12 × 8,15 + 3,78) / 138,45 = 73,4 %. Les
missions « Un ami s'abonne » et « Passez à l'annuel » ne donnent aucune minute : leur récompense est le mois Premium du
parrainage (déjà compté plus bas) et le mois gratuit de l'annuel (tableau ci-dessus). Coupe-circuit : `MISSIONS=off`.

## Ce qui peut casser la règle

- **Achats dans les applications (App Store, Google Play)** : la commission de 15 à 30 % n'est pas comptée ci-dessus.
  À 15 %, Essentiel à 12,99 $ passe à environ 74 % : fixer le prix magasin d'Essentiel à au moins 13,99 $ et celui de
  Premium à au moins 32,99 $, ou vendre ces forfaits sur le Web (Stripe) seulement.
- **Récompense de parrainage** : un mois Premium crédité (29,99 $) n'apporte aucun revenu ce mois-là; garder le
  plafond de récompenses par compte.

- **Le dollar canadien** : à 1,60 CAD / USD, Premium passe au-dessus de 70 % (test automatique).
- **Hausse de prix Twilio** : mettre à jour les tarifs dans `unitEconomics.ts`; la CI dit tout de suite quel forfait
  ne passe plus.
- **Cartes étrangères** (Stripe +0,8 %) et litiges : non comptés; marge de 30 % pour les absorber.
