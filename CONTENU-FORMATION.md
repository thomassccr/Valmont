# Page « Accompagnement » — ce qu'il me faut de toi

La page est en ligne à l'adresse **/formation** (`site/formation.html`).
Elle est complète et fonctionnelle : design, animations, formulaire de candidature.
Il ne manque plus que **ton** contenu à la place des textes d'exemple.

Tout ce qui est à remplacer est marqué dans le fichier par un commentaire :

```html
<!-- [À REMPLIR] ... -->
```

---

## 1. À faire une fois, pour recevoir les candidatures

1. Ouvre [supabase.com](https://supabase.com) → ton projet → **SQL Editor**
2. Colle le contenu de `supabase-formation-schema.sql` → **Run**
3. C'est tout. Les candidatures arrivent dans **Table Editor → `formation_candidatures`**

Sécurité : le site peut seulement **ajouter** une candidature, jamais en lire.
Personne ne peut récupérer tes candidatures depuis le navigateur.

**Ton email** : remplace `contact@valmontfx.com` dans `site/formation.html`
(bloc `CONFIG`, tout en bas du fichier). Il sert de secours si Supabase est injoignable.

**Optionnel — être prévenu par email** : Supabase → *Database → Webhooks*,
sur `INSERT` de la table, vers Zapier / Make / Resend.

---

## 2. Les textes à m'envoyer

Envoie-moi simplement ces éléments (un message, un doc Word, un vocal — comme tu veux) :

| # | Élément | Ce que j'attends |
|---|---|---|
| 1 | **Accroche** | Le titre du haut de page (actuellement « Arrête de trader seul. Je t'accompagne. ») + 2 phrases de promesse |
| 2 | **Tes chiffres** | Nombre de traders accompagnés, durée du programme, nombre de places par promotion |
| 3 | **Le constat** | Les 3 problèmes que vivent tes élèves avant de venir te voir |
| 4 | **Ta méthode** | Tes 4 piliers, dans ton ordre, avec 2 lignes chacun |
| 5 | **Le programme** | Tes modules : titre, durée (semaine X), un paragraphe, 3 à 5 points |
| 6 | **Ce qui est inclus** | Ce que tu livres vraiment (appels, messages, supports, groupe…) |
| 7 | **Tes formats** | Nom, pour qui, prix (ou « sur devis »), ce qui est compris |
| 8 | **Pour qui / pas pour qui** | 5 critères de chaque côté |
| 9 | **Ta bio** | Ton parcours en 3 paragraphes + comment tu veux signer |
| 10 | **Tes témoignages** | Prénom + initiale, une phrase de l'élève, son contexte (ex. « FTMO 50k validé ») |
| 11 | **Ta FAQ** | Les questions qu'on te pose vraiment avant d'acheter |

> Les textes actuellement en place sont **crédibles mais inventés**.
> Les témoignages et les chiffres doivent impérativement être remplacés par des vrais
> avant de diffuser la page — c'est aussi une obligation légale.

---

## 3. Les fichiers à déposer

Tout va dans le dossier **`site/formation/`**.

| Fichier | Format conseillé | Utilisé pour |
|---|---|---|
| `ftmo-challenge.jpg` | la page A4 entière | Certificat « Passed FTMO Challenge » — 26 mai 2026 |
| `ftmo-verification.jpg` | la page A4 entière | Certificat « Passed Verification » — 5 juin 2026 |
| `ftmo-payout.jpg` | la page A4 entière | Certificat « Reward » — 24 juin 2026 |
| `trade-us100.jpg` | capture telle quelle | Le trade US100 dans la section preuves |
| `setup.jpg` | photo verticale | Ton poste de trading |
| `coach.jpg` | portrait vertical, 800 × 1000 px | Ta photo dans la section « Qui t'accompagne » |

Les cinq premiers alimentent la section **Les preuves** (juste sous le hero), avec
agrandissement au clic. Ce sont les images que tu m'as envoyées en conversation —
je les ai vues, mais elles ne sont pas arrivées sous forme de fichiers, donc je n'ai
pas pu les déposer moi-même.

**Le plus simple pour les ajouter** : sur GitHub, va dans `site/formation/` sur la
branche `claude/custom-training-website-kq7v02` → *Add file → Upload files* →
glisse les 6 images en respectant exactement ces noms → *Commit*.
Ou dépose-les dans le dossier et dis-le-moi, je m'occupe du commit.

Tant qu'un fichier n'est pas là, la page affiche un cadre discret
« Image à ajouter » — jamais une image cassée.

**Tu veux ajouter d'autres visuels ?** (captures de résultats, screens de ton Discord,
extraits de tes appels, photos d'élèves…) Envoie-les, je les intègre dans la mise en page.

**Une vidéo de présentation ?** Envoie un `.mp4` ou `.webm` (≤ 20 Mo idéalement) :
je reprends le lecteur avec bouton play de la page d'accueil.

---

## 4. Le formulaire de candidature

Champs actuellement demandés :

- Prénom *, Nom, Email *, Téléphone / WhatsApp, Instagram / Discord / Telegram
- Depuis combien de temps tu trades *
- Ce que tu trades *
- Situation de compte * (démo, perso, challenge, financé)
- Temps disponible par semaine *
- Objectif sur 6 mois * (texte libre)
- Ce qui te bloque le plus * (texte libre)
- Format visé, Comment tu m'as connu
- Case de consentement * (RGPD + risque de perte en capital)

`*` = obligatoire.

Dis-moi si tu veux **ajouter, retirer ou reformuler** des questions —
c'est cinq minutes de modification, et la table Supabase suit.

Protections déjà en place : champ piège anti-robots, validation de chaque champ,
limite de taille des réponses, et repli par email si la base est injoignable.

---

## 5. Mise en ligne

La page est déployée avec le reste du site (dossier `site/`, config Vercel existante).
Une fois la branche fusionnée, elle est accessible sur **valmontfx.vercel.app/formation**,
et un lien « Accompagnement » apparaît dans le pied de page de la page d'accueil.

Pour un test en local :

```bash
cd site && python3 -m http.server 8000
# puis ouvre http://localhost:8000/formation.html
```

---

## 6. Point légal à ne pas négliger

La page contient déjà un avertissement sur le risque de perte en capital et précise
que l'accompagnement est **pédagogique** (ni conseil en investissement, ni gestion de
portefeuille). Garde-le : c'est ce qui distingue une prestation de formation d'une
activité réglementée.

Si tu vends la prestation, il te faudra aussi des **CGV** (droit de rétractation,
modalités de paiement, obligations de chaque partie). Dis-le-moi, je te prépare la page.
