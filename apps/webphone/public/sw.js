// MIMT Web service worker: makes app.mimt.ca installable and opens the app shell offline.
// It caches the app shell ONLY (index.html, the hashed /assets/* files, icons, manifest).
// It never caches or even looks at API calls (api.mimt.ca is another origin), the TAKATAK sign-in
// callback, audio links or anything that carries credentials. Registered by src/pwa.ts in
// production builds only.
const CACHE = "mimt-shell-v1";
const SHELL = ["/index.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mimt-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Static files of the shell, by path. Everything else goes straight to the network. */
function isShellAsset(url) {
  return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Other origins (the MIMT API, TAKATAK, Twilio, fonts): not ours to cache.
  if (url.origin !== self.location.origin) return;
  // Never anything that carries credentials or a sign-in code.
  if (req.headers.has("Authorization") || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/auth/") || url.search.includes("code=")) return;

  if (req.mode === "navigate") {
    // Network first; offline, the cached shell (the SPA shows its own "no connection" errors).
    // Navigation responses are never written to the cache.
    event.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || Response.error())));
    return;
  }

  if (isShellAsset(url)) {
    // Hashed build files never change: cache first, filled on first use.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Web Push (new text, voicemail…): the API sends only a title, a short body and the path to open.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "MIMT";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/messages" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          w.focus();
          return w.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
