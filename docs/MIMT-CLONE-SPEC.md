# MIMT : spécification des fonctions (inspirée des démos publiques d'un grand fournisseur de téléphonie d'affaires)

Version déposée le 2026-10-31 par Claude (agent MIMT nº 2, session 01GtWamF), d'après la spécification du Drive :
MIMT › « 2026-10-31 — MIMT — Spécification « clone » des démos RingCentral (backend + BesoinAvocat) », rédigée par Claude Cowork
(session 013t9Lv2) après l'analyse de 29 des 30 vidéos de démonstration publiques.

**Règles.**
- Ce document est interne.
- Les fonctions sont décrites dans nos propres mots. Aucune marque, aucun texte ni aucun élément visuel du fournisseur
  analysé ne doit apparaître sur mimt.ca ni dans l'app (un test du site bloque les noms de concurrents).
- Pendant le gel du VPS (FICHE MAÎTRE, 2026-10-31) : aucune fusion ni aucun déploiement, un seul chantier de code à la fois.

Légende des sources :
- **[VU]** : montré ou narré dans une vidéo.
- **[DESC]** : tiré de la description de la vidéo seulement.
- **[INFÉRÉ]** : notre déduction.

Légende des priorités :
- **P1** : lancement BesoinAvocat.
- **P2** : peu après.
- **P3** : plus tard.

« Existant » indique ce que MIMT a déjà dans le code (main ou branche).

## 1. Appels et PBX

| # | Fonction | Source | Prio | Existant dans MIMT | Reste à faire |
|---|---|---|---|---|---|
| A1 | Règles de réponse, heures d'ouverture, fériés (par numéro, département, utilisateur, afficheur) | VU | P1 | Heures et fériés du standard d'entreprise (pbx/router.ts) | Règles selon l'afficheur ; règles par utilisateur |
| A2 | Sonnerie simultanée ou séquentielle, annonce chuchotée « appuyez sur 1 » | VU | P1 | Oui : groupes de sonnerie et chuchotement cellulaire | — |
| A3 | Bouton « Équipe » : ne sonne que les avocats disponibles **et** consentants, sinon boîte vocale | INFÉRÉ | P1 | Oui : lot B (#100) et consentement (#102, non fusionnée) | Journal des tentatives (team_dispatch_attempts) |
| A4 | Réceptionniste automatique (menu vocal fr-CA / en-CA) | VU | P2 | Oui : menu vocal du standard | — |
| A5 | Départements traités comme des files d'attente | VU | P2 | Partiel (groupes) | Files d'attente, temps d'attente |
| A6 | Présence (disponible, occupé, en appel, sonne) | VU | P1 | Disponibilité du lot B | Présence dérivée des statuts d'appel ; flux temps réel |
| A7 | Filtrage d'appel (nom annoncé, accepter, refuser, messagerie, message tapé lu en synthèse vocale) | VU | P2 | Non | Tout |
| A8 | Blocage (masqués, numéros, indicatifs) | VU | P2 | Blocage par numéro (routes/blocks.ts) | Masqués, indicatifs |
| A9 | Bascule d'un appel vers un autre appareil | VU | P3 | Non | Conférence Twilio |
| A10 | Boîte vocale + transcription + avis | VU / INFÉRÉ | P1 | Oui | Copie chiffrée au Canada et suppression chez Twilio (décision de Matt) |
| A11 | Journal d'appels + export CSV + envoi planifié | VU | P1 | Journal oui ; export CSV des appels d'entreprise oui | Envoi planifié ; filtre partner_origin |
| A12 | Enregistrement des appels | VU | P3 pour avocats | Oui, désactivé par défaut, avis obligatoire | Rétention courte pour les avocats |
| A13 | Administration : utilisateurs, postes, numéros, appareils | VU | P1 | Oui | — |
| A14 | Portabilité des numéros (états jusqu'à « terminé ») | VU | P1 | Oui (porting/) + statut partenaire (#100) | Couverture canadienne à confirmer |
| A15 | Multi-emplacements, groupes, contacts | VU | P3 | Non | Tout |
| A16 | Intégration Microsoft Teams | VU | P3 | Non | Programme développeur Microsoft |

## 2. Réceptionniste IA

| # | Fonction | Source | Prio | Existant | Reste |
|---|---|---|---|---|---|
| B1 | Réceptionniste IA (voix, langues, heures, accueil, transfert par nom, SMS d'information, test par clavardage) | VU | P2 (P1 possible hors heures, prise de message) | Oui : réceptionniste IA d'entreprise | Test par clavardage ; **jamais d'avis juridique** : triage et message seulement |
| B2 | Base de connaissances (site Web, fichiers) | VU | P2 | Connaissances d'aide | Ingestion de site et de fichiers ; pgvector à confirmer |
| B3 | Prise de rendez-vous (lien SMS ou en direct ; Google/Outlook ; types, durée, questions, lien visio) | VU | P2 | Connecteur Google Agenda (#88, désactivé) | Types de rendez-vous ; vérification de conflit d'intérêts |
| B4 | Statistiques et questions non résolues | VU | P2 | Non | ai_sessions |
| B5 | Concepteur d'agents avancé | VU | P3 | Pilote MIMT (partiel) | — |
| B6 | Notes IA, sentiment, recherche | VU | P3 (sensible) | Résumés d'appels | — |
| B7 | Interrupteur global IA de l'administrateur (héritage organisation → utilisateur) | VU | P1 | Consentement IA par utilisateur | Interrupteur au niveau de l'organisation |

## 3. Messagerie et télécopie

| # | Fonction | Source | Prio | Existant | Reste |
|---|---|---|---|---|---|
| C1 | SMS d'affaires sur le même numéro, groupes, rappels ; STOP/ARRÊT, LCAP | VU | P2 | SMS bidirectionnels | Groupes, rappels, gestion ARRÊT en français |
| C2 | Avis SMS ou courriel de message vocal et d'appel manqué | — | P1 | Push et courriel | Avis SMS |
| C3 | Télécopie en ligne | VU | P3 | Non | Twilio n'offre plus la télécopie : autre fournisseur à valider |

## 4. Vidéo, webinaires, événements

| # | Fonction | Prio | Existant |
|---|---|---|---|
| D1 | Visio, avec lien automatique pour un rendez-vous virtuel | P3 (BesoinAvocat : consultations) | Réunions LiveKit (non en service) ; consultations partenaires en cours (branche claude/connect-video) |
| D2 | Webinaires, événements, poste-à-poste | Hors cible | — |

## 5. Administration et rapports

| # | Fonction | Prio | Existant | Reste |
|---|---|---|---|---|
| E1 | Rapports (département, équipe, utilisateur, attente moyenne, tendances, suivi de campagnes par numéro) ; « appels référés par avocat » pour BesoinAvocat | P2 | Tableau d'expérience admin (#91) | Rapports par équipe et par partenaire |
| E2 | Console d'administration centrale | P1 | Affaires + Administration MIMT | — |
| E3 | Statut du forfait (miroir Stripe, usage) | P1 | Oui (#100) | — |

## 6. Centre de contact (P3)

- **F1** Routage par compétences : pour nous, par domaine de droit et par langue (TaskRouter).
- **F2** Superviseur.
- **F3** Alertes sur seuils, par exemple « appel BesoinAvocat manqué par toute l'équipe ».
- **F4** Score de qualité IA.

## 7. API partenaire BesoinAvocat : consentement bilatéral et granulaire

Principe (Matt, 2026-10-31) : chaque permission est accordée par l'avocat ou le cabinet, acceptée par BesoinAvocat,
décochée par défaut, révocable des deux côtés et journalisée. L'écran de consentement est en français clair, versionné,
et son historique est visible. Implémenté dans la PR #102 (non fusionnée pendant le gel).

### Correspondance entre les portées de la spécification et celles de la PR #102

| Portée de la spécification | Portée dans le code (#102) | État |
|---|---|---|
| ligne.liaison | `line.manage` | Fait |
| appels.recevoir_references | lien actif (sonnerie des apps) + `calls.read` | Fait |
| presence.lecture | `availability.manage` (lecture + réglage) | Fait (lecture seule séparée : à ajouter si requis) |
| journal.appels_references | `calls.read` | Fait |
| forfait.statut (sans montant ni carte) | `subscription.read` | Fait |
| portabilite.statut | `porting.read` | Fait |
| enregistrements.acces (exclu au lancement) | `recordings.read` | Fait ; à laisser non demandé au lancement |
| appels.sortants (au nom de l'avocat) | `calls.place` | Fait |
| messagerie.depot_references | — | À faire |
| messagerie.avis_metadonnees (sans contenu) | — | À faire |
| messagerie.contenu (fortement déconseillé) | — | Non prévu sans décision de Matt |
| rapports.agreges | — | À faire |
| sms.envoi_au_nom | — | À faire |
| rendezvous.reservation | — | À faire |
| ia.triage_references | — | À faire |
| video (consultations) | `video.host`, `video.join` | En cours (branche claude/connect-video) |

### Règles

- Il y a des prérequis entre portées.
- Le filtre `partner_origin` s'applique partout : le partenaire ne voit jamais un appel qui ne vient pas de lui.
- Les webhooks sont signés en HMAC, idempotents et rejoués.
- Les avis de consentement sont `member.consent_updated` (fait), et `consent.granted` / `consent.revoked` selon la spécification.

## 8. Ordre de construction (un chantier à la fois, après le gel)

1. Consentements (socle) : **fait**, PR #102.
2. Journal d'appels (partner_origin).
3. Horaires, fériés, règles et boîte vocale.
4. Groupe de sonnerie et annonce.
5. Présence.
6. Bouton Équipe et webhooks.
7. Statut du forfait : **fait** (#100).
8. Portabilité : **fait** (#100).
9. Avis SMS et transcription.
10. Rapports.
11. Blocage et filtrage.
12. Menu vocal et départements.
13. SMS bidirectionnel.
14. Réceptionniste IA (message seulement) et interrupteur IA.
15. Rendez-vous.
16. Plus tard : télécopie, base de connaissances, TaskRouter, visio (consultations en cours).

À ces étapes s'ajoutent les pages de vente de mimt.ca, une par fonction, puis l'alignement du tableau de bord de l'app
sur ces fonctions.

## 9. Questions ouvertes pour Matt

1. La portabilité canadienne passe-t-elle par Twilio ?
2. Données au Canada et suppression chez Twilio ?
3. Interdire l'enregistrement au lancement ?
4. BesoinAvocat a-t-il besoin du contenu des messages vocaux ?
5. Règle de l'équipe : simultané, tour de rôle, ou par domaine et langue ?
6. Délai avant la boîte vocale, et accueil ?
7. Qui paie l'usage des appels référés ?
8. Quel détail du forfait exposer ?
9. Réceptionniste IA dès la phase 1 ? Quel fournisseur ?
10. La télécopie est-elle requise ? Quel fournisseur ?
11. Consentement par avocat, par cabinet, ou les deux ?
12. pgvector en production ?
