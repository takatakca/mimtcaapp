# Contrat d'agent affilié MIMT / MIMT affiliate agent agreement

> **Brouillon — à faire réviser par un avocat avant usage.**
> Draft — to be reviewed by a lawyer before use. This is not legal advice.

Notes for MIMT (not part of the contract):

- The French version is the authoritative version and is presented **first** (Charter of the French language, s. 55, contracts of adhesion). The English translation is given only for convenience, after the French one, when the affiliate expressly asks for it.
- The five `{{placeholders}}` are filled by the API (`apps/api/src/services/affiliates.ts`, `fillContract`) and are the **text tab labels of the DocuSign template**: `affiliate_legal_name`, `commission_pct`, `duration_months`, `payout_threshold`, `effective_date`. The template must use exactly those labels.
- The text between the `contract:fr` and `contract:en` markers is copied word for word into `apps/api/src/affiliates/contractTemplate.ts` (a test checks they are identical). Edit both together.
- `[Raison sociale de l'exploitant de MIMT — à confirmer]` / `[Legal name of MIMT's operator — to be confirmed]` stays until the owner confirms the legal entity, its address and its Quebec enterprise number (NEQ).

<!-- contract:fr:start -->
CONTRAT D'AGENT AFFILIÉ MIMT

Brouillon — à faire réviser par un avocat avant usage.

ENTRE : [Raison sociale de l'exploitant de MIMT — à confirmer], membre de GROUPE TAKATAK, qui exploite le service MIMT (« MIMT »), Montréal (Québec);

ET : {{affiliate_legal_name}} (l'« Affilié »).

Date d'entrée en vigueur : {{effective_date}}.

1. OBJET
MIMT autorise l'Affilié à faire connaître les services MIMT au moyen d'un lien et d'un code personnels (le « Lien »). En échange, MIMT verse à l'Affilié une commission sur les revenus nets des clients qu'il lui amène, selon les conditions du présent contrat.

2. TRAVAILLEUR AUTONOME
L'Affilié agit à titre d'entrepreneur indépendant. Rien dans ce contrat ne crée un emploi, une société, une coentreprise, un mandat de représentation ni une franchise. L'Affilié ne peut pas conclure de contrat, faire de promesse ni accepter de paiement au nom de MIMT. Il choisit ses moyens et ses heures et assume ses propres frais.

3. CLIENT ADMISSIBLE
3.1 Un « Client admissible » est une personne ou une entreprise qui n'avait jamais payé de forfait MIMT, qui ouvre un compte MIMT après avoir utilisé le Lien de l'Affilié, et dont la première facture payée survient dans les 60 jours suivant sa première utilisation du Lien.
3.2 Premier contact : si un client a utilisé plusieurs liens d'affiliés, seul le premier lien enregistré par les serveurs de MIMT compte. Les registres de MIMT font foi, sauf erreur démontrée.
3.3 Ne sont pas admissibles : l'Affilié lui-même, ses comptes, toute personne qui agit pour lui ou à sa demande, et tout compte qui utilise le même moyen de paiement que l'Affilié (aucune autorecommandation).

4. COMMISSION
4.1 Taux : {{commission_pct}} % des revenus nets encaissés par MIMT pour chaque Client admissible.
4.2 Durée : la commission s'applique aux factures payées pendant {{duration_months}} mois à compter de la première facture payée du Client admissible. Aucune commission n'est due ensuite.
4.3 Revenus nets : les sommes réellement encaissées par MIMT sur les factures d'abonnement payées par la facturation Web de MIMT (paiement par carte), moins la TPS, la TVQ, la taxe municipale 9-1-1 et toute autre taxe, ainsi que les remboursements, rétrofacturations, crédits et rabais. Les achats ponctuels (par exemple les blocs de minutes et le crédit international) et les achats faits dans l'App Store d'Apple ou sur Google Play ne donnent pas droit à une commission tant que MIMT n'en avise pas l'Affilié par écrit.
4.4 Calcul : la commission de chaque facture est arrondie au cent inférieur. MIMT tient un registre des commissions que l'Affilié peut consulter dans l'application MIMT.

5. PAIEMENT
5.1 Période de rétention : chaque commission devient payable 30 jours après le paiement de la facture, pour couvrir les remboursements et les rétrofacturations.
5.2 Seuil : MIMT paie le solde payable une fois par mois lorsqu'il atteint au moins {{payout_threshold}} $. Un solde inférieur est reporté au mois suivant.
5.3 Mode : virement bancaire ou virement Interac au nom de l'Affilié, au plus tard le 15e jour du mois qui suit celui où le seuil est atteint. Les montants sont en dollars canadiens.
5.4 Facture : si l'Affilié est inscrit aux fichiers de la TPS et de la TVQ, il remet à MIMT une facture conforme et MIMT ajoute ces taxes au paiement.
5.5 Pendant une suspension (article 11), les paiements sont retenus jusqu'à la fin de l'examen.

6. RÉCUPÉRATION DES COMMISSIONS
La commission liée à une facture remboursée, rétrofacturée ou annulée pour fraude est annulée en proportion. Si elle a déjà été payée, MIMT la déduit des paiements suivants. En cas de fraude, MIMT peut aussi réclamer le remboursement des sommes versées.

7. PRATIQUES INTERDITES
L'Affilié s'engage à ne pas :
a) envoyer un message électronique commercial (courriel, texto, message direct) sans le consentement du destinataire ou sans les mentions exigées par la Loi canadienne anti-pourriel (identification de l'expéditeur et moyen de désabonnement gratuit traité dans les 10 jours ouvrables);
b) faire une affirmation fausse ou trompeuse sur MIMT, ses prix, ses limites ou le 9-1-1 (Loi sur la concurrence, Loi sur la protection du consommateur du Québec), notamment promettre des appels « illimités », un prix ou une offre que MIMT n'a pas publiés, ou laisser croire qu'il est MIMT ou un employé de MIMT;
c) acheter des annonces de moteur de recherche ou de réseau social sur les marques MIMT ou GROUPE TAKATAK ou leurs variantes, ni enregistrer un nom de domaine, un compte ou une page qui les contient;
d) offrir ou verser une récompense, un rabais ou une part de sa commission en échange d'un avis, d'une note, d'un « J'aime » ou d'un abonnement, ni publier de faux avis;
e) forcer l'enregistrement du Lien sans action réelle du client (témoins imposés, redirections cachées, logiciels publicitaires);
f) promouvoir MIMT dans un contenu illégal, haineux, violent, sexuellement explicite ou destiné aux personnes mineures;
g) se recommander lui-même ou créer des comptes pour toucher des commissions.

8. DIVULGATION OBLIGATOIRE
Dans chaque contenu qui fait la promotion de MIMT, l'Affilié indique clairement, avant le Lien et dans la langue du contenu, qu'il reçoit une commission (par exemple : « Lien affilié : je reçois une commission si vous vous abonnez » ou « #partenariatpayé »). La mention doit être visible sans clic, lisible et ne pas être noyée dans d'autres mots-clics, conformément à la Loi sur la concurrence et aux lignes directrices du Bureau de la concurrence sur le marketing d'influence.

9. RENSEIGNEMENTS PERSONNELS
9.1 L'Affilié n'a pas besoin de recueillir les renseignements personnels des clients : le client s'inscrit lui-même chez MIMT. MIMT ne communique à l'Affilié que des totaux (nombre d'inscriptions, de clients payants et montants de commission), jamais l'identité des clients.
9.2 Si l'Affilié recueille tout de même des renseignements personnels (par exemple une liste d'envoi), il en est seul responsable et respecte la Loi sur la protection des renseignements personnels dans le secteur privé (Loi 25) et la LPRPDE : consentement, finalité, sécurité, et aucune communication à MIMT sans consentement.
9.3 MIMT traite les renseignements de l'Affilié selon sa politique de confidentialité, seulement pour gérer ce contrat, les paiements et les obligations fiscales.

10. TAXES ET DÉCLARATIONS
10.1 L'Affilié est seul responsable de ses impôts et cotisations, et de s'inscrire aux fichiers de la TPS et de la TVQ lorsque la loi l'exige (notamment au-delà du seuil de petit fournisseur). Il fournit ses numéros de TPS et de TVQ s'il est inscrit.
10.2 MIMT peut devoir déclarer les sommes versées aux autorités fiscales (par exemple un feuillet T4A) et demander à l'Affilié les renseignements nécessaires, dont son numéro d'assurance sociale ou d'entreprise, au moment du premier paiement. Aucune somme n'est retenue à la source, sauf si la loi l'exige.

11. SUSPENSION ET FIN DU CONTRAT
11.1 Durée : le contrat commence à la date d'entrée en vigueur et dure jusqu'à ce qu'une partie y mette fin.
11.2 Chaque partie peut y mettre fin en tout temps par un avis écrit de 30 jours.
11.3 MIMT peut suspendre le Lien ou mettre fin au contrat immédiatement, par avis écrit, si l'Affilié manque aux articles 7, 8 ou 9, commet une fraude ou nuit à la réputation de MIMT.
11.4 À la fin du contrat, le Lien cesse de fonctionner. Les commissions sur les factures payées avant la fin restent dues selon les articles 5 et 6, même sous le seuil, sauf en cas de fraude ou de manquement aux articles 7 ou 8.

12. MARQUES
MIMT accorde à l'Affilié une licence non exclusive, révocable et gratuite d'utiliser le nom et le logo MIMT, seulement pour promouvoir MIMT et selon les consignes de marque de MIMT. Cette licence prend fin avec le contrat.

13. CONFIDENTIALITÉ
L'Affilié garde confidentielles les informations non publiques reçues de MIMT (conditions particulières, chiffres, plans), pendant le contrat et deux ans après sa fin.

14. MODIFICATIONS
MIMT peut modifier les conditions de commission pour l'avenir par un avis écrit d'au moins 30 jours. Les factures payées avant la date du changement suivent les anciennes conditions. L'Affilié qui refuse un changement peut mettre fin au contrat sans pénalité.

15. RESPONSABILITÉ
Chaque partie répond de ses propres actes. L'Affilié indemnise MIMT des réclamations causées par ses publicités ou par un manquement aux articles 7, 8 ou 9. Sauf faute intentionnelle ou lourde, la responsabilité de MIMT envers l'Affilié est limitée aux commissions dues.

16. DROIT APPLICABLE
Le présent contrat est régi par les lois du Québec et les lois du Canada qui s'y appliquent. Les tribunaux du district judiciaire de Montréal sont compétents, sous réserve des droits que la loi accorde à l'Affilié.

17. LANGUE
La version française du présent contrat a été remise à l'Affilié en premier. Une traduction anglaise peut lui être remise à sa demande expresse; en cas de divergence, la version française prévaut.

18. SIGNATURE ÉLECTRONIQUE
Les parties acceptent de signer ce contrat par voie électronique. La signature électronique a la même valeur qu'une signature manuscrite (Loi concernant le cadre juridique des technologies de l'information).

Signé par l'Affilié : {{affiliate_legal_name}}
Pour MIMT : ______________________
<!-- contract:fr:end -->

## English translation (for convenience; the French version prevails)

<!-- contract:en:start -->
MIMT AFFILIATE AGENT AGREEMENT (English translation; the French version prevails)

Draft — to be reviewed by a lawyer before use.

BETWEEN: [Legal name of MIMT's operator — to be confirmed], a member of GROUPE TAKATAK, which operates the MIMT service ("MIMT"), Montréal, Québec;

AND: {{affiliate_legal_name}} (the "Affiliate").

Effective date: {{effective_date}}.

1. PURPOSE
MIMT authorizes the Affiliate to promote MIMT services with a personal link and code (the "Link"). In return, MIMT pays the Affiliate a commission on the net revenue of the customers the Affiliate brings, on the terms of this agreement.

2. INDEPENDENT CONTRACTOR
The Affiliate acts as an independent contractor. Nothing in this agreement creates employment, a partnership, a joint venture, an agency or a franchise. The Affiliate may not enter into contracts, make promises or accept payments on MIMT's behalf. The Affiliate chooses their own means and hours and bears their own costs.

3. ELIGIBLE CUSTOMER
3.1 An "Eligible Customer" is a person or business that had never paid for a MIMT plan, opens a MIMT account after using the Affiliate's Link, and whose first paid invoice occurs within 60 days of first using the Link.
3.2 First touch: if a customer used several affiliate links, only the first link recorded by MIMT's servers counts. MIMT's records prevail, unless an error is shown.
3.3 Not eligible: the Affiliate, the Affiliate's own accounts, anyone acting for the Affiliate or at their request, and any account that uses the same payment method as the Affiliate (no self-referral).

4. COMMISSION
4.1 Rate: {{commission_pct}}% of the net revenue MIMT collects from each Eligible Customer.
4.2 Duration: the commission applies to invoices paid during {{duration_months}} months from the Eligible Customer's first paid invoice. No commission is due after that.
4.3 Net revenue: amounts actually collected by MIMT on subscription invoices paid through MIMT web billing (card payments), less GST, QST, the 9-1-1 municipal tax and any other tax, and less refunds, chargebacks, credits and discounts. One-time purchases (for example minute packs and international credit) and purchases made in Apple's App Store or on Google Play do not earn a commission until MIMT tells the Affiliate otherwise in writing.
4.4 Calculation: the commission on each invoice is rounded down to the cent. MIMT keeps a commission ledger the Affiliate can see in the MIMT app.

5. PAYMENT
5.1 Hold period: each commission becomes payable 30 days after the invoice is paid, to cover refunds and chargebacks.
5.2 Threshold: MIMT pays the payable balance once a month when it reaches at least ${{payout_threshold}}. A smaller balance carries over to the next month.
5.3 Method: bank transfer or Interac e-Transfer in the Affiliate's name, no later than the 15th day of the month after the threshold is reached. Amounts are in Canadian dollars.
5.4 Invoice: if the Affiliate is registered for GST and QST, the Affiliate sends MIMT a compliant invoice and MIMT adds those taxes to the payment.
5.5 During a suspension (section 11), payments are withheld until the review ends.

6. CLAWBACKS
The commission on an invoice that is refunded, charged back or cancelled for fraud is cancelled in proportion. If it was already paid, MIMT deducts it from later payments. In case of fraud, MIMT may also claim back amounts paid.

7. PROHIBITED PRACTICES
The Affiliate agrees not to:
a) send a commercial electronic message (email, text, direct message) without the recipient's consent or without the information required by Canada's Anti-Spam Legislation (sender identification and a free unsubscribe mechanism honoured within 10 business days);
b) make a false or misleading claim about MIMT, its prices, its limits or 9-1-1 (Competition Act, Québec Consumer Protection Act), including promising "unlimited" calling, a price or an offer MIMT has not published, or suggesting they are MIMT or a MIMT employee;
c) buy search-engine or social-media ads on the MIMT or GROUPE TAKATAK trademarks or their variants, or register a domain name, account or page that contains them;
d) offer or pay a reward, a discount or part of their commission in exchange for a review, a rating, a "like" or a follow, or post fake reviews;
e) force the Link to be recorded without a real customer action (cookie stuffing, hidden redirects, adware);
f) promote MIMT in content that is illegal, hateful, violent, sexually explicit or aimed at minors;
g) refer themselves or create accounts to earn commissions.

8. MANDATORY DISCLOSURE
In every piece of content promoting MIMT, the Affiliate clearly states, before the Link and in the language of the content, that they earn a commission (for example: "Affiliate link: I earn a commission if you subscribe" or "#paidpartnership"). The disclosure must be visible without a click, legible and not buried among other hashtags, in line with the Competition Act and the Competition Bureau's guidance on influencer marketing.

9. PERSONAL INFORMATION
9.1 The Affiliate does not need to collect customers' personal information: customers sign up with MIMT themselves. MIMT only shares totals with the Affiliate (number of sign-ups, paying customers and commission amounts), never customers' identities.
9.2 If the Affiliate still collects personal information (for example a mailing list), the Affiliate alone is responsible for it and complies with Québec's Act respecting the protection of personal information in the private sector (Law 25) and PIPEDA: consent, purpose, security, and no disclosure to MIMT without consent.
9.3 MIMT processes the Affiliate's information under its privacy policy, only to manage this agreement, payments and tax obligations.

10. TAXES AND REPORTING
10.1 The Affiliate alone is responsible for their income taxes and contributions, and for registering for GST and QST when the law requires it (including above the small-supplier threshold). The Affiliate provides their GST and QST numbers if registered.
10.2 MIMT may have to report amounts paid to tax authorities (for example on a T4A slip) and may ask the Affiliate for the required information, including their social insurance or business number, at the first payment. Nothing is withheld at source unless the law requires it.

11. SUSPENSION AND TERMINATION
11.1 Term: the agreement starts on the effective date and lasts until a party ends it.
11.2 Either party may end it at any time with 30 days' written notice.
11.3 MIMT may suspend the Link or end the agreement immediately, by written notice, if the Affiliate breaches sections 7, 8 or 9, commits fraud or harms MIMT's reputation.
11.4 When the agreement ends, the Link stops working. Commissions on invoices paid before the end remain due under sections 5 and 6, even below the threshold, except in case of fraud or a breach of sections 7 or 8.

12. TRADEMARKS
MIMT grants the Affiliate a non-exclusive, revocable, royalty-free licence to use the MIMT name and logo, only to promote MIMT and following MIMT's brand guidelines. This licence ends with the agreement.

13. CONFIDENTIALITY
The Affiliate keeps confidential the non-public information received from MIMT (special terms, figures, plans), during the agreement and for two years after it ends.

14. CHANGES
MIMT may change the commission terms for the future with at least 30 days' written notice. Invoices paid before the change follow the previous terms. An Affiliate who refuses a change may end the agreement without penalty.

15. LIABILITY
Each party is responsible for its own acts. The Affiliate indemnifies MIMT against claims caused by the Affiliate's promotions or by a breach of sections 7, 8 or 9. Except for intentional or gross fault, MIMT's liability to the Affiliate is limited to the commissions due.

16. GOVERNING LAW
This agreement is governed by the laws of Québec and the federal laws of Canada that apply. The courts of the judicial district of Montréal have jurisdiction, subject to the Affiliate's rights under the law.

17. LANGUAGE
The French version of this agreement was given to the Affiliate first. An English translation may be given at the Affiliate's express request; if they differ, the French version prevails.

18. ELECTRONIC SIGNATURE
The parties agree to sign this agreement electronically. An electronic signature has the same value as a handwritten signature (Québec Act to establish a legal framework for information technology).

Signed by the Affiliate: {{affiliate_legal_name}}
For MIMT: ______________________
<!-- contract:en:end -->
