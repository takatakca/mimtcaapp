import localFont from "next/font/local";

// Self-hosted from apps/web/fonts (SIL Open Font License, see OFL-*.txt): the build never
// downloads fonts, so a Google Fonts outage cannot break CI or the auto-deploy.
// The latin subset covers French and English, accents included.
export const montserrat = localFont({
  src: [{ path: "../fonts/montserrat-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-heading",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Arial", "sans-serif"],
});

export const inter = localFont({
  src: [{ path: "../fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-body",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Arial", "sans-serif"],
});
