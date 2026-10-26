/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * dist/mimt-release.json = {"commit":"<sha>"}, the same shape as mimt.ca's. The deploy workflow
 * fetches https://app.mimt.ca/mimt-release.json and requires the released commit, so a stale or
 * partial upload can never pass as verified. GITHUB_SHA in Actions, SOURCE_COMMIT in Coolify builds,
 * else the local git HEAD.
 */
export function releaseCommit(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.GITHUB_SHA?.trim() || env.SOURCE_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function releaseManifest(): Plugin {
  return {
    name: "mimt-release-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "mimt-release.json", source: `${JSON.stringify({ commit: releaseCommit() })}\n` });
    },
  };
}

// MIMT Web (app.mimt.ca): static SPA. `vite build` writes dist/, served with an SPA fallback
// (see README.md, section Déploiement).
export default defineConfig({
  plugins: [react(), releaseManifest()],
  server: { port: 5174 },
  preview: { port: 4174 },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { twilio: ["@twilio/voice-sdk"], react: ["react", "react-dom", "react-router"] } },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // The demo-mode App test walks several screens in jsdom; give it room on loaded CI runners.
    testTimeout: 20_000,
  },
});
