# MIMT : publicité et mesure (ce que le propriétaire doit fournir)

Chaque balise s'active **toute seule** dès que son identifiant existe. Sans identifiant, elle reste éteinte; un
identifiant mal formé l'éteint aussi (aucune balise cassée en production). Toutes passent par le **Consent Mode v2**
(Loi 25) : rien de personnel n'est enregistré avant « Accepter » dans la bannière de mimt.ca.

| Où le mettre | Nom exact | Format | Sert à |
| --- | --- | --- | --- |
| GitHub › Settings › Secrets and variables › Actions › **Variables** | `GA4_ID` | `G-XXXXXXXXXX` | Google Analytics 4 sur mimt.ca |
| idem | `GADS_ID` | `AW-1234567890` | Balise Google Ads sur mimt.ca |
| idem | `GADS_HOLD_LABEL` | libellé de conversion (ex. `AbC-dEfGhIj`) | Conversion « numéro réservé » (clic dans le sélecteur) |
| idem | `ADSENSE_SLOT_BANNER`, `ADSENSE_SLOT_SIDEBAR` | chiffres (ex. `1234567890`) | Blocs d'annonces dans app.mimt.ca (forfaits avec pub) |
| déjà en place | `ADSENSE_CLIENT` | `ca-pub-4518068873401341` | AdSense mimt.ca + app (valeur par défaut) |
| Variables de build mobile (EAS) | `ADMOB_IOS_APP_ID`, `ADMOB_ANDROID_APP_ID` | `ca-app-pub-…~…` | App AdMob iPhone / Android |
| idem | `ADMOB_IOS_BANNER_UNIT_ID`, `ADMOB_IOS_REWARDED_UNIT_ID`, `ADMOB_ANDROID_BANNER_UNIT_ID`, `ADMOB_ANDROID_REWARDED_UNIT_ID` | `ca-app-pub-…/…` | Bannière et vidéo récompensée (+10 min) |

Après avoir ajouté les variables GitHub : relancer « Deploy » (scope `website` et `webphone`).

## Événements envoyés

- `generate_lead` (GA4) et conversion Google Ads `GADS_HOLD_LABEL` : un visiteur réserve un numéro dans le sélecteur.
- Achat : à brancher ensuite côté app (`/billing/success`) ou en conversion hors ligne depuis Stripe — recommandé, car
  plus fiable que le navigateur.

## Comment créer chaque identifiant

1. **GA4** : analytics.google.com › Admin › Créer une propriété « mimt.ca » › Flux Web `https://mimt.ca` › copier l'ID
   de mesure `G-…`. Dans le flux, désactiver la « mesure améliorée » des formulaires (inutile).
2. **Google Ads** : ads.google.com › Outils › Conversions › Nouvelle action › Site Web › « Prospect » › nom « Numéro
   réservé » › installer soi-même › copier l'ID `AW-…` et le **libellé**.
3. **AdSense (app)** : adsense.google.com › Annonces › Par bloc › Display › deux blocs « app-banniere » et « app-cote »
   › copier les numéros `data-ad-slot`.
4. **AdMob** : admob.google.com › Applications › ajouter iOS et Android › pour chacune, un bloc Bannière et un bloc
   Avec récompense › copier les ID d'application (`~`) et de blocs (`/`).
