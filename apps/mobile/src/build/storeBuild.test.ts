import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import appConfig from "../../app.config";

const require = createRequire(import.meta.url);
const { applySigning } = require("../../plugins/withAndroidReleaseSigning.js") as {
  applySigning: (gradle: string) => string;
};

const root = join(__dirname, "..", "..");

// The block Expo SDK 57 prebuild writes into android/app/build.gradle.
const GENERATED = `
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            shrinkResources false
        }
    }`;

type PluginEntry = string | [string, Record<string, unknown>];

function config() {
  const resolved = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
  const plugins = (resolved.plugins ?? []) as PluginEntry[];
  const options = (name: string) => {
    const entry = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
    return Array.isArray(entry) ? entry[1] : undefined;
  };
  return { resolved, plugins, options };
}

describe("Android release signing plugin", () => {
  it("signs release with the upload key when provided, debug key otherwise", () => {
    const out = applySigning(GENERATED);
    expect(out).toContain("release { // mimt-upload-signing");
    expect(out).toContain("storeFile file(findProperty('MIMT_UPLOAD_STORE_FILE'))");
    expect(out).toContain(
      "signingConfig findProperty('MIMT_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    // The debug build type keeps the debug key.
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
    // No password or path is ever written into the file.
    expect(out).not.toMatch(/storePassword '(?!android')/);
  });

  it("is idempotent", () => {
    const once = applySigning(GENERATED);
    expect(applySigning(once)).toBe(once);
  });

  it("fails loudly when the template changes", () => {
    expect(() => applySigning("android {}")).toThrow(/signingConfigs\.debug not found/);
  });
});

describe("store build config", () => {
  it("never blocks the microphone the calls need", () => {
    const { resolved, options } = config();
    expect(resolved.android?.blockedPermissions ?? []).not.toContain("android.permission.RECORD_AUDIO");
    expect(resolved.android?.permissions).toContain("android.permission.RECORD_AUDIO");
    // expo-image-picker turns `microphonePermission: false` into a blocked RECORD_AUDIO on Android.
    expect(options("expo-image-picker")?.microphonePermission).not.toBe(false);
    expect(options("expo-audio")?.recordAudioAndroid).not.toBe(false);
  });

  it("ships an icon, adaptive icon, splash and notification icon", () => {
    const { resolved, options } = config();
    const files = [
      resolved.icon,
      resolved.android?.adaptiveIcon?.foregroundImage,
      resolved.android?.adaptiveIcon?.monochromeImage,
      options("expo-splash-screen")?.image,
      options("expo-notifications")?.icon,
    ];
    for (const file of files) {
      expect(typeof file).toBe("string");
      expect(existsSync(join(root, file as string))).toBe(true);
    }
  });

  it("uses the release signing plugin and a CI versionCode", () => {
    const { plugins } = config();
    expect(plugins).toContain("./plugins/withAndroidReleaseSigning");
    process.env.ANDROID_VERSION_CODE = "42";
    try {
      expect(config().resolved.android?.versionCode).toBe(42);
    } finally {
      delete process.env.ANDROID_VERSION_CODE;
    }
  });
});
