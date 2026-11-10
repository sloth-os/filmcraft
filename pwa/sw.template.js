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
// app loads by plain relative URL, the file-handling consumer, and the
// manifest with its icons.
const SHELL = [
  "./",
  "./index.html",
  "./filmcraft_web.js?v=" + BUILD,
  "./filmcraft_web_bg.wasm?v=" + BUILD,
  "./audio-worklet.js",
  "./file-handler.js",
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

// The cached page for a navigation: the exact URL first (launch and deep-link
// URLs), then the shell, then the given fallback (or a network error).
function shellOr(request, fallback) {
  return caches
    .match(request)
    .then((hit) => hit || caches.match("./index.html"))
    .then((hit) => hit || fallback || Response.error());
}

// Keep the cached shell current: the index.html key every navigation refreshes,
// plus the scope-root key install precaches and shellOr matches first for launch
// URLs — a launch that falls back to a stale root key would boot an old build.
function rememberShell(request, response) {
  const copies = [response.clone(), response.clone()];
  const keys = ["./index.html"];
  if (new URL(request.url).pathname === new URL(self.registration.scope).pathname) keys.push("./");
  caches
    .has(CACHE)
    .then((mine) => mine && caches.open(CACHE).then((cache) => Promise.all(keys.map((key, i) => cache.put(key, copies[i])))))
    .catch(() => {});
}

// Cache a fetched asset only while this build's cache still exists and, for
// versioned URLs, only for this build's version: a replaced worker must neither
// resurrect its purged cache nor store another build's immutable assets in it.
function putMine(request, response) {
  const v = new URL(request.url).searchParams.get("v");
  if (v !== null && v !== BUILD) return;
  caches
    .has(CACHE)
    .then((mine) => mine && caches.open(CACHE).then((cache) => cache.put(request, response)))
    .catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // The page itself: network first so a new weekly build is picked up on the
  // next visit, cache fallback for offline use. A non-ok response (a path the
  // static host 404s, like a file-handler action URL) serves the cached shell
  // instead, and only ok responses refresh the cached copy.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            rememberShell(request, response);
            return response;
          }
          return shellOr(request, response);
        })
        .catch(() => shellOr(request, null))
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
            putMine(request, copy);
          }
          return response;
        })
    )
  );
});
