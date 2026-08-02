#!/usr/bin/env bash
# Minify every *bookmarklet.src.js into a javascript: URL -> matching *.txt
#   bookmarklet.src.js         -> bookmarklet.txt          (Albertsons family)
#   kroger-bookmarklet.src.js  -> kroger-bookmarklet.txt   (Kroger family)
#   target-bookmarklet.src.js  -> target-bookmarklet.txt   (Target Circle)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

for SRC in *bookmarklet.src.js; do
  OUT="${SRC%.src.js}.txt"
  MIN="$(terser "$SRC" --compress --mangle 2>/dev/null)"
  # URL-encode for a safe javascript: href (encode %, #, etc. that break bookmarks).
  ENC="$(node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf8")))' <<<"$MIN")"
  printf 'javascript:%s' "$ENC" > "$OUT"
  echo "Wrote $OUT ($(wc -c < "$OUT") bytes)."
done
echo "Create a bookmark and paste a file's contents as the URL/location."
