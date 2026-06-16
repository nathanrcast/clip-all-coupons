#!/usr/bin/env bash
# Minify bookmarklet.src.js into a javascript: URL -> bookmarklet.txt
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

MIN="$(terser bookmarklet.src.js --compress --mangle 2>/dev/null)"
# URL-encode for a safe javascript: href (encode %, #, etc. that break bookmarks).
ENC="$(node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf8")))' <<<"$MIN")"
printf 'javascript:%s' "$ENC" > bookmarklet.txt

echo "Wrote bookmarklet.txt ($(wc -c < bookmarklet.txt) bytes)."
echo "Create a bookmark and paste the file's contents as the URL/location."
