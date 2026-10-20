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

## Garde-fous côté serveur (à livrer avec le changement de prix)

- Tous les prix et quotas configurables par variables d'environnement, refusés au démarrage s'ils cassent la règle.
- Quota entrant et sortant appliqué avant de connecter l'appel; textos sortants refusés au-delà du quota.
- Les textos reçus au-delà du quota coûtent quand même (Twilio facture à la réception) : filtrage anti-pourriel et
  suivi par client dans `/v1/admin/costs`.
- Plafonds `FREE_*` conservés; 9-1-1 jamais bloqué.

## Ce qui peut casser la règle

- **Le dollar canadien** : à 1,60 CAD / USD, Premium passe au-dessus de 70 % (test automatique).
- **Hausse de prix Twilio** : mettre à jour les tarifs dans `unitEconomics.ts`; la CI dit tout de suite quel forfait
  ne passe plus.
- **Cartes étrangères** (Stripe +0,8 %) et litiges : non comptés; marge de 30 % pour les absorber.
