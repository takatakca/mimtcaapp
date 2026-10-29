# MIMT — Décisions approuvées et contraintes

## D-OPS-MON — Politique de surveillance fiable (29 octobre 2026, PR #85 fusionnée, CI verte)

Conserver le fonctionnement choisi du moniteur : une panne de service correctement signalée par une issue GitHub ne fait pas automatiquement échouer chaque exécution de cron. **Exception indispensable** : lorsqu'une issue d'incident ne peut être recherchée, ouverte, commentée ou fermée, l'exécution doit échouer et rendre l'échec visible. Exiger aussi `readyz.ok=true`, `db=up` et `schema=current`. Régression hermétique sur branche `agent/uptime-alert-delivery-20261029`, sans accès réel aux services. Ne jamais confondre un job UP avec une téléphonie conforme et certifiée.

## Activation autorisée de la clé IA — 25 octobre 2026

Le propriétaire a confirmé l'enregistrement de la clé Anthropic après les instructions de saisie privée. Redéploiement de l'API MIMT depuis le `main` approuvé c27010b, puis essais courts avec données entièrement fictives : trois scénarios publics répondent en français, commande restaurant visible dans le site. Consentements, budgets et forfaits existants conservés. Les fonctions privées et les flux télécom restent soumis à leurs preuves propres; aucune nouvelle approbation de lancement commercial ou réglementaire déduite de la réponse IA.

## Exécution autorisée du 25 octobre 2026

La demande de poursuivre les six actions a été appliquée aux sauvegardes : base MIMT uniquement, quotidien 07:00 UTC, rétention locale 3, exercice de restauration dans un conteneur temporaire sans réseau, aucun changement dans la production TAKATAK. Aucun nouveau coût récurrent, contrat, tarif ni accès de tiers créé. Le seuil d'alerte est 2 jours, mais un canal reste requis; les copies R2 et leur rétention 14 restent à réaliser avec les accès du propriétaire.


## Demande d'exécution du 24 octobre 2026

Le propriétaire a demandé de réaliser les six actions d'activation (IA, téléphone réel, magasins, CRTC, mesure/pub, sauvegardes) et d'indiquer les accès manquants. Cette demande autorise le travail de préparation et de configuration correspondant; elle ne constitue pas une preuve de conformité, de livraison des tests ou d'approbation des magasins. Les tests d'urgence suivent leur protocole et la lettre CRTC reste soumise aux faits vérifiés et à la revue du juriste. Aucun changement de prix, fournisseur ou règle de coûts n'a été décidé lors de cette intervention. Dossier de suivi : `MIMT-ACTIVATION.md`.


Dernière consolidation : 2026-10-14. Une proposition non validée n'est pas une décision. Ne pas modifier prix, coûts récurrents, opérateurs ou garanties réglementaires sans approbation explicite.

| Date | Décision | Raison / conséquence |
| --- | --- | --- |
| 2026-10 | **TAKATAK** reste la source maîtresse d'identité, des espaces de travail et des habilitations; **MIMT** reste une application autonome avec comptes et données télécom privés. | Utiliser le lien OAuth2/OIDC PKCE et JWT serveur; pas de CRM maître parallèle ni de mélange multi-entreprises. |
| 2026-10-10 | **Pas de nouveau projet Supabase payant.** PostgreSQL privée `mimt-prod-postgres` sur l'environnement Coolify déjà utilisé. | Ne pas recréer un projet Supabase facturable ni connecter les tables du tableau de bord TAKATAK à l'API télécom. Assurer backups et capacité serveur. |
| 2026-10-20 | **Règle du propriétaire : jamais de perte par client.** Coût Twilio au pire cas ≤ 70 % du prix après frais Stripe. Gamme de lancement : Gratuit sans numéro (entre applications, pub), **Essentiel 12,99 $** (code interne `lock`, numéro compris), Premium 29,99 $ (200/300 min), Affaires 34,99 $/ligne (300/400 min), Affaires Pro 44,99 $/ligne. Vrai numéro payé d'avance; essai de 7 jours facultatif, carte exigée. | `docs/MIMT-UNIT-ECONOMICS.md`. Le code `lock` reste dans la base, Stripe et les SKU des magasins; seul le nom affiché change. Un forfait qui casse la règle fait échouer la CI et refuse le démarrage de l'API. Remplace les deux lignes du 2026-10-10 ci-dessous. |
| 2026-10-27 | **Annuel : 12 mois pour le prix de 11** (« un mois gratuit si t'achètes pour un an ») pour Essentiel, Premium, Affaires et Affaires Pro. Plafond annuel distinct `MAX_COST_SHARE_YEARLY = 0,80`, jamais au-delà de 100 % (perte); la règle mensuelle de 70 % reste inchangée. **Missions MIMT** : minutes en prime vérifiées par le serveur, une fois par compte, 150 min au plus, coupe-circuit `MISSIONS`. | Coût du mois gratuit au pire cas : Essentiel 70,6 %, Premium 75,4 %, Affaires 74,6 %, Affaires Pro 72,8 % (`MIMT-UNIT-ECONOMICS.md`). Règles et limites juridiques des missions : `MIMT-MISSIONS.md` (aucune récompense d'avis, de « j'aime » ou de partage social, aucun hasard). Branche `claude/missions`. |
| 2026-10-10 | ~~Maintenir les tarifs approuvés calculés selon les coûts : Premium 19,99 $/mois, Affaires 34,99 $/ligne/mois, Affaires Pro 44,99 $/ligne/mois.~~ Remplacé le 2026-10-20. | Ne pas appliquer les réductions de prix proposées dans `MIMT-PARITY.md` sans nouvelle décision. |
| 2026-10-10 | ~~Forfait gratuit limité à 30 minutes sortantes mensuelles~~ (remplacé le 2026-10-20 : Gratuit sans numéro); publicité récompensée pour du temps additionnel. | Ne pas annoncer un illimité gratuit; préserver les contrôles antifraude et la priorité 9-1-1. |
| 2026-10 | Français d'abord; identité visuelle MIMT bleu électrique sur marine profond, vert réservé à l'état. | Respecter `docs/BRAND.md` pour Web, mobile et business. |
| 2026-10 | Publication automatique du **site vitrine seulement** après CI réussie sur `main`; webphone et API restent manuels jusqu'à la levée des blocages. | Bloquer le rollback par ancienne CI, attester le commit par un manifeste public; ne pas confondre publication du marketing avec lancement télécom. |
| 2026-10 | **9-1-1 n'est jamais bloqué par les limites de forfait, solde ou suspension.** | Les avis, adresses, partenaires d'urgence et tests réels suivent leur procédure et autorisations; jamais de faux appel d'urgence. |
| 2026-10 | Twilio pour Voice/SMS et intégration TAKATAK; Stripe pour la facturation selon le périmètre défini dans le code. | Activer en production seulement lorsque clés, webhooks, responsabilités contractuelles et conformité sont prouvés. |
| 2026-10 | Vidéotron ou autre revendeur nécessite un accord et une API officielle. | Conserver l'adaptateur sandbox inactif côté production jusqu'à entente et validation. |
| 2026-10-22 | **Écran verrouillé d'un appel entrant :** titre « Appel entrant » / « Incoming call », corps limité à un @nom ou un numéro E.164, ouverture de `/appels`, expiration 60 secondes. Pas de notification si l'appel est refusé, bloqué, renvoyé ou envoyé en messagerie. Le héros de mimt.ca dit les textos gratuits avec @nom et le plafond d'appels entre applications du forfait Gratuit (`PLANS.free.caps.onNetMinutes`, 120), sans appeler ces appels illimités. | Un écran verrouillé n'est pas un lieu privé (Loi 25). Le plafond vient du forfait, pas d'une phrase marketing. |

## Décisions non prises ou restant à documenter

- Responsable des renseignements personnels, raison sociale finale, rétention des enregistrements, établissement des avis 9-1-1, ententes de transfert IA/Loi 25.
- Coûts et tarification finale des numéros additionnels, options interurbaines/internationales et offres de revente, lorsque marquées provisoires.
- Modalités de sauvegarde, espace libre sur Coolify et preuve de restauration; contrat et configuration du fournisseur de secours.
- Activation commerciale effective des appels, textos, paiements, stores et revente : **pas encore approuvée**.

Toute décision future doit citer le dossier/issue/PR où elle a été acceptée, et mettre à jour cette page et la file des tâches.
