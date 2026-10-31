# Conditions partenaire MIMT Connect et entente de traitement (DPA) / MIMT Connect partner terms and DPA

> **Brouillon — à faire réviser par un avocat avant usage.**
> Draft — to be reviewed by a lawyer before use. This is not legal advice. Not published on any public page.

Version des conditions : **2026-10-31** (`PARTNER_TERMS_VERSION`, `packages/shared/src/partnerScopes.ts`).

Notes pour MIMT (ne font pas partie des conditions) :

- La version française fait foi et vient **en premier** (Charte de la langue française, art. 55). Le résumé anglais à la fin
  n'est qu'une aide.
- Le partenaire signe hors de MIMT (papier ou signature électronique). Un administrateur MIMT enregistre ensuite
  l'acceptation avec `POST /v1/admin/partners/:id/terms-acceptance` (confirmation récente exigée, journalisée) : version,
  date de signature, nom et titre du signataire, nom légal du partenaire, courriel du responsable de la vie privée et
  **finalité déclarée pour chaque accès**. Sans acceptation de la version en vigueur, le partenaire ne peut demander aucun
  accès à un membre (`409 partner_terms_required`).
- Toute modification de ce texte change la version : chaque partenaire doit l'accepter de nouveau avant de faire de
  nouvelles demandes. Les liens déjà approuvés par les membres ne s'agrandissent jamais d'eux-mêmes.
- Le contact d'incident de MIMT (art. 9.1) est donné au Partenaire à la signature : le propriétaire choisit l'adresse.
- Points à faire valider par l'avocat : la qualification des rôles (art. 3 et 4), le délai de 72 heures (art. 9), la
  durée de conservation après la fin (art. 10), la clause d'audit (art. 12), la limitation de responsabilité (art. 14) et
  la juridiction (art. 17).

---

## CONDITIONS PARTENAIRE MIMT CONNECT ET ENTENTE DE TRAITEMENT DES RENSEIGNEMENTS PERSONNELS

Brouillon — à faire réviser par un avocat avant usage.

**ENTRE** Quadro Holdings Ltée (NEQ 1176760537), membre de GROUPE TAKATAK, 5837, rue Jean-Talon Est, Montréal (Québec)
H1S 1M4, qui exploite le service MIMT (« **MIMT** »);

**ET** l'entreprise dont le nom légal, le signataire et le responsable de la protection des renseignements personnels
sont inscrits dans l'acceptation enregistrée par MIMT (le « **Partenaire** »).

### 1. Définitions

- « **MIMT Connect** » : l'interface de programmation, les clés d'API et les webhooks signés par lesquels le système du
  Partenaire utilise le standard téléphonique MIMT de son entreprise (docs/MIMT-CONNECT.md).
- « **Membre** » : une personne que le Partenaire inscrit dans MIMT Connect (par exemple un avocat), identifiée par
  l'identifiant du Partenaire.
- « **Personne reliée** » : un Membre qui a son propre compte MIMT et qui a relié ce compte au Partenaire, elle-même, sur
  la page de consentement de MIMT.
- « **Accès** » : une autorisation nommée et limitée qu'une Personne reliée accorde au Partenaire (par exemple
  `calls.read`, voir la liste à l'annexe A). Chaque Accès est demandé, accordé et retiré séparément.
- « **Finalité déclarée** » : la raison, écrite par le Partenaire dans son acceptation, pour laquelle il a besoin d'un
  Accès.
- « **Renseignements** » : tout renseignement personnel que le Partenaire reçoit par MIMT Connect.
- « **Incident** » : un incident de confidentialité au sens de la Loi sur la protection des renseignements personnels
  dans le secteur privé (RLRQ, c. P-39.1, la « **Loi 25** »), ou une atteinte aux mesures de sécurité au sens de la
  LPRPDE, touchant des Renseignements.

### 2. Objet

Ces conditions encadrent l'usage de MIMT Connect par le Partenaire et le traitement des Renseignements. Elles s'ajoutent
aux conditions d'utilisation de MIMT acceptées pour le compte d'entreprise du Partenaire. En cas de conflit sur la
protection des Renseignements, ces conditions l'emportent.

### 3. Rôles : appels du Partenaire

Pour les appels reçus sur les numéros de l'entreprise du Partenaire et acheminés à ses Membres, **MIMT agit comme
fournisseur de services** (mandataire) du Partenaire au sens de l'article 18.3 de la Loi 25. Le Partenaire reste
responsable des renseignements de ses appelants : avis à ses appelants (y compris l'avis d'enregistrement quand il
enregistre), base légale, durée de conservation et réponse aux demandes d'accès. MIMT traite ces renseignements
seulement pour acheminer les appels, les facturer en crédits, les enregistrer si le Partenaire l'a activé et les
rendre au Partenaire, selon ses instructions et ces conditions.

### 4. Rôles : données des Personnes reliées

Les Renseignements qui viennent du compte MIMT d'une Personne reliée (sa ligne, ses appels traités par MIMT, le statut
de son forfait, ses transferts de numéro, sa disponibilité, les enregistrements des appels qu'elle répond) ne sont
communiqués au Partenaire **qu'avec le consentement manifeste, libre et éclairé de cette personne, Accès par Accès**,
et seulement pour la Finalité déclarée de chaque Accès. Pour ces Renseignements, le Partenaire est une entreprise
distincte, responsable de leur protection dès qu'il les reçoit, avec toutes les obligations de la Loi 25 et de la
LPRPDE.

### 5. Finalités limitées aux finalités déclarées

5.1. Le Partenaire déclare, dans son acceptation, une finalité pour chaque Accès dont il a besoin. Il ne peut demander
à un Membre **aucun Accès qu'il n'a pas déclaré**; MIMT refuse techniquement une telle demande.

5.2. Chaque demande à un Membre nomme les Accès demandés et la finalité de chacun, dans des termes clairs et simples,
conformes à la Finalité déclarée. Le Partenaire peut indiquer qu'un Accès est **requis** pour son service; il doit
alors pouvoir expliquer pourquoi, et la Personne reliée garde le droit de refuser ou de retirer cet Accès.

5.3. Le Partenaire utilise les Renseignements **uniquement pour les Finalités déclarées**. Toute nouvelle finalité ou
tout nouvel Accès exige une nouvelle acceptation de ces conditions (si la finalité n'était pas déclarée) puis une
nouvelle demande au Membre, que la Personne reliée approuve elle-même sur la page de consentement de MIMT.

5.4. Le Partenaire présente, avant d'envoyer un Membre vers la page de consentement de MIMT, les mêmes explications que
MIMT pour chaque Accès (texte fourni par `GET /v1/partner/consent-text`, avec sa version), sans les contredire ni les
minimiser, et sans pression ni avantage lié à l'acceptation d'un Accès non requis.

### 6. Aucune revente, aucune communication

Le Partenaire ne vend, ne loue, n'échange, ne cède ni ne communique les Renseignements à un tiers, et ne les utilise
pas pour de la publicité, du profilage ou l'entraînement d'un modèle d'intelligence artificielle. Seuls ses employés et
ses propres fournisseurs de services qui en ont besoin pour les Finalités déclarées y ont accès, sous des obligations
écrites au moins aussi strictes que celles-ci. Le Partenaire informe MIMT, sur demande, de la liste de ces
fournisseurs et des pays où les Renseignements sont conservés; tout transfert hors du Québec est précédé de
l'évaluation exigée par l'article 17 de la Loi 25.

### 7. Sécurité

Le Partenaire protège les Renseignements par des mesures raisonnables compte tenu de leur sensibilité, notamment :
clés d'API gardées dans un coffre de secrets et jamais dans un code source, un journal ou une adresse URL; rotation
d'une clé dès qu'elle a pu être exposée; vérification de la signature de chaque webhook et refus des signatures trop
anciennes; chiffrement en transit et au repos; contrôle des accès selon le besoin de savoir; journalisation des accès
internes; formation des personnes qui y ont accès. Les liens d'enregistrement de MIMT expirent après 15 minutes et ne
doivent pas être redistribués.

### 8. Secret professionnel

Quand les Personnes reliées sont des avocats ou d'autres professionnels tenus au secret professionnel, le Partenaire
s'abstient de toute écoute, analyse ou communication d'un enregistrement qui ne serait pas strictement nécessaire à la
Finalité déclarée, et respecte les règles de leur ordre professionnel. MIMT n'écoute pas les conversations.

### 9. Avis d'incident dans les 72 heures

9.1. Le Partenaire avise MIMT par écrit, au responsable de la protection des renseignements personnels de MIMT (le
président de GROUPE TAKATAK, à l'adresse que MIMT indique au Partenaire lors de l'acceptation), **dans les 72 heures**
après avoir pris connaissance d'un Incident, même si l'enquête n'est pas terminée, en précisant ce qu'il sait : nature,
Renseignements et personnes touchés, mesures prises. Il complète l'avis dès qu'il en sait davantage.

9.2. Le Partenaire tient le registre des incidents exigé par la Loi 25 et avise la Commission d'accès à l'information et
les personnes concernées lorsqu'il y a un risque de préjudice sérieux. Les parties collaborent pour réduire le
préjudice.

9.3. MIMT avise le Partenaire dans le même délai d'un Incident chez MIMT touchant les renseignements de ses appelants
(article 3).

### 10. Retrait d'un Accès, fin d'un lien et suppression

10.1. Une Personne reliée peut retirer un Accès ou tout le lien **en tout temps**, sans justification; le retrait prend
effet immédiatement dans MIMT Connect. MIMT en informe le Partenaire par webhook (`member.consent_updated` ou
`member.unlinked`).

10.2. Dès qu'un Accès est retiré ou qu'un lien prend fin (par la Personne reliée ou par le Partenaire), le Partenaire
cesse d'utiliser les Renseignements obtenus par cet Accès et les **supprime ou les rend anonymes dans les 30 jours**,
sauf ceux qu'une loi l'oblige à conserver, qu'il conserve alors seulement pour cette obligation et pour la durée
qu'elle exige. Sur demande de la Personne reliée ou de MIMT, il confirme la suppression par écrit.

10.3. À la fin de ces conditions, le Partenaire supprime de la même façon tous les Renseignements reçus par MIMT
Connect.

### 11. Droits des Personnes reliées

Le Partenaire respecte les droits des Personnes reliées : être informées, consentir à chaque Accès séparément, refuser
un Accès sans perdre l'usage de leur compte MIMT, retirer leur consentement en tout temps, accéder aux Renseignements que
le Partenaire détient sur elles, les faire rectifier, et porter plainte à la Commission d'accès à l'information. Il
répond à leurs demandes dans les 30 jours. Il indique dans sa politique de confidentialité qu'il reçoit des
Renseignements de MIMT, lesquels et pourquoi, et le nom de son responsable de la protection des renseignements
personnels. MIMT montre aux Personnes reliées le nom légal du Partenaire, ce contact, un reçu de chaque consentement et
le journal des accès du Partenaire à leurs données.

### 12. Vérifications

12.1. Le Partenaire tient à jour la preuve de son respect de ces conditions (registre des accès internes, liste des
fournisseurs, registre des incidents, preuves de suppression) et la remet à MIMT dans les 15 jours d'une demande écrite.

12.2. Une fois par année, ou après un Incident, MIMT peut faire vérifier ce respect par une personne indépendante tenue à
la confidentialité, avec un préavis de 30 jours, pendant les heures normales et sans nuire indûment aux activités du
Partenaire. Un rapport récent d'une vérification reconnue (par exemple SOC 2 de type II ou ISO/IEC 27001) couvrant les
mêmes points peut en tenir lieu. Chaque partie paie ses frais, sauf si la vérification révèle un manquement important,
auquel cas le Partenaire en paie le coût raisonnable.

12.3. MIMT journalise chaque accès du Partenaire aux données d'une Personne reliée (Accès utilisé, moment, route; jamais
le contenu) et garde ce journal 90 jours.

### 13. Suspension

MIMT peut suspendre immédiatement les clés d'API, les webhooks ou un Accès du Partenaire en cas de manquement à ces
conditions, d'Incident, de risque pour les Personnes reliées ou de demande d'une autorité, et l'en avise sans délai.

### 14. Responsabilité

Le Partenaire est responsable des Renseignements à partir du moment où il les reçoit et indemnise MIMT des réclamations
d'un tiers causées par son manquement à ces conditions ou à la loi. Rien dans ces conditions ne limite la
responsabilité d'une partie pour sa faute intentionnelle ou lourde, ni les droits des Personnes reliées.

### 15. Durée

Ces conditions s'appliquent dès l'enregistrement de leur acceptation et tant que le Partenaire utilise MIMT Connect.
Les articles 6, 8, 9, 10, 11, 12 et 14 survivent à leur fin tant que le Partenaire détient des Renseignements.

### 16. Modifications

MIMT peut modifier ces conditions avec un préavis écrit de 30 jours. La nouvelle version porte un nouveau numéro de
version; le Partenaire doit l'accepter avant de faire de nouvelles demandes d'Accès. Une modification ne donne jamais
au Partenaire un Accès que les Personnes reliées n'ont pas approuvé.

### 17. Lois applicables

Ces conditions sont régies par les lois du Québec et les lois du Canada qui s'y appliquent, dont la Loi 25 et la LPRPDE.
Les tribunaux du district judiciaire de Montréal sont compétents.

### Annexe A — Accès offerts (version de l'ensemble : 1)

| Accès | Ce que le Partenaire voit ou fait | Ce qu'il ne voit ni ne fait jamais |
| --- | --- | --- |
| `calls.read` | Les appels de ses groupes d'appel répondus par la Personne reliée et les appels lancés en son nom : numéros, heures, durées, crédits | Les autres appels, les textos, les messages vocaux personnels, les contacts |
| `calls.place` | Lancer un appel au nom de la Personne reliée : son application sonne d'abord, l'appel ne part que si elle répond, sa ligne sert d'afficheur | Appeler sans qu'elle réponde, le 9-1-1, un numéro surtaxé ou hors du Canada et des États-Unis, ses minutes de forfait |
| `line.manage` | La liste de ses numéros MIMT actifs et le choix de sa ligne pour le Partenaire | Acheter, transférer ou abandonner un numéro |
| `subscription.read` | Le forfait, son statut, la fin de la période, la capacité d'appeler | La carte, les montants, les factures; aucun achat en son nom |
| `porting.read` | Le numéro transféré, le statut et la date prévue | Le numéro de compte chez l'ancien fournisseur, le NIP, la signature, l'adresse, le nom |
| `availability.manage` | Régler sa disponibilité pour les groupes d'appel; voir son propre choix | Passer outre son propre choix dans MIMT |
| `recordings.read` | Les enregistrements des appels de ses groupes qu'elle répond, si le Partenaire enregistre, par liens de 15 minutes | Les autres enregistrements, les messages vocaux, les transcriptions |

Les textes exacts montrés aux personnes, en français et en anglais, sont dans `PARTNER_SCOPE_TEXT`
(`packages/shared/src/partnerScopes.ts`, version du texte `PARTNER_CONSENT_TEXT_VERSION`).

---

## English summary (convenience only; the French text governs)

Draft for lawyer review. Between Quadro Holdings Ltée (NEQ 1176760537, GROUPE TAKATAK), operator of MIMT, and the
partner whose acceptance MIMT records (`POST /v1/admin/partners/:id/terms-acceptance`: version, signature date, signer
name and title, legal name, privacy contact, declared purpose per scope).

- **Roles**: for calls to the partner's own numbers, MIMT is the partner's **service provider** (Law 25, s. 18.3); the
  partner stays responsible for its callers. Data from a linked person's MIMT account reaches the partner **only with
  that person's consent, scope by scope**, and the partner is then responsible for it.
- **Purposes limited to the declared ones**: a partner can only ask for scopes it declared (MIMT refuses others); every
  request names its scopes and a purpose for each; new purposes need new terms and a new consent; the portal shows the
  same explanations as MIMT (`GET /v1/partner/consent-text`) without pressure.
- **No resale** or disclosure, no advertising, profiling or AI training; processors bound in writing; Law 25 s. 17
  assessment before any transfer outside Québec.
- **Security**: keys in a secrets vault, rotation on exposure, webhook signature checks, encryption, need-to-know
  access, training. Professional secrecy of lawyers respected.
- **Breach notice to MIMT within 72 hours**, Law 25 incident register and notices to the CAI and the people concerned.
- **Withdrawal and deletion**: a scope or the whole link can be withdrawn at any time, effective at once; the partner
  then stops using and deletes (or anonymises) the data within 30 days, unless a law requires keeping it.
- **Rights of linked people**: informed, separate consent, refusal without losing their MIMT account, withdrawal,
  access, rectification, complaint to the CAI; answers within 30 days.
- **Audits**: evidence within 15 days; yearly independent audit with 30 days' notice (or a SOC 2 Type II / ISO 27001
  report); MIMT logs every partner access to a linked person's data (scope, time, route; never content) for 90 days.
- Suspension, liability, 30-day notice of changes (a new version must be accepted; it never widens existing grants),
  Québec law, Montréal courts.
