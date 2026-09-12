# Release signing (Outfit / com.outfit.app)

Debug builds work out of the box (`./gradlew assembleDebug`) — Android signs them
automatically with a shared, insecure debug key, which is fine for testing but
**cannot** be uploaded to Google Play.

To produce a signed release APK/AAB, no code changes are needed here — `android/app/build.gradle`
already reads a `release` signing config *if* the following four Gradle properties are present:

- `RELEASE_STORE_FILE` — path to your `.jks`/`.keystore` file
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS`
- `RELEASE_KEY_PASSWORD`

If they are absent, the `release` block simply skips `signingConfig` and Gradle still
produces an unsigned release artifact (useful for internal testing of R8/shrinking without
ever touching real credentials).

## Doing this on Codemagic (recommended)

1. Generate a keystore once (locally, **never commit it**):
   ```
   keytool -genkeypair -v -keystore outfit-release.jks -alias outfit -keyalg RSA -keysize 2048 -validity 10000
   ```
2. In the Codemagic app settings, open **Distribution → Android code signing**, upload
   `outfit-release.jks` as a Secure file, and fill in the store/key passwords and alias there.
   Codemagic will expose them at build time as `CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`,
   `CM_KEY_ALIAS`, `CM_KEY_PASSWORD` — this is exactly what `codemagic.yaml`'s
   "Build release AAB + APK" step already expects.
3. Nothing else to do — the same `codemagic.yaml` will now also produce
   `android/app/build/outputs/bundle/release/app-release.aab` and
   `.../apk/release/app-release.apk` as build artifacts.

## Doing this locally / on another CI

Pass the same four values as `-P` Gradle properties (never hardcode them in `build.gradle`
or `gradle.properties`, and never commit the keystore file itself):

```
cd android
./gradlew bundleRelease \
  -PRELEASE_STORE_FILE=/absolute/path/to/outfit-release.jks \
  -PRELEASE_STORE_PASSWORD=*** \
  -PRELEASE_KEY_ALIAS=outfit \
  -PRELEASE_KEY_PASSWORD=***
```

## Google Play

Once you have a signed `.aab`, create an app listing in the Google Play Console with
application ID `com.outfit.app`, upload the AAB to an internal testing track first, and
promote from there. Play requires `versionCode` to strictly increase on every upload —
bump it in `android/app/build.gradle` (`defaultConfig.versionCode`) before each release.
