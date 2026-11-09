#!/usr/bin/env python3
"""Layer the PWA files onto a built FilmCraft web dist.

Usage: apply.py DIST UPSTREAM_DIR UPSTREAM_SHA

DIST is the directory `cargo xtask web` produced (target/web/dist), UPSTREAM_DIR
the storytold/filmcraft checkout it was built from. Renders the service worker
with the build hash index.html uses in its asset URLs, copies the manifest and
icons in, wires index.html up to both, and copies the upstream license texts
next to the app. Fails loudly if anything it expects is missing.
"""

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

PWA = Path(__file__).resolve().parent
DOCS = ("README.md", "LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "ATTRIBUTION.md")

HEAD_TAGS = """  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#1b1c1f">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
"""

BODY_TAGS = """  <script>
    // PWA layer added by the publishing workflow (the app build is unchanged):
    // the service worker caches the whole app so it runs offline.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  </script>
"""


def main(dist: Path, upstream: Path, upstream_sha: str) -> int:
    index = dist / "index.html"
    html = index.read_text(encoding="utf-8")

    # `cargo xtask web` replaces the __FC_BUILD__ placeholder with the build hash;
    # index.html then builds the glue and wasm URLs from it at runtime.
    match = re.search(r'const build = "([0-9a-f]{8,})"', html)
    if not match:
        print("error: no build hash in index.html (is this a release web build?)", file=sys.stderr)
        return 1
    build = match.group(1)
    print(f"build hash: {build}")

    # Service worker, rendered with this build's hash.
    sw = (PWA / "sw.template.js").read_text(encoding="utf-8").replace("__FC_BUILD__", build)
    assert "__FC_BUILD__" not in sw
    (dist / "sw.js").write_text(sw, encoding="utf-8")

    # Manifest and icons.
    shutil.copy2(PWA / "manifest.webmanifest", dist / "manifest.webmanifest")
    icons = dist / "icons"
    icons.mkdir(exist_ok=True)
    for png in sorted((PWA / "icons").glob("*.png")):
        shutil.copy2(png, icons / png.name)

    # Wire index.html up: PWA tags before </head>, registration before </body>.
    for anchor, tags in (("</head>", HEAD_TAGS), ("</body>", BODY_TAGS)):
        if html.count(anchor) != 1:
            print(f"error: expected exactly one {anchor!r} in index.html", file=sys.stderr)
            return 1
        html = html.replace(anchor, tags + anchor)
    index.write_text(html, encoding="utf-8")

    # The app's license texts next to the app.
    for name in DOCS:
        source = upstream / name
        if source.is_file():
            shutil.copy2(source, dist / name)

    (dist / "build.json").write_text(
        json.dumps(
            {
                "upstream": upstream_sha,
                "build": build,
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    # Verify what the browser will need.
    html = index.read_text(encoding="utf-8")
    checks = [
        ('rel="manifest"' in html, "index.html links the manifest"),
        ("serviceWorker" in html, "index.html registers the service worker"),
        (f'const BUILD = "{build}"' in (dist / "sw.js").read_text(encoding="utf-8"), "sw.js carries the build hash"),
        ((dist / "manifest.webmanifest").is_file(), "manifest present"),
        ((icons / "icon-maskable-512.png").is_file(), "maskable icon present"),
    ]
    for ok, label in checks:
        print(("  ok  " if ok else "  FAIL ") + label)
        if not ok:
            return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]))
