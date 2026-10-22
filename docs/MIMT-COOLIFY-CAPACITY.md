# MIMT : capacité du serveur Coolify (surcharge)

## Ce qu'on sait

- Un seul serveur Coolify fait tourner **17 applications**, plus le Redis de TAKATAK et le Postgres de MIMT.
- L'API Coolify elle-même a expiré plusieurs fois (diagnostics du 10 au 17 octobre, branches `diag/mimt-*`), alors
  que le conteneur de l'API MIMT était sain (0 redémarrage). C'est le signe d'un hôte à court de CPU, de mémoire
  ou d'entrées-sorties disque, pas d'un bogue MIMT.
- Les déploiements de l'API MIMT mettent plusieurs minutes à passer en ligne après le déclenchement : la
  compilation Docker se fait sur le même serveur que la production.
- `api.mimt.ca/healthz` et `/readyz` répondent en environ 0,2 s quand le serveur n'est pas en train de compiler.
- Surveillance en place depuis ce changement : `.github/workflows/uptime.yml` (toutes les 10 minutes, fiche
  « Panne: … » ouverte automatiquement).

## Recommandation

Dans l'ordre, du plus efficace au plus simple :

1. **Sortir MIMT sur son propre serveur** (API + Postgres) : 4 vCPU / 8 Go de RAM / 80 Go SSD suffisent pour le
   lancement (Hetzner CPX31 ou équivalent, environ 15 à 20 $ par mois). La téléphonie et le paiement ne doivent pas
   ralentir parce qu'une autre application compile.
2. Sinon, **agrandir le serveur actuel** à au moins **8 vCPU / 16 Go** (17 applications plus 2 bases de données).
3. Dans les deux cas :
   - arrêter les applications inactives (aucune visite depuis 30 jours, environnements de test oubliés);
   - mettre une **limite de mémoire** à chaque application (voir la liste ci-dessous) pour qu'aucune ne puisse
     affamer les autres;
   - compiler les images ailleurs que sur le serveur de production (Coolify › Server › « Build Server », ou
     construire dans GitHub Actions et pousser l'image).

## Liste à faire dans Coolify (propriétaire)

1. Coolify › **Servers** › le serveur › onglet **Metrics** (ou `htop` en SSH) : noter CPU, RAM et disque
   occupés au repos et pendant un déploiement.
2. **Projects** : pour chaque application, noter la dernière visite ou le dernier déploiement. **Stop** celles qui
   ne servent plus (elles se redémarrent en un clic).
3. Pour chaque application restante › **Configuration › Resource Limits** :
   - API MIMT : mémoire `1024m`, CPU `2`;
   - Postgres MIMT : mémoire `2048m`;
   - Redis TAKATAK : mémoire `512m`, avec `maxmemory` réglé;
   - applications Web statiques ou petites : `256m` à `512m`.
4. Si l'utilisation reste au-dessus de 70 % de RAM ou de CPU au repos : prendre l'option 1 (serveur dédié MIMT).
   Dans Coolify : **Servers › + Add** (nouveau serveur), y créer un nouveau Postgres MIMT et y restaurer la
   dernière sauvegarde (`docs/MIMT-BACKUPS.md`), y recréer l'API MIMT avec les mêmes variables, puis déplacer le
   domaine `api.mimt.ca` vers la nouvelle API et arrêter l'ancienne.
5. Après le changement : lancer Actions › **Uptime** › Run workflow, puis `scripts/smoke/prod.sh`.

Rien de tout cela n'est faisable depuis le dépôt : l'accès au serveur et à Coolify reste chez le propriétaire.
