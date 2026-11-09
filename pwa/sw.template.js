// Service worker for the FilmCraft web build published to GitHub Pages. The
// publishing workflow renders this file, substituting the placeholder in BUILD
// with the hash index.html puts in its asset URLs (the same scheme `cargo xtask
// web` uses), so every weekly build gets its own cache and old caches are
// dropped on activate.
"use strict";

const BUILD = "__FC_BUILD__";
const CACHE = "filmcraft-web-" + BUILD;

// The app shell: the page itself, the wasm-bindgen glue and the wasm module
// under their build-hashed (hence immutable) URLs, the AudioWorklet script the
// app loads by plain relative URL, and the manifest with its icons.
const SHELL = [
  "./",
  "./index.html",
  "./filmcraft_web.js?v=" + BUILD,
  "./filmcraft_web_bg.wasm?v=" + BUILD,
  "./audio-worklet.js",
  "./favicon.png",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // The page itself: network first so a new weekly build is picked up on the
  // next visit, cache fallback for offline use.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Everything else: cache first (the build-hashed assets are immutable), then
  // network, caching what arrives so anything the shell list misses still
  // works offline afterwards.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
    )
  );
});
