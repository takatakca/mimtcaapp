# Missions MIMT (récompenses vérifiées par le serveur)

Demande du propriétaire (2026-10-27) : des incitatifs de croissance « à la Temu/Shein », avec un serveur « vraiment
sérieux ». **Depuis le 2026-10-28, les missions donnent des Points MIMT** (`docs/MIMT-POINTS.md`) : 10 points = 1 minute
d'équivalence, 1 500 points au plus par compte. Les missions déjà récompensées en minutes gardent leurs minutes.

Chaque récompense est **vérifiée par le serveur, donnée au plus une fois, journalisée et impossible à
farmer**. Code : `packages/shared/src/missions.ts` (table), `apps/api/src/services/missions.ts` (règles),
`supabase/migrations/0017_missions.sql` (registre), `apps/webphone/src/pages/Missions.tsx` (page `/missions`).

## Les missions

| id | Libellé | Déclencheur vu par le serveur | Récompense |
| --- | --- | --- | --- |
| `verify_phone` | Vérifiez votre cellulaire | Connexion par texto approuvée par Twilio Verify (`POST /v1/auth/otp/verify`) | 150 points |
| `choose_handle` | Choisissez votre @nom | Premier @nom enregistré (`PUT /v1/me/handle`) | 300 points |
| `enable_push` | Activez les notifications | Abonnement Web Push enregistré, vers un vrai service de notification (FCM, Mozilla, Apple, Windows) | 150 points |
| `install_app` | Installez l'app mobile | Appareil attesté par App Attest / Play Integrity (`POST /v1/devices/attest`) | 300 points |
| `first_number` | Obtenez votre numéro | Numéro acheté sur un forfait payant (`POST /v1/numbers/claim` ou webhook Stripe du sélecteur) | 600 points |
| `invite_friend` | Un ami s'abonne | Parrainage récompensé (première facture payée de l'ami, contrôles anti-fraude existants) | le mois Premium du parrainage, pour les deux (inchangé); le parrain gagne aussi 1 000 points |
| `go_yearly` | Passez à l'annuel | Forfait annuel actif (webhook Stripe, ou achat annuel vérifié App Store / Google Play) | le mois gratuit du prix annuel (aucune minute) |

Total : **1 500 points au plus par compte** (`MISSION_POINTS_CAP`; les anciennes minutes comptent à 10 points par minute).
Coûts : `docs/MIMT-UNIT-ECONOMICS.md`.

## Règles du serveur

- **Aucune route de réclamation.** Seul `GET /v1/missions` existe (lecture). Les récompenses sont données à l'intérieur
  des routes et webhooks qui voient l'événement. La réponse de la route peut contenir `missionGranted` pour la fête.
- **Une seule fois**, garanti par la base : `UNIQUE (compte, mission)`, `UNIQUE (mission, empreinte du titulaire)` et,
  pour l'app, `UNIQUE (mission, empreinte de l'appareil)`. Une deuxième tentative concurrente échoue sur l'index et
  ne crédite rien. Une ancienne récompense en minutes et ses minutes étaient écrites dans la même transaction.
- **Empreintes, pas de données personnelles** : HMAC avec une clé du serveur (`MessageCipher.subjectHash`) du
  cellulaire de connexion (sinon de l'identifiant TAKATAK) et de la clé d'appareil. Ni numéro, ni identifiant, ni clé
  n'est stocké ou journalisé; un numéro ne peut pas être retrouvé en essayant tous les numéros.
- **Supprimer son compte et recommencer ne redonne rien** : le registre est conservé à la suppression (comme le
  journal de fraude), et l'empreinte du cellulaire bloque le même titulaire sur un nouveau compte.
- **@nom** : un seul par compte, jamais modifiable; un deuxième enregistrement ne donne rien.
- **Points** : la récompense est écrite, puis ses points avec la clé `mission:<compte>:<mission>`; une panne entre les
  deux est réparée à la lecture suivante (`GET /v1/missions` ou `GET /v1/points`). Le client les échange dans
  `/points` (minutes, textos, semaine sans pub, crédit sur facture), avec le budget du Gratuit vérifié à l'échange.
- **Anciennes récompenses en minutes** (avant le 2026-10-28) : ajoutées au mois où elles ont été gagnées, sans report;
  une ancienne récompense « en attente » (budget du Gratuit atteint) reçoit ses minutes dès que le budget le permet.
- **Journal** : `mission.granted` et `mission.credited` dans `audit_log` (identifiant interne du compte, mission,
  minutes, compartiment, mois; aucune donnée personnelle).
- **Coupe-circuit** : `MISSIONS=off` (API) n'accorde plus rien; la page affiche que les missions sont en pause.
- Une erreur de mission ne fait jamais échouer la connexion, l'achat ou l'enregistrement qui l'a déclenchée.

## Lignes juridiques à ne pas franchir

- Aucune récompense pour un **avis ou une note** (règles d'Apple et de Google, Bureau de la concurrence : avis
  incités trompeurs).
- Aucune récompense pour un **« j'aime », un abonnement ou un partage** sur un réseau social (Meta interdit les
  mentions J'aime incitées).
- Aucun **tirage, hasard ou prix aléatoire** (règles des concours au Québec, art. 206 du Code criminel) : chaque
  récompense est fixe et connue d'avance.
- Le partage n'est récompensé que par la **conversion du parrainage existant** (un ami qui s'abonne).
- Règlement affiché sur la page : aucun achat requis pour les missions sans achat, aucun hasard, points sans valeur
  en argent (minutes et textos échangés ajoutés au mois en cours), une seule fois par compte.

## À faire par le propriétaire

- Annuel dans les applications : créer les produits annuels App Store / Play à 11 × le prix mensuel du magasin.
- Passage d'un abonnement mensuel **existant** à l'annuel : pas encore offert. Le paiement utilise des prix créés à
  la volée (`price_data`), que le portail client Stripe ne sait pas échanger. L'app ne propose l'annuel qu'à l'achat
  d'un forfait. À décider : produits et prix Stripe permanents, ou une route de changement d'intervalle.
