import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./takatak";

describe("OAuth post-login navigation", () => {
  it("keeps local application routes and their query strings", () => {
    expect(safeReturnTo("/messages")).toBe("/messages");
    expect(safeReturnTo("/affaires/tableau?filtre=jour")).toBe("/affaires/tableau?filtre=jour");
  });

  it("rejects absolute, protocol-relative, malformed and auth-loop destinations", () => {
    for (const input of [
      "https://example.com/",
      "//example.com",
      "\\\\example.com",
      "/\\\\example.com",
      "javascript:alert(1)",
      "/auth/callback?code=stolen",
      "/connexion",
      "/connexion/texto",
      "/messages\nLocation: https://example.com",
      null,
      {},
    ]) {
      expect(safeReturnTo(input)).toBe("/accueil");
    }
  });
});
