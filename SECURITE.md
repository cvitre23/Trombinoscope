# Audit de sécurité — Trombinoscope (V4.0)

Audit du dépôt `cvitre23/Tonbinoscope-V1.0`, branche `main`, commit `2fa5f47` (« V3.2 stable », 10/11/2026), puis corrections apportées en V3.3.

## 1. Version réellement publiée

| Commit | Version | Contenu |
|---|---|---|
| `606b8ed` | V1 (upload initial) | — |
| `76c71cb` | V3.1 | Deux boutons photo (appareil photo / photothèque), modification des fiches |
| `edcfb61` | V3.2 bêta | Clé d'accès (passkey) avec extension PRF |
| `2fa5f47` | **V3.2 stable — version en ligne** | Libellés et cache du service worker |

La V3.1 demandée existait déjà : la V3.3 part de la V3.2 stable et conserve tout ce qu'elle fait.

## 2. Fonctionnalités réellement implémentées en V3.2

| Fonction | État V3.2 | V3.3 |
|---|---|---|
| Créer / supprimer une classe | ✅ | ✅ |
| Renommer une classe | ❌ absent | ✅ ajouté |
| Ajouter un élève (prénom + photo) | ✅ | ✅ |
| Choisir / changer la classe d'un élève | ❌ (classe affichée seulement) | ✅ sélecteur « Classe » |
| Prendre une photo (`capture="environment"`) | ✅ | ✅ |
| Importer depuis la photothèque | ✅ | ✅ |
| Aperçu, remplacement, optimisation (carré JPEG) | ✅ 320 px | ✅ 400 px, q 0,82 |
| Retirer une photo | ❌ | ✅ |
| Grille de portraits | ✅ | ✅ (96 px) |
| Modifier / supprimer une fiche | ✅ | ✅ |
| Hors ligne (service worker) | ✅ | ✅ + mise à jour fiable |
| Purge annuelle au 1er août | ✅ | ✅ + bouton de simulation |
| Verrouillage arrière-plan / fermeture | ✅ | ✅ |
| Verrouillage après inactivité | ❌ | ✅ 5 min |
| Touch ID (passkey PRF) | ✅ si l'iPad le permet | ✅ inchangé |

## 3. Ce qui était déjà correct

- **Chiffrement effectif** : tout l'annuaire (classes, prénoms, photos en JPEG) est sérialisé puis chiffré en AES-GCM 256 bits. En base, il ne reste que `revision`, `year`, `salt`, `iv`, `cipher`. Vérifié automatiquement : aucun prénom, nom de classe ni en-tête JPEG lisible dans IndexedDB.
- **Clé jamais stockée en clair** : clé dérivée du mot de passe par PBKDF2-SHA-256 (600 000 itérations, sel aléatoire de 16 octets), non exportable, gardée en mémoire seulement pendant la session. L'année scolaire est liée au chiffré (données authentifiées AES-GCM).
- **Passkey traitée correctement** : la passkey n'est *pas* utilisée comme clé AES. Le secret PRF (32 octets) sert uniquement à *envelopper* la clé AES issue du mot de passe (`wrapKey`), avec un contexte authentifié (portée, année, identifiant). Le secret est effacé de la mémoire après usage. Si l'iPad ne fournit pas PRF, l'activation est refusée et le mot de passe reste le seul moyen.
- **Aucune transmission** : aucune requête réseau vers un serveur tiers ; la CSP `default-src 'self'` bloque les envois vers d'autres domaines ; affichage uniquement via `textContent` (pas d'injection HTML).
- **Métadonnées photo** : la ré-encodage via canvas supprime les données EXIF (GPS, appareil, date).

## 4. Failles et faiblesses corrigées en V3.3

1. **Pas de verrouillage après inactivité.** Un iPad posé ouvert restait déverrouillé indéfiniment. → Verrouillage automatique après 5 minutes sans toucher l'écran.
2. **Risque de perte de photo avec l'appareil photo.** Si iPadOS masque la page pendant la prise de vue, le verrouillage à l'arrière-plan pouvait effacer la photo en cours. → Tolérance limitée à une seule mise en arrière-plan de 2 minutes au plus, déclenchée uniquement par les boutons photo ; toute autre mise en arrière-plan verrouille.
3. **Mises à jour non garanties.** Le service worker de la V3.2 ne vérifiait pas activement les nouvelles versions et attendait la fermeture de toutes les fenêtres. → `update()` au démarrage, `skipWaiting`, `updateViaCache: 'none'`, message « Nouvelle version installée ».
4. **Stockage pouvant être évincé.** → Demande de stockage persistant (`navigator.storage.persist()`).
5. **Erreur de quota non expliquée.** → Message clair, rien n'est modifié.

Le format de l'enregistrement chiffré est **inchangé** : les données de test V3.2 s'ouvrent en V3.3 avec le même mot de passe (testé).

## 5. Limites connues (non corrigeables dans une PWA)

- **Purge annuelle** : elle s'exécute à la première ouverture après le 1er août. Une application jamais rouverte garde ses données (chiffrées) sur l'iPad. Elle se base sur l'horloge de l'iPad : la laisser en « Réglage automatique ».
- **Origine partagée GitHub Pages** : tous les sites `cvitre23.github.io/...` partagent la même origine. N'y publiez aucun autre projet contenant du code non maîtrisé : il pourrait lire ou effacer la base (même chiffrée). Idéalement, un compte GitHub ou un domaine dédié au trombinoscope.
- **Pas de limite de tentatives** : un mot de passe faible peut être deviné hors ligne si quelqu'un extrait la base. Exiger 12 caractères ou plus en production. Le chiffrement matériel de l'iPad (code obligatoire) reste la première protection.
- **Photothèque** : une photo *importée* reste dans Photos. Préférer « Prendre une photo », qui n'enregistre rien dans la photothèque.
- **Bouton « Effacer les données de test »** sur l'écran verrouillé : accessible sans mot de passe (choix volontaire, permet de repartir de zéro ; ne révèle rien).
- **Fichier vide `download`** à la racine du dépôt : sans effet, peut être supprimé.

## 6. Touch ID sur iPad 10e génération administré

- Techniquement possible : WebAuthn + extension PRF via le trousseau iCloud, sous iPadOS 18 ou plus récent (18.4+ recommandé, des bogues PRF y ont été corrigés).
- Le mot de passe reste obligatoire en secours. Touch ID ne remplace pas le mot de passe, il le rend inutile au quotidien.
- **À vérifier avec le service informatique** :
  - restriction MDM « Autoriser le trousseau iCloud » (`allowCloudKeychainSync`). Si elle est désactivée, les passkeys deviennent liées à l'appareil ; la prise en charge de PRF dans ce cas n'est pas documentée : c'est le test n° 9 qui tranchera ;
  - compte Apple utilisé (personnel ou géré). Avec un compte synchronisé, la passkey peut se retrouver sur d'autres appareils du compte ; elle n'y ouvre rien sans la base locale, mais l'établissement doit l'accepter ;
  - iPad partagé (Shared iPad) : non adapté, les données locales sont liées à la session.
- Si l'activation échoue, l'application l'indique et continue avec le mot de passe.

## 7. Changements de la V4.0 (production)

- Étiquette et bandeau « démonstration / données fictives » retirés ; nom de l'application : « Trombinoscope ».
- Création d'un trombinoscope **vide** (plus de classes ni d'élèves d'exemple).
- Mot de passe de **12 caractères minimum**, saisi **deux fois** à la création (une faute de frappe rendrait les données définitivement illisibles). Les trombinoscopes existants s'ouvrent avec leur ancien mot de passe.
- Zone de test et bouton « Simuler le 1er août » supprimés ; l'information sur le verrouillage et la date de purge reste affichée.
- Le bouton « Effacer toutes les données » (écran verrouillé) demande une confirmation explicite : il sert si le mot de passe est oublié.
- Filigrane « CONFIDENTIEL » sur les photos (V3.4 et V3.5).
- Le format de stockage chiffré est inchangé : une mise à jour depuis la V3.5 conserve les données. L'identifiant interne de la base conserve son ancien nom (`trombinoscope-demo:…`) pour cette raison ; il n'est pas visible.

## 8. Avant de saisir de vrais élèves

1. Accord écrit du chef d'établissement et avis de la personne de référence en protection des données (LPrD, canton de Vaud) : **obtenus** selon le déclarant.
2. Si l'iPad contient déjà un trombinoscope de test : écran verrouillé → « Effacer toutes les données », puis créer le trombinoscope de production avec un mot de passe de 12 caractères ou plus.
3. Information des familles et, si l'établissement l'exige, accord pour la photographie.
4. Restriction de captures d'écran par la gestion des iPad (MDM) : à demander au service informatique si l'établissement le souhaite (non faisable depuis l'application).
