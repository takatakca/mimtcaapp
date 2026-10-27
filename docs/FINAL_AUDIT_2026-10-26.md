# MIMT — Vérification des dernières modifications

## Vérification finale — 26 octobre 2026 (Codex)

**Conclusion : les dernières modifications sont sauvegardées et fusionnées. La finalisation opérationnelle reste bloquée par la preuve de publication et les accès de production.** Cette vérification remplace les affirmations contradictoires des notes antérieures; leurs résultats historiques restent conservés ci-dessous.

### Modifications retrouvées
| PR fusionnée | Résultat |
| --- | --- |
| [#63](https://github.com/takatakca/mimtcaapp/pull/63) | Accessibilité du carrousel et des liens; bannière des témoins compacte |
| [#64](https://github.com/takatakca/mimtcaapp/pull/64) | Connexion/achat : cellulaire en premier; ancien libellé e2e corrigé |
| [#65](https://github.com/takatakca/mimtcaapp/pull/65) | Photos réelles et accueil raccourci; crédits des sources dans le dépôt |
| [#66](https://github.com/takatakca/mimtcaapp/pull/66) | Dépendances Next.js et API corrigées |
| [#67](https://github.com/takatakca/mimtcaapp/pull/67) | Noms de lieux lisibles dans le choix du numéro |
| [#68](https://github.com/takatakca/mimtcaapp/pull/68) | Attente de publication app portée à 15 minutes et WORKLOG |

Les six PR ont un `merged_at`; #68 a été fusionnée le 26 octobre à 19:36 HAE. Base vérifiée : `c308dd81e84d6effda002be85d5216e174fbe560`.
L'avis de crédits concerne la **revue automatique Claude**, sautée notamment sur #65/#68; il ne prouve pas une perte de modifications. La revue #68 confirme explicitement ce motif. Aucun crédit acheté, aucun message envoyé.

### Preuves effectivement consultées
- [CI 40420964736](https://github.com/takatakca/mimtcaapp/actions/runs/40420964736) : completed/success au SHA c308dd8.
- [Publication 40421110321](https://github.com/takatakca/mimtcaapp/actions/runs/40421110321) : échec réel de confirmation. Pendant 60 essais, le manifeste servait `8d38458fe19fcea27786e6b6a363dbf8d95459e2` au lieu de c308dd8. La publication précédente 40417397763 a aussi échoué; ne pas qualifier ces échecs de simples fausses alertes.
- [Surveillance 40438511037](https://github.com/takatakca/mimtcaapp/actions/runs/40438511037) : journaux lus, trois lignes UP et `services down: 0` le 26 octobre à 22:27 HAE. Le script reste vert même en panne : les lignes de résultat, et non le statut seul, constituent la preuve. Ce contrôle ne compare pas les SHA et ne certifie pas la téléphonie.
- Le texte collé, le journal Drive et WORKLOG déclarent 931 tests, fumée 21/21 et scan 53 URL × deux tailles sans violation. Ce sont les résultats historiques de Claude, pas des tests relancés par Codex.
- Aucune PR ouverte avant cette reprise. Les fichiers de relève obligatoires et les workflows ont été lus. Pas de changement de code d'exécution dans cette reprise.

### Contradictions corrigées et actions précises
1. **Publication Coolify** : lire le manifeste actuel de mimt.ca et app.mimt.ca; comparer aux SHA attendus. Inspecter mimt-web (build/webhook/cache) si la vitrine reste sur 8d38458, puis confirmer la tête courante après CI. Ne pas assouplir le contrôle de SHA ni publier un ancien commit. Les sites ont migré sur Coolify : les anciens transferts FTP ciblent un hébergement qui ne les sert plus.
2. **IA** : docs/DECISIONS.md et la relève du 25 octobre attestent une activation et trois réponses françaises; le journal du 26 prétend la clé absente. État actuel indéterminé. Contrôler GET /v1/public/ai-demo/status et les réglages privés autorisés avant de demander une nouvelle clé; ne jamais lire/coller sa valeur. La démo publique ne certifie pas la réceptionniste privée.
3. **Validation réelle** : reprendre la connexion sur téléphone autorisé, puis achat au prix accepté, appel et SMS dans les deux sens; facturation et 9-1-1 suivent leurs protocoles. Les tests sans paiement ne certifient pas ces services.
4. **Autres prérequis** : R2 hors hôte + restauration distante + canal d'alerte; comptes/signatures Apple/Google; LiveKit; revue juridique; Expo/outillage; fournisseur email réel. Sauvegarde locale quotidienne et restauration locale déjà vérifiées le 25 : ne pas les présenter comme inexistantes.
5. **TAKATAK** : correction langue/logo de takatak.ca/login dans son propre périmètre; aucun dépôt TAKATAK modifié ici.

### Limites et accès
L'environnement de cette reprise n'a aucun secret ni identité de production configuré. Sa liste réseau autorise GitHub et les registres, pas les domaines MIMT/Coolify. Aucun accès navigateur de contrôle compatible n'est disponible dans les outils exposés. Vérification indirecte par journaux GitHub uniquement : aucun nouveau test HTTP direct, scan visuel, achat, appel, SMS, migration ou redéploiement. Accès requis : Coolify MIMT et domaines MIMT autorisés, compte/téléphone de test du propriétaire; accès R2/stores/juriste pour leurs tâches. Ne pas transmettre de secrets dans le chat.

Signé : Codex — 26 octobre 2026, America/New_York.
