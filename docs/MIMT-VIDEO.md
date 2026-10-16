# Réunions MIMT (vidéoconférence)

*English summary at the end.*

Réunions vidéo pour les bureaux, comme les réunions de Rogers Unison ou de TELUS Business Connect : vidéo, partage d'écran, clavardage, salle d'attente et invités par lien, sans installation. Construit sur **LiveKit**, un serveur vidéo (SFU) libre que MIMT héberge sur son Coolify; LiveKit Cloud fonctionne aussi.

État : code prêt (API, app Web, liste mobile), **pas encore en service**. Il faut un serveur LiveKit, trois variables d'environnement et la migration `0010_meetings.sql` (voir « Mise en service »).

## 1. Fonctionnement

| Élément | Où | Rôle |
|---|---|---|
| Serveur vidéo LiveKit | `rtc.mimt.ca` (Coolify) ou LiveKit Cloud | Relaie l'audio, la vidéo, le partage d'écran et le clavardage. N'enregistre rien. |
| API MIMT | `apps/api/src/routes/meetings.ts`, `apps/api/src/video/gateway.ts` | Crée les réunions, vérifie le forfait et les droits, signe les jetons d'accès LiveKit (1 h), gère les invités et la salle d'attente, reçoit les webhooks. |
| Base PostgreSQL MIMT | `supabase/migrations/0010_meetings.sql` | `meetings`, `meeting_invites` (empreinte SHA-256 du lien seulement), `meeting_events` (journal en ajout seul). |
| App Web | `app.mimt.ca/reunions`, `app.mimt.ca/reunion/<jeton>` | Liste, planification, liens d'invités, salle (grille vidéo, micro, caméra, partage d'écran, appareils, participants, clavardage, main levée, quitter/terminer). |
| App mobile | Compte › Réunions vidéo | Liste des réunions et « Rejoindre dans le navigateur » (la vidéo native viendra plus tard). |

Déroulement :

1. Un hôte crée une réunion (`POST /v1/meetings`) : personnelle (forfait Premium) ou d'entreprise (propriétaire ou administrateur d'une entreprise MIMT Affaires). Le nom de salle LiveKit est aléatoire (`mimt-` + 32 caractères hexadécimaux).
2. Il obtient des liens d'invités (`POST /v1/meetings/:id/invites`) : un lien par courriel (envoyé si un fournisseur de courriel est configuré) ou un lien à copier. Lien : `https://app.mimt.ca/reunion/<jeton>`, valide 7 jours, pour cette réunion seulement. Seule l'empreinte SHA-256 du jeton est conservée.
3. Pour entrer, chaque personne demande un jeton LiveKit à l'API : membres (`POST /v1/meetings/:id/token`, identité = id utilisateur MIMT) ou invités (`POST /v1/meetings/join/guest`, limité à 10 essais par minute et par adresse IP). L'API vérifie le forfait, l'état de la réunion, la durée maximale (4 h) et le nombre de participants (`listParticipants`) avant de signer.
4. Salle d'attente (activée par défaut) : l'invité se connecte sans pouvoir publier, voir ni écrire (`canPublish`, `canSubscribe`, `canPublishData` à faux, métadonnées `waiting: true`). L'hôte clique sur « Admettre » (`POST /v1/meetings/:id/admit`) et l'API lui donne les permissions par l'API serveur LiveKit.
5. L'hôte termine la réunion pour tous (`POST /v1/meetings/:id/end` : la salle LiveKit est supprimée). LiveKit envoie aussi des webhooks signés à `https://api.mimt.ca/webhooks/livekit` (début, arrivées, départs, fin) que l'API vérifie avec la clé secrète.

Forfaits et limites (`packages/shared/src/meetings.ts`) :

| Forfait | Réunions | Participants max. |
|---|---|---|
| Gratuit, Verrouillage | non | — |
| Premium | oui (personnelles) | 4 |
| Affaires | oui | 25 |
| Affaires Pro | oui | 100 |

Durée maximale : 4 heures par réunion. Tous les membres d'une entreprise peuvent rejoindre ses réunions; seuls l'hôte, le propriétaire et les administrateurs les gèrent.

Sans `LIVEKIT_URL`, `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET`, toutes les routes de réunion répondent `503 not_configured`; le reste de MIMT fonctionne normalement. La clé secrète n'est jamais renvoyée ni écrite dans les journaux.

## 2. Héberger LiveKit sur Coolify (recommandé)

Avantages : coût fixe, données au Canada si le serveur Coolify y est, aucune dépendance à un fournisseur américain pour le contenu des réunions.

1. **Clés** : sur un poste de confiance, `docker run --rm livekit/livekit-server generate-keys` donne une clé (`API…`) et un secret. Les garder dans le gestionnaire de mots de passe; ne jamais les coller dans un courriel, un billet ou le code.
2. **DNS** : enregistrement `A` `rtc.mimt.ca` → adresse IP publique du serveur Coolify.
3. **Nouvelle ressource Coolify** : image `livekit/livekit-server` (épingler une version précise, par exemple la dernière version stable au moment de l'installation), commande `--config /etc/livekit.yaml`.
   - Réseau : **mode hôte recommandé** (`network_mode: host`) à cause de la plage UDP; sinon publier les ports ci-dessous.
   - Ports : `7880/tcp` (signalisation HTTP/WebSocket, derrière le proxy Coolify avec TLS sur `rtc.mimt.ca`), `7881/tcp` (média par TCP, repli quand l'UDP est bloqué), `50000-60000/udp` (média).
   - Pare-feu de l'hôte : ouvrir `7881/tcp` et `50000-60000/udp` en entrée. `443` reste au proxy Coolify.
   - Domaine Coolify : `https://rtc.mimt.ca` → port 7880 (certificat Let's Encrypt automatique). Les WebSocket doivent passer.
4. **Configuration** (`/etc/livekit.yaml`, montée comme fichier Coolify; le secret vient d'une variable Coolify `LIVEKIT_KEYS="<clé>: <secret>"`, pas du fichier) :

   ```yaml
   port: 7880
   log_level: info
   rtc:
     tcp_port: 7881
     port_range_start: 50000
     port_range_end: 60000
     use_external_ip: true
   room:
     empty_timeout: 300
     max_participants: 100
   webhook:
     api_key: <clé, la même que dans LIVEKIT_KEYS>
     urls:
       - https://api.mimt.ca/webhooks/livekit
   # Réseaux d'entreprise stricts (UDP bloqué) : TURN intégré sur TLS.
   # turn:
   #   enabled: true
   #   domain: rtc.mimt.ca
   #   tls_port: 5349
   #   udp_port: 3478
   ```

   Si l'UDP est bloqué chez certains clients, le média passe par `7881/tcp`; pour les réseaux qui ne laissent sortir que le 443, activer le TURN/TLS (ports `5349/tcp`, `3478/udp`, certificat de `rtc.mimt.ca`) et ouvrir ces ports.
5. **Vérifier** : `https://rtc.mimt.ca` répond `OK`; l'outil `https://livekit.io/connection-test` (ou `lk` CLI) réussit avec un jeton de test; puis une vraie réunion à 3 personnes, dont une sur un cellulaire en réseau mobile.
6. **Capacité** : prévoir environ 1 vCPU par 15 à 25 participants vidéo actifs et la bande passante en conséquence [À VÉRIFIER selon la charge réelle]. Surveiller CPU, réseau et `/metrics` (Prometheus, port 6789 si activé).

## 3. Ou LiveKit Cloud

Aucune infrastructure : créer un projet sur `cloud.livekit.io`, prendre l'URL `wss://<projet>.livekit.cloud`, une clé et un secret, et ajouter le webhook `https://api.mimt.ca/webhooks/livekit` dans les réglages du projet.

- Prix : forfait gratuit limité, puis forfaits mensuels avec minutes de participants et bande passante incluses, et dépassements à la minute [À VÉRIFIER sur livekit.io/pricing avant de choisir].
- Loi 25 : LiveKit Cloud est un fournisseur hors Québec (infrastructure mondiale, choix de région à vérifier [À VÉRIFIER]). Il faut une évaluation des facteurs relatifs à la vie privée (EFVP) avant de communiquer des renseignements personnels hors Québec, et une mention dans la politique de confidentialité.

## 4. Variables d'environnement (API, Coolify)

| Variable | Exemple | Notes |
|---|---|---|
| `LIVEKIT_URL` | `wss://rtc.mimt.ca` | Doit être `wss://` en production. Le client s'y connecte; l'API utilise `https://` sur le même hôte pour l'API serveur. |
| `LIVEKIT_API_KEY` | `API…` | Clé publique (identifiant). |
| `LIVEKIT_API_SECRET` | (secret) | Signe les jetons et vérifie les webhooks. Secret Coolify uniquement. |
| `APP_BASE_URL` | `https://app.mimt.ca` (défaut) | Base des liens d'invités et des liens « Rejoindre ». |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | — | Facultatif : envoie les invitations par courriel. Sans fournisseur, l'hôte copie les liens. |

## 5. Loi 25 et confidentialité

- **Aucun enregistrement** : ni audio, ni vidéo, ni clavardage. Le clavardage passe par le canal de données de LiveKit et disparaît à la fin. Ajouter l'enregistrement plus tard exigera un consentement explicite de chaque participant, un avis visible pendant l'enregistrement, une durée de conservation et une mise à jour de la politique de confidentialité.
- Données conservées par MIMT : titre, dates et état de la réunion; courriels des invités (s'ils sont fournis) et empreinte du lien; journal des arrivées, départs et admissions (identité LiveKit et heure). Durée de conservation à fixer par le responsable de la protection des renseignements personnels [À confirmer par MIMT], puis purge planifiée.
- Le nom affiché par un invité sert seulement à l'identifier auprès des participants.
- Les liens d'invités donnent accès à une seule réunion pendant 7 jours. Ils apparaissent dans le chemin de l'URL : les journaux d'accès du serveur statique de `app.mimt.ca` peuvent les contenir; les y masquer ou réduire leur conservation. La salle d'attente (par défaut) garde le contrôle à l'hôte.
- Hébergement : LiveKit sur le Coolify de MIMT garde le média chez MIMT; LiveKit Cloud demande l'EFVP ci-dessus.

## 6. Mise en service (propriétaire)

1. Appliquer la migration `0010_meetings.sql` avec le migrateur unique (`migrateStandalone`, ordre 0001 → 0010).
2. Déployer LiveKit (section 2) ou créer le projet LiveKit Cloud (section 3).
3. Mettre `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` dans l'app API Coolify et redéployer.
4. Configurer le webhook LiveKit vers `https://api.mimt.ca/webhooks/livekit`.
5. Tester : réunion Premium à 2, réunion Affaires avec un invité en salle d'attente, partage d'écran, cellulaire en LTE, réseau d'entreprise avec UDP bloqué.
6. Mettre à jour la politique de confidentialité (section 5) et le site (`mimt.ca`) avant d'annoncer la fonction.

## English summary

MIMT Meetings is video conferencing on LiveKit (self-hosted on Coolify at `rtc.mimt.ca`, or LiveKit Cloud). The API (`/v1/meetings`, `/webhooks/livekit`) checks plan (Premium 4 participants, Business 25, Business Pro 100, 4-hour limit), roles and capacity, signs 1-hour LiveKit tokens, issues 7-day single-meeting guest links (only a SHA-256 hash is stored), runs a waiting room (guests cannot publish or subscribe until admitted) and verifies signed webhooks. Without `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` every meeting route answers 503. Nothing is recorded; recording would need explicit consent first. Owner steps: apply migration 0010, deploy LiveKit (ports 7880/tcp behind TLS, 7881/tcp, 50000-60000/udp, optional TURN/TLS), set the three variables, point the LiveKit webhook to `https://api.mimt.ca/webhooks/livekit`, test with real devices.
