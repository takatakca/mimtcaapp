# Installer la version de test MIMT sur un téléphone Android

*English below.*

Cette version sert à essayer l'app native MIMT avant Google Play. Elle est gratuite, signée avec une clé de test (Google Play ne l'accepte pas, c'est normal).

1. Sur le téléphone Android, ouvrir **github.com/takatakca/mimtcaapp/releases** (connecté au compte GitHub `takatakca`).
2. Ouvrir **« MIMT — version de test (Android) »** et toucher **MIMT-test.apk**.
3. Quand le téléphone demande, toucher **Paramètres** puis **Autoriser cette source** (Chrome), puis revenir et toucher **Installer**.
4. Si Play Protect affiche un avertissement : **Plus de détails** › **Installer quand même** (l'app ne vient pas encore du Play Store).
5. Ouvrir **MIMT**.

Ce qui marche dans cette version : toutes les pages (appels, textos, messagerie vocale, contacts, compte, MIMT Affaires), la connexion et les appels sortants **si l'API api.mimt.ca est en ligne avec Twilio configuré**.
Ce qui attend : un appel entrant ne fait pas sonner l'app fermée tant que Firebase n'est pas ajouté (secret `GOOGLE_SERVICES_JSON_BASE64`). La connexion par texto demande `TWILIO_VERIFY_SERVICE_SID` sur l'API. « Continuer avec TAKATAK » demande les variables `TAKATAK_ISSUER` et `TAKATAK_MOBILE_CLIENT_ID`.

Mettre à jour : chaque nouvelle compilation remplace le fichier au même endroit ; le réinstaller par-dessus garde les données.

## English

Test build of the native MIMT app (debug-signed, not for Google Play). On the Android phone, signed in to GitHub: open github.com/takatakca/mimtcaapp/releases › "MIMT — version de test (Android)" › MIMT-test.apk, allow installs from this source, install, open MIMT. Incoming calls on a closed app need Firebase (`GOOGLE_SERVICES_JSON_BASE64`); SMS sign-in needs `TWILIO_VERIFY_SERVICE_SID` on the API. Built by `.github/workflows/mobile-test-builds.yml`.
