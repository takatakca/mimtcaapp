// @vitest-environment node
// The installable app (PWA) manifest: what PWABuilder and the Microsoft Store read to package app.mimt.ca
// for Windows (docs/store/APPS-PARTOUT.md). Every icon and screenshot it names must exist with its declared size.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Image {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
  form_factor?: string;
  label?: string;
}

const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  display_override?: string[];
  icons: Image[];
  screenshots?: Image[];
};

const publicFile = (src: string) => new URL(`../public${src}`, import.meta.url);

/** Width and height from a PNG header (IHDR chunk). */
function pngSize(src: string): string {
  const bytes = readFileSync(publicFile(src));
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("manifest.webmanifest", () => {
  it("describes a standalone French app rooted at /", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url.startsWith("/")).toBe(true);
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override).toContain("standalone");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it("has 192 and 512 icons plus a maskable icon, all present with their declared size", () => {
    const png = manifest.icons.filter((i) => i.type === "image/png");
    expect(png.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
      if (icon.type === "image/png") expect(pngSize(icon.src), icon.src).toBe(icon.sizes);
    }
  });

  it("has phone and computer screenshots for the store listings, all present with their declared size", () => {
    const shots = manifest.screenshots ?? [];
    expect(shots.filter((s) => s.form_factor === "narrow").length).toBeGreaterThanOrEqual(1);
    expect(shots.filter((s) => s.form_factor === "wide").length).toBeGreaterThanOrEqual(1);
    for (const shot of shots) {
      expect(shot.label, shot.src).toBeTruthy();
      expect(pngSize(shot.src), shot.src).toBe(shot.sizes);
    }
  });
});
