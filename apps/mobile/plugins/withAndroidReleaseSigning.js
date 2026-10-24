// Expo config plugin: signs Android release builds with the Google Play *upload* key when it is provided.
//
// The key never lives in the repo. Gradle reads four project properties, normally passed as environment
// variables by CI (.github/workflows/mobile-android.yml) or by scripts/android/build-aab.sh:
//   ORG_GRADLE_PROJECT_MIMT_UPLOAD_STORE_FILE      absolute path to the upload keystore (.jks)
//   ORG_GRADLE_PROJECT_MIMT_UPLOAD_STORE_PASSWORD
//   ORG_GRADLE_PROJECT_MIMT_UPLOAD_KEY_ALIAS
//   ORG_GRADLE_PROJECT_MIMT_UPLOAD_KEY_PASSWORD
//
// Without them, `bundleRelease` falls back to the debug key (Expo's default). That file is only a local
// smoke test: Google Play refuses it. CI refuses to build without the four values.
// EAS Build ignores this block and injects its own credentials.

const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// mimt-upload-signing";

const SIGNING_CONFIG = `
        release { ${MARKER}
            if (findProperty('MIMT_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('MIMT_UPLOAD_STORE_FILE'))
                storePassword findProperty('MIMT_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('MIMT_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('MIMT_UPLOAD_KEY_PASSWORD')
            }
        }`;

function applySigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  const debugBlock = /signingConfigs\s*\{\s*\n\s*debug\s*\{[^}]*\}/;
  if (!debugBlock.test(gradle)) {
    throw new Error("withAndroidReleaseSigning: signingConfigs.debug not found in android/app/build.gradle");
  }
  let out = gradle.replace(debugBlock, (block) => block + SIGNING_CONFIG);
  const releaseUsesDebug = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(out)) {
    throw new Error("withAndroidReleaseSigning: release buildType signingConfig not found");
  }
  out = out.replace(
    releaseUsesDebug,
    "$1signingConfig findProperty('MIMT_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  return out;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("withAndroidReleaseSigning: only a Groovy build.gradle is supported");
    }
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applySigning = applySigning;
