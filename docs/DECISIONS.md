# MIMT — Décisions approuvées et contraintes

Dernière consolidation : 2026-10-14. Une proposition non validée n'est pas une décision. Ne pas modifier prix, coûts récurrents, opérateurs ou garanties réglementaires sans approbation explicite.

| Date | Décision | Raison / conséquence |
| --- | --- | --- |
| 2026-10 | **TAKATAK** reste la source maîtresse d'identité, des espaces de travail et des habilitations; **MIMT** reste une application autonome avec comptes et données télécom privés. | Utiliser le lien OAuth2/OIDC PKCE et JWT serveur; pas de CRM maître parallèle ni de mélange multi-entreprises. |
| 2026-10-10 | **Pas de nouveau projet Supabase payant.** PostgreSQL privée `mimt-prod-postgres` sur l'environnement Coolify déjà utilisé. | Ne pas recréer un projet Supabase facturable ni connecter les tables du tableau de bord TAKATAK à l'API télécom. Assurer backups et capacité serveur. |
| 2026-10-20 | **Règle du propriétaire : jamais de perte par client.** Coût Twilio au pire cas ≤ 70 % du prix après frais Stripe. Gamme de lancement : Gratuit sans numéro (entre applications, pub), **Essentiel 12,99 $** (code interne `lock`, numéro compris), Premium 29,99 $ (200/300 min), Affaires 34,99 $/ligne (300/400 min), Affaires Pro 44,99 $/ligne. Vrai numéro payé d'avance; essai de 7 jours facultatif, carte exigée. | `docs/MIMT-UNIT-ECONOMICS.md`. Le code `lock` reste dans la base, Stripe et les SKU des magasins; seul le nom affiché change. Un forfait qui casse la règle fait échouer la CI et refuse le démarrage de l'API. Remplace les deux lignes du 2026-10-10 ci-dessous. |
| 2026-10-10 | ~~Maintenir les tarifs approuvés calculés selon les coûts : Premium 19,99 $/mois, Affaires 34,99 $/ligne/mois, Affaires Pro 44,99 $/ligne/mois.~~ Remplacé le 2026-10-20. | Ne pas appliquer les réductions de prix proposées dans `MIMT-PARITY.md` sans nouvelle décision. |
| 2026-10-10 | ~~Forfait gratuit limité à 30 minutes sortantes mensuelles~~ (remplacé le 2026-10-20 : Gratuit sans numéro); publicité récompensée pour du temps additionnel. | Ne pas annoncer un illimité gratuit; préserver les contrôles antifraude et la priorité 9-1-1. |
| 2026-10 | Français d'abord; identité visuelle MIMT bleu électrique sur marine profond, vert réservé à l'état. | Respecter `docs/BRAND.md` pour Web, mobile et business. |
| 2026-10 | Publication automatique du **site vitrine seulement** après CI réussie sur `main`; webphone et API restent manuels jusqu'à la levée des blocages. | Bloquer le rollback par ancienne CI, attester le commit par un manifeste public; ne pas confondre publication du marketing avec lancement télécom. |
| 2026-10 | **9-1-1 n'est jamais bloqué par les limites de forfait, solde ou suspension.** | Les avis, adresses, partenaires d'urgence et tests réels suivent leur procédure et autorisations; jamais de faux appel d'urgence. |
| 2026-10 | Twilio pour Voice/SMS et intégration TAKATAK; Stripe pour la facturation selon le périmètre défini dans le code. | Activer en production seulement lorsque clés, webhooks, responsabilités contractuelles et conformité sont prouvés. |
| 2026-10 | Vidéotron ou autre revendeur nécessite un accord et une API officielle. | Conserver l'adaptateur sandbox inactif côté production jusqu'à entente et validation. |

## Décisions non prises ou restant à documenter

- Responsable des renseignements personnels, raison sociale finale, rétention des enregistrements, établissement des avis 9-1-1, ententes de transfert IA/Loi 25.
- Coûts et tarification finale des numéros additionnels, options interurbaines/internationales et offres de revente, lorsque marquées provisoires.
- Modalités de sauvegarde, espace libre sur Coolify et preuve de restauration; contrat et configuration du fournisseur de secours.
- Activation commerciale effective des appels, textos, paiements, stores et revente : **pas encore approuvée**.

Toute décision future doit citer le dossier/issue/PR où elle a été acceptée, et mettre à jour cette page et la file des tâches.
