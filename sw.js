"use strict";
const CACHE = "life-log-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./pk.js",
  "./medications.js",
  "./manifest.webmanifest",
  "./icon.svg",
];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))),
);
// Leave activation to the browser after old clients close: avoid mixed UI versions.
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => /^life-log-v\d+$/.test(k) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const assets = ASSETS.map(
    (path) => new URL(path, self.registration.scope).href,
  );
  if (e.request.method === "GET" && assets.includes(url.href))
    e.respondWith(
      caches
        .open(CACHE)
        .then((c) => c.match(e.request))
        .then((r) => r || fetch(e.request)),
    );
});
