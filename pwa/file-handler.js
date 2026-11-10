// PWA File Handling: an OS "Open with FilmCraft" launch navigates the app to
// its manifest file_handlers action URL and delivers the file handles
// out-of-band on window.launchQueue (they are never part of the request, so
// the service worker cannot see them). Hand them to the wasm app through its
// window.filmcraft API — importFiles for media, openProject for .fcproj —
// once start-up has finished. Browsers without the API ignore this script.
"use strict";

(function () {
  if (typeof LaunchParams === "undefined" || !("launchQueue" in window) || !("files" in LaunchParams.prototype)) return;

  // Chrome re-sends the previous launch's params on every same-origin
  // main-frame commit of the app window, including reloads, and the document
  // that receives that re-send has no memory of the one that consumed it.
  // Record each consumed launch as a fingerprint (sorted file names) in
  // sessionStorage, which survives reloads of the same window, and skip a
  // matching fingerprint only when this document is a reload. Genuine launches
  // always run: a new window starts with empty storage, and a launch routed
  // into an existing window is a plain navigation, not a reload.
  const STORE = "filmcraft.launch";
  const store = {
    get() {
      try {
        return sessionStorage.getItem(STORE);
      } catch (error) {
        return null;
      }
    },
    set(value) {
      try {
        sessionStorage.setItem(STORE, value);
      } catch (error) {}
    },
  };
  const navigation = performance.getEntriesByType("navigation")[0];
  const isReload = !!(navigation && navigation.type === "reload");

  // start() installs window.filmcraft and sets filmcraftLoad.readyMs when it
  // resolves, so both together mean the app can take files; .error/.fatal mean
  // it never will (index.html shows its own message then).
  const appReady = () =>
    !!(window.filmcraftLoad && window.filmcraftLoad.readyMs && window.filmcraft && window.filmcraft.importFiles);
  const appFailed = () => !!(window.filmcraftLoad && (window.filmcraftLoad.error || window.filmcraftLoad.fatal));

  function waitReady(timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      (function poll() {
        if (appReady()) return resolve();
        if (appFailed()) return reject(new Error("FilmCraft failed to start"));
        if (Date.now() > deadline) return reject(new Error("FilmCraft did not become ready in time"));
        setTimeout(poll, 250);
      })();
    });
  }

  // The wasm calls bottom out in a UI-thread queue that a panicked frame stops
  // draining forever; abandon a wedged call instead of letting every later
  // launch in this window queue behind it.
  const withTimeout = (promise, ms, what) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(what + " timed out")), ms)),
    ]);

  async function deliver(handles) {
    const fingerprint = handles
      .map((handle) => handle.name)
      .sort()
      .join("\n");
    if (isReload && store.get() === fingerprint) return;

    await waitReady(60000);
    const files = [];
    for (const handle of handles) {
      try {
        files.push(await handle.getFile());
      } catch (error) {
        console.warn("filmcraft: skipping unreadable launched file:", handle.name, error);
      }
    }
    if (!files.length) return;

    // A project replaces the session, so open projects before importing the
    // media launched alongside them; one bad entry never drops the rest, as in
    // the app's own drag-and-drop routing.
    const projects = files.filter((f) => f.name.toLowerCase().endsWith(".fcproj"));
    const media = files.filter((f) => !projects.includes(f));
    const failed = [];
    for (const project of projects) {
      try {
        await withTimeout(window.filmcraft.openProject(project), 120000, "openProject");
      } catch (error) {
        failed.push(project.name + ": " + ((error && error.message) || error));
      }
    }
    if (media.length) {
      try {
        const result = await withTimeout(window.filmcraft.importFiles(media), 300000, "importFiles");
        for (const error of (result && result.errors) || []) failed.push(String((error && error.message) || error));
      } catch (error) {
        failed.push("import: " + ((error && error.message) || error));
      }
    }
    store.set(fingerprint);
    if (failed.length) console.warn("filmcraft: launched files reported problems:", failed);
  }

  // Launches can arrive back to back (Windows launches once per file), and a
  // consumer call must not drop work: queue them in order.
  let chain = Promise.resolve();
  window.launchQueue.setConsumer((params) => {
    const handles = params.files || [];
    if (!handles.length) return;
    chain = chain.then(() => deliver(handles)).catch((error) => {
      console.error("filmcraft: opened-file launch failed:", error);
    });
  });
})();
