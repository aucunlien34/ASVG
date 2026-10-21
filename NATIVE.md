# VolleyCoach — applis natives (Capacitor 8)

La webapp (index.html) reste la source unique : GitHub Pages sert la version web de test,
Capacitor l'embarque telle quelle dans les applis iOS et Android.

## Ce qui est déjà prêt (V150)
| Sujet | Web | Appli native |
|---|---|---|
| Sauvegarde | localStorage | localStorage **+ copie Preferences** (restaurée si iOS vide la WebView) |
| Fichiers .vbcs | Partager › VolleyCoach (service worker, Android) | « Ouvrir avec VolleyCoach » (iOS et Android), événement `appUrlOpen` |
| Exports | téléchargement / partage web | Filesystem + Share |
| Pro | codes d'activation | **achats intégrés RevenueCat** (mensuel + pass saison), « Restaurer mes achats » ; codes : Android oui, iOS non (`IAP_CFG.codes`) |
| Écran / rotation / retour | Wake Lock, Screen Orientation | KeepAwake, ScreenOrientation, bouton retour Android |
| Mises à jour | version.json + sw.js | par les stores (vérification désactivée) |

## Compiler
- **Automatique** : à chaque push de index.html, GitHub Actions (onglet *Actions › Applis natives*) produit
  un APK Android de test (*Artifacts*). Lancement manuel (*Run workflow*) : Android + contrôle iOS simulateur.
- **Local** : `npm ci && npm run native:add && npm run native:icons && npm run android` (ou `npm run ios` sur Mac).

Les dossiers `android/` et `ios/` sont régénérés (non versionnés) ; `scripts/native-patch.mjs` y ajoute
l'association .vbcs. Les versionner dès qu'on personnalise Xcode / Android Studio (signature, capacités).

## À compléter avant les stores
1. `capacitor.config.json` → `appId` définitif (`fr.volleycoach.app` proposé ; non modifiable après publication).
2. RevenueCat : projet, apps iOS/Android, droit `pro`, offre courante avec forfaits `$rc_monthly` et `saison` ;
   coller les clés publiques dans `IAP_CFG.keys` (index.html).
3. App Store Connect / Play Console : produits (abonnement mensuel auto-renouvelable, pass saison non renouvelable).
4. Signature : certificat et profil Apple, keystore Android (secrets GitHub) → builds de publication.
5. Fiches stores : textes, captures, politique de confidentialité en ligne, mentions éditeur (« [À REMPLIR] »).
