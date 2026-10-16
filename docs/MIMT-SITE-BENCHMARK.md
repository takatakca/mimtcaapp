# mimt.ca : étude comparative des sites (TextNow, Fongo)

Date de consultation : **2026-10-16**. Pages lues ce jour-là; leur texte est **résumé**, jamais copié. Les noms des concurrents n'apparaissent **pas** dans les textes marketing de mimt.ca (la page `/comparer/` reste générique : « applis de numéro gratuit typiques »). Pour la parité de fonctions et les prix détaillés, voir `docs/MIMT-PARITY.md` (2026-10-10).

## Sources

| # | URL | Ce qu'on y a relevé |
|---|---|---|
| S1 | https://www.textnow.com/ | Accueil : entonnoir « téléchargez l'app » |
| S2 | https://www.textnow.com/wireless | Forfaits Free / Plus / Unlimited (USD), bascule semaine/mois, tableau comparatif, étiquettes « Broadband Facts » |
| S3 | https://www.textnow.com/how-it-works | Étapes, modèle financé par la pub, récompenses, FAQ |
| S4 | https://www.textnow.com/download | Page de téléchargement : code QR, badges de magasins, fenêtre eSIM |
| S5 | https://www.fongo.com/ | Accueil : cartes produits avec prix |
| S6 | https://www.fongo.com/services/fongo-mobile/ | App mobile gratuite, liste des modules payants |
| S7 | https://www.fongo.com/services/fongo-works/ | Téléphonie d'affaires Free / Pro |
| S8 | https://www.fongo.com/services/fongo-home-phone/ | Téléphone résidentiel, adaptateur, frais de transfert |
| S9 | https://www.fongo.com/wireless | SIM de données seulement, commandes en pause |

## Ce qu'ils font (résumé)

**TextNow (S1–S4)** : entonnoir centré sur un seul geste, **télécharger l'app**. Bouton « télécharger » permanent dans l'en-tête, fenêtre avec **code QR** dans l'en-tête et sur la page de téléchargement, modules de téléchargement répétés dans la page. Preuve sociale chiffrée (note des magasins, nombre d'utilisateurs, logos de presse, un témoignage). Héros court centré sur « gratuit + flexible », puis cartes de fonctions qui renvoient chacune à une page dédiée (numéro gratuit, international, récompenses, données). Processus en 4 étapes. Prix en cartes à trois niveaux qui s'additionnent (« tout ce qu'il y a dans… »), bascule semaine/mois, tableau à coches, étiquettes réglementaires. Lien « Web Messaging » dans le menu. Marché visé : États-Unis (USD, réseau 5G).

**Fongo (S5–S9)** : accueil « catalogue » : une carte par produit (mobile, résidentiel, affaires, Internet) avec **prix en gros** et « Learn more »; pas d'action principale unique. Pas de preuve sociale sur l'accueil (une page « Reviews » séparée); la page Affaires affiche une note Google et des témoignages. Badges de cinq magasins d'applications. Page Affaires très forte sur le **« gratuit pour toujours, sans carte »** et un CTA « Get Started For Free ». Résidentiel : prix promotionnels barrés (adaptateur, livraison, transfert de numéro payant), téléphone de vente affiché. Sans-fil : commandes en pause (grève postale), inscription « avisez-moi ».

## Schémas d'entonnoir à reprendre (sans copier)

1. **Une action principale répétée** (TextNow) : chez MIMT, « Essayer l'app Web » (app.mimt.ca) + « Télécharger l'app » ouvrant une fenêtre unique de téléchargement.
2. **Fenêtre de téléchargement** : TextNow utilise un QR. Les apps MIMT ne sont pas encore publiées : la fenêtre offre l'app Web installable (PWA, instructions iPhone / Android), les badges magasins marqués « Bientôt » (pas de lien) et l'inscription à l'accès anticipé avec consentement LCAP décoché.
3. **Cartes de fonctions qui mènent à une page** : carrousel de fonctions avec lien vers Forfaits, IA, App Web, Affaires.
4. **Étapes numérotées** (3 chez MIMT).
5. **Prix en cartes à niveaux + tableau** : déjà présent sur /forfaits/; ajout d'une carte « Recommandé » et d'un zoom au survol.
6. **Gratuit en évidence** (Fongo Affaires) : MIMT affiche « 0 $ pour commencer » (forfait Gratuit de `PLANS`).
7. **Frais de transfert de numéro** : Fongo facture le transfert au résidentiel (promo à l'inscription); TextNow dit seulement « gardez votre numéro ». MIMT : **transfert gratuit** (`PORT_IN_FEE_CENTS` vaut 0 par défaut dans l'API) — argument mis en avant.

## Ce que MIMT ne copie pas, volontairement

- **Aucune preuve sociale inventée** : pas de note, de nombre d'utilisateurs, de témoignages ni de logos de presse tant qu'ils n'existent pas (Loi sur la concurrence, LPC du Québec). Les compteurs animés montrent seulement des faits du dépôt (langues, forfaits, étapes, minutes Premium).
- **Pas d'urgence artificielle** : pas de compte à rebours, de « places limitées », de prix barrés ni de rabais inventés. L'offre « mise en service gratuite » d'Affaires est marquée « offre de lancement; conditions à venir » et `[À confirmer par MIMT]` en commentaire HTML.
- **« Le plus populaire »** : remplacé par « Recommandé », car MIMT n'a pas encore d'abonnés; une popularité serait invérifiable.
- **Pas de fenêtre plein écran au chargement sur mobile** (règle Google sur les interstitiels intrusifs) : petite feuille en bas après 50 % de défilement, une seule fois par visiteur.

## Fonctions que MIMT possède (code) mais que le site ne présentait pas assez

| Fonction | Preuve dans le dépôt | Sur le site après refonte |
|---|---|---|
| Transfert de numéro (VoIP port-in) avec lettre d'autorisation électronique | `apps/api/src/routes/portIns.ts`, `packages/shared/src/portIn.ts`, `PORT_IN_FEE_CENTS` défaut 0 | Bande « Transfert de numéro gratuit » sur l'accueil, carrousel, FAQ |
| App Web installable (PWA) | `apps/webphone/public/manifest.webmanifest`, `sw.js` | CTA principal + fenêtre de téléchargement avec instructions d'installation |
| Blocage d'appels, renvoi, ne pas déranger avec heures calmes | `routes/blocks.ts`, `routes/me.ts`, `/compte/appels` du webphone | Carte du carrousel « Contrôle de vos appels » |
| Message d'accueil personnalisé, messagerie vocale par courriel | `voicemailSettings.ts`, `twilioGreeting.ts`, fonctions `vm_greeting`, `vm_email` | Carrousel + cartes de forfaits (déjà dans `PLANS`) |
| Parrainage (un mois Premium chacun) | `routes/referrals.ts` | Mentionné nulle part : à ajouter quand l'offre sera confirmée par le propriétaire |
| Réunions vidéo (LiveKit) | `routes/meetings.ts`, `packages/shared/src/meetings.ts` (en cours) | « Bientôt » dans la section Affaires et dans les cartes de forfaits |
| Option « Sans pub » 3,99 $/mois | `packages/shared/src/addons.ts` | Déjà sur /forfaits/ (options) |

## Fonctions des concurrents absentes chez MIMT (rappel, sans engagement)

SIM / eSIM et données mobiles (dépend d'une entente réseau, page « Bientôt »), appels illimités au Canada sur le forfait gratuit, applications de bureau natives, récompenses par publicité (API 501), télécopie. Voir `docs/MIMT-PARITY.md`.
