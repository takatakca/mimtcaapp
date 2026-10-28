// Entry point (index.html → /src/main.tsx).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./pwa";
import { captureAffiliate } from "./lib/affiliate";
import "./styles.css";
import "./styles/missions.css";
import "./styles/affiliate.css";

// Affiliate link (?aff=CODE): kept as first touch before anything else (lib/affiliate.ts).
captureAffiliate(window.location.search);
import "./styles/pilot.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing in index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
