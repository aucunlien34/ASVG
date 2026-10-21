// Réglages natifs ajoutés après « npx cap add » (projets android/ et ios/ régénérables) :
//  - association des fichiers .vbcs (sauvegardes et partages VolleyCoach) : « Ouvrir avec VolleyCoach »
//  - Android : ouverture aussi des .json, orientation libre (gérée par l'appli), pas de sauvegarde cloud imprévue
// Idempotent : peut être relancé sans dupliquer les entrées.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UTI = 'fr.volleycoach.vbcs';
let done = 0;

// ---------- Android ----------
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(MANIFEST)) {
  let m = readFileSync(MANIFEST, 'utf8');
  if (!m.includes('<!-- VolleyCoach: fichiers .vbcs -->')) {
    const filters = `
            <!-- VolleyCoach: fichiers .vbcs -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/json" />
                <data android:mimeType="application/x-vbcs" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="file" />
                <data android:scheme="content" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
                <data android:pathPattern=".*\\\\.vbcs" />
                <data android:pathPattern=".*\\\\..*\\\\.vbcs" />
                <data android:pathPattern=".*\\\\..*\\\\..*\\\\.vbcs" />
            </intent-filter>`;
    // dans l'activité principale, juste avant sa fermeture
    m = m.replace(/(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?)(\n\s*<\/activity>)/, (_, a, b) => a + filters + b);
    if (!m.includes('VolleyCoach: fichiers .vbcs')) throw new Error('MainActivity introuvable dans AndroidManifest.xml');
    // singleTask : un fichier ouvert pendant que l'appli tourne arrive dans la même instance (événement appUrlOpen)
    if (!/android:launchMode=/.test(m)) m = m.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:launchMode="singleTask"');
    writeFileSync(MANIFEST, m);
  }
  console.log('Android : association .vbcs OK');
  done++;
}

// ---------- iOS ----------
const PLIST = 'ios/App/App/Info.plist';
if (existsSync(PLIST)) {
  let p = readFileSync(PLIST, 'utf8');
  if (!p.includes(UTI)) {
    const add = `
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>Données VolleyCoach</string>
			<key>CFBundleTypeRole</key>
			<string>Editor</string>
			<key>LSHandlerRank</key>
			<string>Owner</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>${UTI}</string>
			</array>
		</dict>
		<dict>
			<key>CFBundleTypeName</key>
			<string>JSON</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.json</string>
			</array>
		</dict>
	</array>
	<key>UTExportedTypeDeclarations</key>
	<array>
		<dict>
			<key>UTTypeIdentifier</key>
			<string>${UTI}</string>
			<key>UTTypeDescription</key>
			<string>Données VolleyCoach</string>
			<key>UTTypeConformsTo</key>
			<array>
				<string>public.json</string>
				<string>public.data</string>
			</array>
			<key>UTTypeTagSpecification</key>
			<dict>
				<key>public.filename-extension</key>
				<array>
					<string>vbcs</string>
				</array>
				<key>public.mime-type</key>
				<array>
					<string>application/x-vbcs</string>
				</array>
			</dict>
		</dict>
	</array>
	<key>LSSupportsOpeningDocumentsInPlace</key>
	<false/>`;
    const i = p.lastIndexOf('</dict>');
    p = p.slice(0, i) + add.trimStart().replace(/^/, '') + '\n' + p.slice(i);
    writeFileSync(PLIST, p);
  }
  console.log('iOS : association .vbcs OK');
  done++;
}

if (!done) console.log('Aucun projet natif trouvé (lancer d’abord « npx cap add android » / « npx cap add ios »)');
