// Build-time configuration (Vite env). None of these are secrets.
export const env = {
  apiUrl: (import.meta.env.VITE_API_URL || "https://api.mimt.ca").replace(/\/+$/, ""),
  takatakIssuer: (import.meta.env.VITE_TAKATAK_ISSUER || "").replace(/\/+$/, ""),
  takatakClientId: import.meta.env.VITE_TAKATAK_CLIENT_ID || "",
  /**
   * Dev/demo-only fixture API (no backend, no Twilio): set VITE_MOCK_API=1 at build or dev time.
   * The app shows a "Mode démo" banner. Never set it for app.mimt.ca.
   */
  mock: import.meta.env.VITE_MOCK_API === "1",
  /**
   * Google AdSense for the free plan (src/ads/). Public ids, not secrets. Unset client or banner slot =
   * no ads at all. docs/MIMT-LAUNCH.md « Publicités et coûts ».
   */
  adsense: {
    client: (import.meta.env.VITE_ADSENSE_CLIENT || "").trim(),
    slotBanner: (import.meta.env.VITE_ADSENSE_SLOT_BANNER || "").trim(),
    slotSidebar: (import.meta.env.VITE_ADSENSE_SLOT_SIDEBAR || "").trim(),
  },
  appVersion: "web-0.1.0",
};
