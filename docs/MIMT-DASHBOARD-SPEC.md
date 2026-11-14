# MIMT : tableau de bord « Sans-fil + Téléphonie d'affaires » d'app.mimt.ca

Version déposée le 2026-10-31 par Claude (agent MIMT nº 2, session 01GtWamF). Source : Drive › MIMT › « 2026-10-31 — MIMT — Tableau
de bord Sans-fil + Téléphonie d'affaires (relevé portail…) », relevé visuel en lecture seule par Claude Cowork (session 013t9Lv2)
du portail d'affaires de l'opérateur actuel de Matt.

**Règles.**
- On reproduit la logique, pas la marque ni les textes de l'opérateur.
- Aucun courriel personnel ni numéro de compte dans le dépôt.
- Gel du VPS (FICHE MAÎTRE, 2026-10-31) : aucune fusion ni aucun déploiement, un seul chantier de code à la fois, PR ouvertes seulement.

« Existant » indique ce que MIMT a déjà dans le code (main ou branche ouverte), d'après une lecture rapide. Il faudra confirmer
au début de chaque chantier.

## 1. Navigation

- **Barre du haut :** Tableau de bord · Préférences · Langue (FR/EN) · Compte · Liens rapides · Déconnexion.
- **Module « Téléphonie d'affaires » :**
  - Aperçu.
  - Paramètres du service :
    - réceptionnistes automatiques ;
    - groupes de recherche ;
    - bibliothèque d'heures et de fériés ;
    - bibliothèque d'accueils et de musique d'attente ;
    - numéro et nom de l'entreprise (afficheur).
  - Gestion des utilisateurs : accès, réglages d'appel des utilisateurs, mes réglages.
  - Soutien (guides).
- **Existant :** menu latéral et accueil « Centre de contrôle » (#87) ; section MIMT Affaires (standard).
- **À faire :** regrouper ces écrans sous un module « Téléphonie d'affaires » avec cette arborescence.

## 2. Accueil du compte (section « Sans-fil »)

L'opérateur affiche :
- des tuiles : mode de paiement, demande de facturation, historique des paiements, solde ;
- des actions : ajouter une ligne, suivre une commande, gérer les dépassements, voir les factures, payer ;
- l'utilisation par ligne : forfait partagé ou non, type de SIM, jauges, options avec prix et bouton Retirer ;
- des actions par ligne : changer le nom, le numéro ou la SIM, mot de passe de messagerie, perte ou vol (suspendre), portage,
  forfait voyage, réinitialiser la boîte vocale.

**Pour MIMT :**
- Ce qu'on peut faire avec nos **lignes VoIP** : facturation Stripe, factures, utilisation (jauges déjà présentes), options,
  portage, messagerie, suspension.
- **SIM, eSIM et données partagées : MIMT n'est pas opérateur mobile.** Twilio Super SIM vise l'Internet des objets, pas
  les téléphones. Décision de Matt (section 11) : partenariat avec un opérateur mobile virtuel, ou afficher seulement nos lignes VoIP.

## 3. Aperçu de la téléphonie d'affaires

- **Bandeau de premier usage**, avec « Ne plus afficher » :
  1. configurer les postes ;
  2. personnaliser l'accueil et le menu ;
  3. créer des groupes de recherche.
- **Compteurs** : utilisateurs (recherche par nom, numéro ou poste) ; utilisateurs sans poste ; utilisateurs sans accès.
- **Listes** : réceptionnistes automatiques et groupes de recherche, avec leur état.
- **Colonne de droite** : heures, fériés, accueils, musique d'attente (activée ou non), ressources.
- **Existant :** les données du standard (membres, postes, groupes, menu vocal, heures) existent.
- **À faire :** l'écran Aperçu et le bandeau de premier usage.

## 4. Réceptionniste automatique (menu vocal)

**Liste** : actif · numéro · nom du profil · Voir · Modifier · Réinitialiser (retour au défaut 24/7).

**Fiche** : nom du profil, numéro, fuseau horaire.

**Trois périodes**, chacune avec son menu et ses accueils :
- 24/7, ou
- heures d'ouverture + après les heures + fériés et événements spéciaux.

**Menu principal et sous-menus nommés**, sur plusieurs niveaux. Actions possibles par touche :
- téléphoniste (0) ;
- aller à un sous-menu ;
- transférer vers un numéro externe ;
- transférer vers un membre ;
- composer par poste ;
- composer par nom (annuaire) ;
- vers un groupe de recherche ;
- répéter le menu (8) ;
- retour au menu précédent (9).

**Cas réels à supporter :**
- un menu trilingue (0 assistance, 1 FR, 2 EN, 3 ES) ;
- un très gros menu de plus de 70 sous-menus préfixés par langue, d'où le besoin d'un **éditeur d'arbre avec duplication par langue**.

**Assistant en 4 étapes** (rien n'est appliqué avant « Enregistrer ») :
1. heures (profil, courriel de messagerie, numéro, fuseau, 24/7 ou horaire, fériés) ;
2. menu ;
3. accueils ;
4. révision.

**Existant :** menu vocal du standard (pbx/engine.ts, pbx/router.ts), heures et fériés, transferts.

**À faire, à vérifier en début de chantier :**
- sous-menus sur plusieurs niveaux ;
- composer par nom ;
- périodes distinctes avec menus distincts ;
- éditeur d'arbre avec duplication par langue ;
- assistant en 4 étapes ;
- Réinitialiser.

## 5. Groupes de recherche (le bouton « Équipe » de BesoinAvocat)

**Liste** : actif · numéro · nom · nombre d'utilisateurs · mode de sonnerie (simultané ou séquentiel).

**Fiche** :
- numéro, nom, courriel de messagerie, fuseau ;
- « Sans réponse » : délai maximal en secondes, puis destination (utilisateur, numéro externe ou boîte vocale) ;
- membres.

**Assistant en 4 étapes** : horaire, sonnerie, membres, révision.

**Existant :** groupes de sonnerie simultanés et séquentiels, délai, repli vers la messagerie, filtre « disponible » (lot B, #100)
et filtre « consentant » (#102).

**À faire :** destination « numéro externe » si elle manque, horaire propre au groupe, assistant.

## 6. Bibliothèque d'heures et de fériés

**Horaires** :
- horaires nommés et réutilisables, avec Voir, Modifier, Supprimer et Créer ;
- formulaire par jour : début, fin, case « Fermé », bouton « Appliquer à tous les jours » ;
- par défaut : 9 h à 17 h en semaine, fin de semaine fermée.

**Fériés** : dates nommées, réutilisables par les menus et par les groupes.

**Existant :** heures et fériés par entreprise.

**À faire :** une **bibliothèque** d'horaires nommés partagés par plusieurs menus et groupes.

## 7. Bibliothèque d'accueils et musique d'attente

**Accueils** :
- liste : nom, lecteur, volume, Modifier, Retirer ;
- ajouter en enregistrant (téléphone ou navigateur) ou en téléversant ;
- format cible : `.wav` mono, 8 ou 16 bits, 8 000 ou 16 000 Hz. MIMT accepte aussi mp3 et m4a, avec conversion
  côté serveur (ffmpeg) et vérification de la durée et du volume ;
- option « voix IA » (synthèse vocale fr-CA et en-CA) et option « studio » payante.

**Musique d'attente** : désactivée par défaut ; musique système ou fichier téléversé.

**Existant :** accueils de messagerie, enregistrés par téléphone (twilioGreeting.ts) ou téléversés, et détection du type de fichier
(lib/sniff.ts).

**À faire :**
- bibliothèque d'accueils partagée par les menus ;
- conversion ffmpeg ;
- musique d'attente ;
- voix IA.

## 8. Numéro et nom de l'entreprise (afficheur sortant)

- Nom et numéro affichés par l'entreprise.
- Chaque utilisateur choisit son afficheur : personnel, double identité ou entreprise.
- Twilio : enregistrement du nom de l'appelant (CNAM) et numéros vérifiés.

**À faire :** tout l'écran, ainsi que l'enregistrement CNAM, à vérifier au Canada.

## 9. Utilisateurs et réglages d'appel

**Liste** : nom · numéro · double identité · type d'appareil · poste · Voir, avec filtre et pagination.

**Mes réglages d'appel** :
- poste ;
- courriel de messagerie ;
- afficheur (numéro et nom) ;
- faire sonner mes numéros (tous en même temps ou un à la fois) ;
- renvoi ;
- horaire de la double identité ;
- appel en attente ;
- « exempt d'intrusion ».

**Accès** : inviter au portail ; rôles administrateur ou utilisateur.

**Existant :** réglages d'appel (renvoi, ne pas déranger, heures calmes), membres et rôles du standard, numéro supplémentaire.

**À faire :**
- double identité avec horaire ;
- choix de l'afficheur par utilisateur ;
- appel en attente ;
- exempt d'intrusion ;
- « faire sonner mes numéros » en mode séquentiel.

## 10. Correspondance technique avec Twilio

| Fonction | Données | Twilio |
|---|---|---|
| Réceptionniste automatique | ivr_menus, ivr_options, ivr_periods, greetings | Webhook voix ; TwiML Gather, Say, Play, Dial, Redirect |
| Heures et fériés | schedules, holidays | Évalués par le routeur d'appel |
| Groupe de recherche | ring_groups, ring_group_members, no_answer_rules | Dial simultané ou chaîne séquentielle, délai, action |
| Accueils et musique d'attente | audio_assets (stockés au Canada), conversion ffmpeg | Play, Enqueue / waitUrl |
| Afficheur | company_caller_id, user_caller_id | callerId sur Dial, numéros vérifiés |
| Double identité | user_numbers (principal et secondaire), schedules | 2 IncomingPhoneNumbers vers le même utilisateur |
| Renvoi et « sonner mes numéros » | user_call_settings | Dial avec plusieurs destinations |
| Messagerie vers courriel | voicemails + courriel (Resend) | Record, recordingStatusCallback |
| Sans-fil | lines, sims, usage, port_requests, addons | À valider (section 11) ; facturation Stripe |

## 11. À décider par Matt

1. **Sans-fil (SIM, eSIM, données partagées)** : MIMT n'est pas opérateur mobile. Partenariat avec un opérateur mobile
   virtuel, ou afficher seulement nos lignes VoIP ?
2. **Menus et groupe de recherche existants chez l'opérateur actuel** : les migrer vers MIMT (portage des numéros) ou les
   garder chez l'opérateur ?
3. **Fichiers .wav des accueils** : il faut les récupérer pour les importer dans MIMT.
4. **Gel du serveur** : rien ne pourra être « en ligne et fonctionnel » avant la levée du gel.

## 12. Ordre des chantiers (un à la fois, PR ouvertes sans fusion pendant le gel)

Ordre proposé, en continuité avec docs/MIMT-CLONE-SPEC.md :

0. **En cours :** consultations vidéo pour BesoinAvocat (branche claude/connect-video).
1. **Pages de vente de mimt.ca**, une par fonction (demande de Matt du 31 oct.), sans toucher à l'accueil.
2. **Bibliothèque d'heures et de fériés** (horaires nommés réutilisables) : c'est la base des étapes 3 et 4.
3. **Groupes de recherche** : assistant en 4 étapes, destination « numéro externe », horaire propre au groupe.
4. **Réceptionniste automatique** :
   - périodes ouvert, fermé et fériés ;
   - sous-menus sur plusieurs niveaux ;
   - composer par nom ;
   - éditeur d'arbre avec duplication par langue ;
   - assistant en 4 étapes.
5. **Bibliothèque d'accueils et musique d'attente** : téléversement, conversion ffmpeg, voix IA.
6. **Afficheur de l'entreprise et réglages d'appel par utilisateur** : double identité, choix de l'afficheur, appel en attente.
7. **Aperçu de la téléphonie d'affaires** : compteurs et bandeau de premier usage. Le tableau de bord de l'app est ensuite
   aligné sur les fonctions des pages de vente.
8. **Section « Sans-fil » du compte** : seulement après la décision 11.1.
