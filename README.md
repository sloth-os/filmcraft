# filmcraft-web

Publishing pipeline for [FilmCraft](https://github.com/storytold/filmcraft) on
GitHub Pages: a weekly build of the upstream web (wasm) app, served as an
installable progressive web app that works offline.

This repository holds no application code. `.github/workflows/pages.yml` checks
out `storytold/filmcraft`, builds it exactly the way its own release web job
does (`cargo xtask web`, wasm-bindgen at the version `xtask/src/main.rs` pins,
`wasm-opt` from binaryen), and `pwa/apply.py` layers the PWA bits on top of the
resulting `dist/`:

- `pwa/manifest.webmanifest` — install metadata (standalone display, dark
  theme, `any` and `maskable` icons rendered from the upstream app icon),
- `pwa/sw.template.js` — service worker, rendered per build with the hash
  `index.html` puts in its asset URLs: the shell is precached, the page is
  network-first with a cache fallback, hashed assets are cache-first, and each
  build's cache replaces the last on activate,
- `pwa/icons/` — 192/512 `any` icons plus a maskable 512 and an Apple touch
  icon, all derived from `assets/app-icon/filmcraft-1024.png` upstream.

## Cadence

- Weekly, Mondays 03:17 UTC (`schedule`).
- On push to this repository's `main` (pipeline changes).
- Manually via **Run workflow**, with an optional `upstream-ref` to build a
  specific upstream commit or tag.

A failed build leaves the previously deployed version live; Pages only swaps
when a run succeeds end to end.

## License

FilmCraft and its assets are the work of their authors, dual-licensed MIT OR
Apache-2.0; the built app ships its `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`
and `ATTRIBUTION.md` alongside it, and `build.json` records the upstream commit
each deployment was built from. The pipeline files in this repository are
released under the same terms.
