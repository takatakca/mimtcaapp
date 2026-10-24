#!/usr/bin/env bash
# Production smoke test for mimt.ca, app.mimt.ca and api.mimt.ca. Safe to run any time: read-only checks plus one
# number hold that is released right away. Usage: scripts/smoke/prod.sh [expected-commit-sha]
set -uo pipefail
# Checks use grep -c, not grep -q: with pipefail, grep -q exits on the first match and the writer dies of SIGPIPE.
SHA="${1:-}"
API="${API:-https://api.mimt.ca}"
pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ko() { echo "FAIL  $1"; fail=$((fail + 1)); }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else ko "$1"; fi; }
get() { curl -fsS --max-time 20 "$@"; }

check "mimt.ca/ads.txt has the exact AdSense line" '[ "$(get https://mimt.ca/ads.txt)" = "google.com, pub-4518068873401341, DIRECT, f08c47fec0942fa0" ]'
check "mimt.ca home has the AdSense account meta" 'get https://mimt.ca/ | grep -o "google-adsense-account[^>]*" | grep -c ca-pub-4518068873401341'
check "mimt.ca home has the number picker" 'get https://mimt.ca/ | grep -c "id=\"numero-q\""'
for p in /confidentialite/ /conditions/ /contact/ /a-propos/ /en/privacy/ /en/about/; do check "mimt.ca$p answers 200" "get -o /dev/null https://mimt.ca$p"; done
check "privacy page explains Google ad cookies" 'get https://mimt.ca/confidentialite/ | grep -c "adssettings.google.com"'
if [ -n "$SHA" ]; then
  check "mimt.ca release = $SHA" "get https://mimt.ca/mimt-release.json | grep -c $SHA"
  check "app.mimt.ca release = $SHA" "get https://app.mimt.ca/mimt-release.json | grep -c $SHA"
fi
check "app.mimt.ca /numero serves the app" 'get https://app.mimt.ca/numero | grep -ci "MIMT Web"'
check "api /healthz" "get $API/healthz"
check "api /readyz" "get $API/readyz"

search=$(curl -sS --max-time 30 "$API/v1/public/numbers/search?q=514")
if echo "$search" | grep -c '"numbers"' >/dev/null; then
  ok "public number search (514) answers"
  e164=$(echo "$search" | python3 -c "import sys,json; n=json.load(sys.stdin)['numbers']; print(n[0]['e164'] if n else '')")
  if [ -n "$e164" ]; then
    ok "search returned real numbers ($(echo "$search" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['numbers']))"))"
    hold=$(curl -sS --max-time 20 -X POST -H 'content-type: application/json' -d "{\"e164\":\"$e164\"}" "$API/v1/public/numbers/holds")
    id=$(echo "$hold" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    tok=$(echo "$hold" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
    if [ -n "$id" ] && [ -n "$tok" ]; then
      ok "hold created for 10 minutes"
      check "hold readable with its token" "curl -fsS -H 'x-hold-token: $tok' $API/v1/public/numbers/holds/$id | grep -c '\"held\"'"
      check "hold refused without its token" "[ \$(curl -s -o /dev/null -w '%{http_code}' $API/v1/public/numbers/holds/$id) = 404 ]"
      check "hold released" "[ \$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H 'x-hold-token: $tok' $API/v1/public/numbers/holds/$id) = 204 ]"
    else ko "hold creation: $hold"; fi
  else ko "search returned no numbers (Twilio inventory or config)"; fi
else ko "public number search: $search"; fi
check "checkout needs sign-in" "[ \$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{\"plan\":\"lock\"}' $API/v1/billing/checkout) = 401 ]"
check "SMS sign-in (Twilio Verify) is configured" "! curl -s -X POST -H 'content-type: application/json' -d '{\"phone\":\"+15145550100\"}' $API/v1/auth/otp/start | grep -c not_configured"

echo "---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
