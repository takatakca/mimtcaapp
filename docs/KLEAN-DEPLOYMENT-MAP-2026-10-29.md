# KLEAN — Déploiement mimt.ca — carte 2026-10-29

Mission : agent KLEAN déploiement 6/10, lancée 2026-10-29 vers 17:14 HAE.
Périmètre strict : `takatakca/mimtcaapp` et `takatakca/mimt` seulement. Aucun autre dépôt touché.
Fichier central Drive ID 1vTzXrkvfhmE-zp2iquvQByRE6LXETaWJ NON touché (consolidation coordinateur).
Aucun secret copié : seuls des NOMS de secrets déjà visibles dans les workflows sont cités, jamais de valeur.
Aucun paiement, aucun envoi au nom de l'utilisateur.
KLEAN n'a AUCUN accès Coolify vérifié et aucun connecteur Coolify : rien ici ne prétend un déploiement
ou une vérification Coolify côté panneau. Un merge n'est PAS une preuve de mise en ligne.

## AVANT (état au briefing, à re-vérifier — et re-vérifié ci-dessous)

- mimtcaapp : main affirmé en divergence — 93d303d (briefing de la vague) vs ffa2ac5 (affirmé ensuite).
- mimtcaapp : PR #84 sécurité sessions mergée, PR #85 affirmée mergée via 540b295, PR #81 et #77 ouvertes,
  issue #69 preuve de publication Coolify.
- Points NON établis au briefing : sort de la PR #83 MIMT Connect, cause CI 3581232, états PR #77, issue #69, PR #81.
- Règle dure appliquée : AUCUN travail MIMT Connect tant que #83 et 3581232 ne sont pas établis.
- mimt : main dc75a39 connu, déploiement automatique à configurer.

## PENDANT (vérifications effectuées 2026-10-29, 17:16–17:30 HAE)

Identité GitHub vérifiée : `takatakca` (TAKATAK MARKETING, takatak.ca@gmail.com), connexion MCP OK, aucun HTTP 429 rencontré.

### 1. Divergence mimtcaapp RÉSOLUE — pas une divergence, un briefing périmé

Historique `main` de `takatakca/mimtcaapp`, vérifié commit par commit (heures UTC) :

- `93d303d0e3128652e5a0230edc2d61c77acd34c9` — Merge PR #84, 2026-10-29 09:03:11Z (= 05:03 HAE).
  C'était bien le main au moment du briefing de la vague.
- Puis, dans l'ordre : `0ae04b0`, `6fc35cf`, `ec21746`, `48555fb` (correctif alertes uptime MON-ALERT-01).
- `540b295cae9a6540c28dc38e2a43ba839c0d60ba` — Merge PR #85, 2026-10-29 20:12:52Z.
  PR #85 CONFIRMÉE mergée.
- `ffa2ac587b0991bf106cb73f367f94e3ca230a79` — « docs(handoff): confirm merged uptime PR and
  reconcile Google Drive evidence », 2026-10-29 20:14:36Z (= 16:14 HAE).

Conclusion : `ffa2ac5` est le descendant direct de `93d303d` via `540b295`. Les deux affirmations
étaient vraies à deux moments différents. **Main actuel vérifié : `ffa2ac587b0991bf106cb73f367f94e3ca230a79`.**

### 2. PR #83 MIMT Connect — ÉTABLIE : MERGÉE (mais la règle dure reste partiellement en vigueur)

- PR #83 « MIMT Connect : plateforme partenaires (premier partenaire : besoinavocat.ca) » :
  état `closed`, `merged: true`, `merged_at` 2026-10-29 08:54:56Z, tête `b54cffe3402f23b2396c671082d29a2fdcb1fe79`,
  branche `claude/partners`, 39 fichiers, +3626/−16.
- Preuve dans `main` actuel : `supabase/migrations/0023_partners.sql` présent sur `main`
  (SHA blob 6a9c0b327aa99c133d50b13a84503e76a4ec90) et `docs/MIMT-CONNECT.md` présent sur `main`.
  Le code MIMT Connect est donc DANS `main`, désactivé par défaut (`PARTNERS=off`, selon le corps de la PR #83).
- Le commit de fusion de la PR #84 mentionne lui-même « Merge main (clawback 0021, partners 0023)
  into security » : le code partenaires a circulé dans `main` via cette fusion aussi.

### 3. CI 3581232 — NON ÉTABLIE (et c'est le point qui bloque encore MIMT Connect)

- Aucun outil GitHub disponible ici ne permet de consulter un run Actions par cet identifiant
  (le catalogue MCP exposé ne contient pas de lecture de run Actions).
- Les identifiants de runs observés dans les docs `main` sont de la série 40 8xx xxx / 40 9xx xxx
  (ex. CI main 40947007313, Auto deploy 40846814733) : `3581232` (7 chiffres) ne correspond à aucun
  de ces formats observés, et la recherche de code est globale/non filtrable par dépôt, donc inutilisable
  pour l'attribuer à `mimtcaapp`.
- Conséquence stricte : **la cause CI 3581232 reste NON établie. Donc AUCUN travail MIMT Connect
  n'a été fait dans cette mission** : aucune intégration créée, aucune activation, aucun partenaire créé,
  aucune modification du code partenaires. L'activation éventuelle (`PARTNERS=on` dans Coolify, DPA,
  forfait Affaires Pro — étapes listées dans le corps de la PR #83 comme « Après la fusion (propriétaire) »)
  reste du ressort du propriétaire, après établissement de 3581232.

### 4. PR #77 et PR #81 — OUVERTES, mais NON PRÊTES (conflits) : NON mergées, à juste titre

- PR #77 « ci(deploy): retirer les envois FTP MochaHost du workflow Deploy » : OUVERTE,
  tête `claude/retire-ftp-deploy` (`4e61f2e`), base ancienne `a619f2f`, `mergeable_state: dirty`.
  Contenu (lu) : depuis le 2026-10-26, `mimt.ca`/`www` et `app.mimt.ca` sont servis par Coolify sur vps1
  (applications `mimt-web` et `mimt-app`, construites depuis `main`) ; le workflow manuel `Deploy`
  envoyait encore par FTP vers MochaHost, qui ne sert plus ces domaines. La PR ne garderait que la
  portée manuelle `api` (Coolify, puis contrôles `/healthz` et `/readyz`) et demanderait au propriétaire
  de supprimer ensuite les secrets FTP MochaHost devenus inutilisés.
  → Impossible à merger en l'état (conflit) ; nécessite une résolution de conflit / rebase, hors
  périmètre « carte de déploiement ». NON mergée ici.
- PR #81 « docs: owner checklist for the hosting move » : OUVERTE, tête `claude/owner-actions`
  (`e6a7028`), `mergeable_state: dirty`. Docs seulement (`docs/OWNER_ACTIONS.md` : O-14, O-15, C-11).
  → NON mergée ici (conflit). Donc `docs/OWNER_ACTIONS.md` est ABSENT de `main` à cette heure.
- Statuts combinés des trois PR vérifiées (#83, #77, #81) : `pending`, 0 statut remonté — aucune
  conclusion CI exploitable via cet outil pour ces têtes.

### 5. Issue #69 — OUVERTE, toujours le suivi des preuves

- Issue #69 « Finaliser la preuve de publication Coolify après l'audit #63–#68 » : OUVERTE,
  créée 2026-10-27, non assignée, 0 PR liée pour la fermer. Son corps (26 octobre, Codex) constatait
  déjà : publication Coolify non démontrée au SHA exact pour l'API, surveillance sans comparaison de SHA.
  → Laissée OUVERTE. La preuve de manifeste collectée ci-dessous (section APRÈS) fait avancer #69
  pour la vitrine et l'app, mais ne la ferme pas : la preuve API au SHA exact manque toujours.

### 6. mimt (takatakca/mimt) — ligne LEGACY, pas le dépôt de déploiement

- `main` vérifié : `dc75a3921bb9483752ab1f2f3aa189822c5a44ff`, 2026-10-16 17:49:41Z
  (« docs(handoff): record green lease-fencing CI and TAKATAK idempotency requirement »).
  Aucun commit depuis le 16 octobre ; branches restantes datées du 14–16 octobre.
- 0 PR ouverte, 0 issue ouverte.
- Son propre README (main) : « Le déploiement automatique du site nécessite encore la configuration
  de l'hébergement. » Son `docs/DEPLOYMENT.md` (rév. 2026-10-14) déclare l'hébergeur « inconnu tant que
  DNS, racine de document et compte de contrôle ne sont pas vérifiés » et son `deploy-web.yml`
  est conditionné par des variables panneau (`MIMT_WEB_DEPLOY_ENABLED`, `MIMT_WEB_PARITY_REVIEWED`)
  dont les valeurs ne sont pas vérifiables depuis le code.
- La relève `mimtcaapp` (docs/AGENT_HANDOFF.md sur main) désigne explicitement `takatakca/mimtcaapp`
  comme dépôt produit actif et `takatakca/mimt` comme « ancienne ligne de travail distincte ;
  ne pas y pousser de nouveaux correctifs de production sans réconciliation ».
  → **AUCUN push, AUCUNE PR, AUCUNE modification dans `takatakca/mimt` dans cette mission.**
  Son auto-déploiement = NON configuré / NON démontré. Toute réutilisation future exige d'abord
  une réconciliation documentée entre les deux lignes.

## APRÈS — Carte de déploiement par repo (état réel au 2026-10-29 ~17:30 HAE)

### Repo A — takatakca/mimtcaapp — DÉPÔT DE DÉPLOIEMENT ACTUEL ✅

| Élément | État vérifié |
|---|---|
| Main actuel | `ffa2ac587b0991bf106cb73f367f94e3ca230a79` (2026-10-29 20:14:36Z) |
| Cible vitrine mimt.ca / www | Coolify, vps1, application `mimt-web`, build depuis `main` (déclaré dans `auto-deploy-website.yml` sur main et dans le corps de la PR #77). MochaHost ne sert plus ces domaines depuis le 2026-10-26. |
| Cible app app.mimt.ca | Coolify, vps1, application `mimt-app`, build depuis `main` (corps PR #77). |
| Cible API | Coolify, déploiement via workflow manuel `Deploy` portée `api` + secrets Coolify (noms seulement : COOLIFY_URL, COOLIFY_TOKEN, COOLIFY_API_UUID). URL publique de l'API non établie depuis les fichiers lus — non affirmée ici. |
| Config de déploiement présente ? | OUI, partielle : `ci.yml` (push main), `auto-deploy-website.yml` (confirmation après CI), `deploy.yml` (manuel). MAIS `deploy.yml` sur main contient encore les portées FTP MochaHost obsolètes (website/webphone/all) — ne pas les utiliser tant que la PR #77 n'est pas résolue et mergée. |
| Auto-déploiement vitrine | OUI, déjà actif et maintenant PROUVÉ (voir preuve en ligne ci-dessous). Mécanisme : Coolify construit `main` à chaque push ; `auto-deploy-website.yml` attend ensuite jusqu'à 15 min que `mimt-release.json` serve le SHA exact de la CI. Aucun changement de code nécessaire de ma part pour l'activer. |
| Auto-déploiement app | OUI par le même mécanisme de build Coolify sur push (application `mimt-app`), prouvé par le manifeste ci-dessous. Le workflow de confirmation ne couvre explicitement que la vitrine. |
| Auto-déploiement API | NON — volontairement manuel (portée `api` du workflow `Deploy`, déclenchement manuel seulement). C'est une barrière de sécurité télécom (9-1-1, paiements, Twilio), pas un oubli : l'activer automatiquement exigerait une décision propriétaire (voir checklist). NON activé par code dans cette mission, à dessein. |
| Ce qui manque pour « connecter GitHub au client » | Côté GitHub→Coolify, la connexion vitrine/app fonctionne déjà (preuve SHA). Reste, côté panneau Coolify (non vérifiable ici) : confirmer que les applis `mimt-web`/`mimt-app` ont bien le webhook/build-on-push activé et pointent sur `main` de `mimtcaapp` (et non sur l'ancien repo) ; pour l'API, décider manuel vs auto (checklist ci-dessous) ; côté GitHub, résoudre puis merger #77 (retrait FTP) et #81 (checklist propriétaire) une fois leurs conflits réglés. Aucun webhook/DNS/secret n'a pu être vérifié côté panneau — non affirmé. |

### Preuve en ligne (vérifiée 2026-10-29, lectures ~21:24–21:25 UTC = 17:24–17:25 HAE)

- `https://mimt.ca/mimt-release.json` → `{"commit":"ffa2ac587b0991bf106cb73f367f94e3ca230a79"}`
  = EXACTEMENT le main actuel. ✅ Vitrine en ligne au dernier commit.
- `https://app.mimt.ca/mimt-release.json` → `{"commit":"ffa2ac587b0991bf106cb73f367f94e3ca230a79"}`
  = EXACTEMENT le main actuel. ✅ App en ligne au dernier commit (manifeste).
- Limite de la preuve : le manifeste prouve le SHA du build web/app servi, PAS le SHA de l'API,
  PAS la téléphonie réelle (appel/SMS/9-1-1), PAS les paiements. La dernière preuve vitrine
  antérieure citée dans les docs était au SHA `93d303d` (run 40846814733, 29 oct. 09:07 UTC) :
  la preuve ci-dessus la remplace pour le main actuel.
- API en ligne : NON VÉRIFIÉE EN LIGNE dans cette mission (aucune URL d'API établie depuis
  les fichiers lus ; les derniers contrôles `/healthz`/`/readyz` cités dans les docs datent de
  runs antérieurs et ne certifient pas le SHA `ffa2ac5`). À ne pas présenter comme déployée au SHA actuel.

### Repo B — takatakca/mimt — LEGACY, ne pas déployer depuis ce repo ❌

| Élément | État vérifié |
|---|---|
| Main actuel | `dc75a3921bb9483752ab1f2f3aa189822c5a44ff` (2026-10-16) |
| Cible d'hébergement déclarée | NON DÉTERMINÉE (son DEPLOYMENT.md 2026-10-14 : hébergeur inconnu) |
| Config de déploiement présente ? | Partielle et verrouillée : `ci.yml` + `deploy-web.yml` conditionné par `MIMT_WEB_DEPLOY_ENABLED=true` ET `MIMT_WEB_PARITY_REVIEWED=true` (variables panneau, valeurs non vérifiables ici) |
| Auto-déploiement | NON — non configuré / non démontré |
| État en ligne | NON VÉRIFIÉ EN LIGNE depuis ce repo (les domaines mimt.ca / app.mimt.ca servent le build `mimtcaapp`, preuve ci-dessus, pas celui-ci) |
| Action | AUCUNE. Réconciliation préalable requise avant toute réutilisation. |

## Checklist exacte pour le propriétaire (panneau — KLEAN ne peut pas le faire sans accès Coolify)

1. Coolify → applications `mimt-web` et `mimt-app` (vps1) : confirmer visuellement que le dépôt source
   est `takatakca/mimtcaapp`, branche `main`, et que le build automatique sur push (webhook) est activé.
   Si l'une pointe encore vers `takatakca/mimt` ou une autre branche, la corriger et redéployer.
2. Coolify → application API MIMT : DÉCIDER — garder le déploiement manuel (recommandé tant que les
   validations télécom/9-1-1 ne sont pas closes) ou activer l'auto-déploiement sur `main`. Si auto :
   l'activer dans le panneau Coolify de l'app API, puis seulement ensuite envisager un déclencheur
   automatique côté GitHub ; ne jamais activer l'auto-API en même temps qu'un changement MIMT Connect.
3. GitHub → `takatakca/mimtcaapp` : faire résoudre les conflits des PR #77 (retrait FTP) et #81
   (checklist propriétaire), re-vérifier leur CI, puis merger. Après merge de #77, supprimer les
   secrets GitHub FTP MochaHost devenus inutilisés (noms cités dans le corps de la PR #77) — jamais
   de valeur copiée nulle part.
4. MIMT Connect — NE PAS ACTIVER avant d'avoir établi la cause CI 3581232 : retrouver ce que
   désigne 3581232 (run, job ou vérification) dans GitHub Actions avec un accès panneau, en noter
   la conclusion, puis seulement suivre les étapes « Après la fusion (propriétaire) » de la PR #83 :
   DPA avec besoinavocat.ca, forfait Affaires Pro + numéro public, puis `PARTNERS=on` dans Coolify,
   création du partenaire et ajout de crédits. Sans 3581232 établi, `PARTNERS` reste `off`.
5. Issue #69 : la garder ouverte jusqu'à une preuve API au SHA exact (contrôle `/healthz`/`/readyz`
   + version/commit exposé par l'API, ou journal de déploiement Coolify horodaté) ; y consigner
   la preuve de manifeste `ffa2ac5` du 2026-10-29 17:24–17:25 HAE pour la vitrine et l'app.
6. Repo `takatakca/mimt` : ne rien y déployer ; décider (archiver, ou réconcilier documentée)
   avant toute réutilisation.

## Travail GitHub de cette mission

- Branche créée dans `mimtcaapp` : `klean/deploy-map-2026-10-29` (voir PR ci-dessous).
- Note GitHub : `docs/KLEAN-DEPLOYMENT-MAP-2026-10-29.md` (même contenu que cette note Drive).
- PR : créée depuis cette branche vers `main` (voir le rapport final KLEAN pour son numéro) ;
  PR laissée OUVERTE en attente de CI — un merge immédiat sans CI aurait violé
  la règle « ne merger que ce qui est revu et prêt ».
- Fusions dans cette mission : AUCUNE. Justification : #77 et #81 sont en conflit (`dirty`,
  non mergeables en l'état) ; #83/#84/#85 étaient déjà mergées ; aucun nouveau code de déploiement
  n'était nécessaire (auto-déploiement vitrine/app déjà actif et prouvé) ; l'auto-API n'a pas
  été activée à dessein (barrière télécom manuelle).
- Modifications dans `mimt` : AUCUNE. Modifications MIMT Connect : AUCUNE.

## Point d'arrêt exact

Mission carte de déploiement terminée 2026-10-29 ~17:30 HAE, sauf le numéro de PR GitHub
(à compléter dans le rapport final dès sa création) et la CI de cette PR (en attente).
Prochaine reprise : (1) relever la CI de la PR de cette note, (2) établir 3581232 avec accès
Actions/panneau, (3) résolution des conflits #77/#81, (4) preuve API au SHA exact pour fermer #69.
Aucun blocage GitHub 429 rencontré.

Signé : KLEAN — agent déploiement 6/10 (mimt.ca) — 2026-10-29.
