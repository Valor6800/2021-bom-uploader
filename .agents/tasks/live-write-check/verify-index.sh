#!/bin/zsh
# Run npm test against exactly what is staged (index), in a scratch copy.
set -e
REPO=/Volumes/workplace/6800/bom-uploader
OUT=/tmp/vbom-index-check
rm -rf "$OUT"
mkdir -p "$OUT"
git -C "$REPO" checkout-index -a --prefix="$OUT/"
ln -s "$REPO/node_modules" "$OUT/node_modules"
cd "$OUT"
env -i PATH="$PATH" HOME="$HOME" npm test > "$OUT.log" 2>&1 && rc=0 || rc=$?
grep -E "^(Tests|Test Suites):" "$OUT.log"
echo "exit=$rc"
exit $rc
