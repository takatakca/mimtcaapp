#!/usr/bin/env bash
# Uptime check for mimt.ca, app.mimt.ca and api.mimt.ca, run every 10 minutes by .github/workflows/uptime.yml.
# Each service gets 3 attempts 20 s apart, so one blip never alerts. A real outage opens one GitHub issue
# « Panne: <service> » (label incident), later failures add nothing; recovery comments and closes it.
#
#   DRY_RUN=1 scripts/monitor/uptime.sh     # checks only, no GitHub issues (local use)
# Needs: curl, jq, and gh with GH_TOKEN (issues: write) unless DRY_RUN=1.
set -uo pipefail

ATTEMPTS="${ATTEMPTS:-3}"
PAUSE="${PAUSE:-20}"
ADS_LINE="google.com, pub-4518068873401341, DIRECT, f08c47fec0942fa0"

get() { curl -fsS --connect-timeout 10 --max-time 20 -H "Cache-Control: no-cache" "$1"; }

check_site() { get "https://mimt.ca/?uptime=$RANDOM" >/dev/null && [[ "$(get "https://mimt.ca/ads.txt?uptime=$RANDOM")" == "$ADS_LINE" ]]; }
check_app() { get "https://app.mimt.ca/?uptime=$RANDOM" | grep -qi "MIMT"; }
check_api() {
  get https://api.mimt.ca/healthz | jq -e '.ok == true' >/dev/null &&
    get https://api.mimt.ca/readyz | jq -e '.ok == true and .db == "up" and .schema == "current"' >/dev/null
}

# name|function|what is checked
SERVICES=(
  "mimt.ca|check_site|https://mimt.ca/ répond et ads.txt contient la ligne AdSense exacte"
  "app.mimt.ca|check_app|https://app.mimt.ca/ répond"
  "api.mimt.ca|check_api|https://api.mimt.ca/healthz et /readyz (base de données en ligne)"
)

run_check() {
  local fn="$1" i
  for ((i = 1; i <= ATTEMPTS; i++)); do
    "$fn" && return 0
    ((i < ATTEMPTS)) && sleep "$PAUSE"
  done
  return 1
}

open_issue_number() {
  gh issue list --label incident --state open --limit 50 --json number,title |
    jq -r --arg t "Panne: $1" '.[] | select(.title == $t) | .number' | head -n 1
}

now="$(date -u '+%Y-%m-%d %H:%M UTC')"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-takatakca/mimtcaapp}/actions/runs/${GITHUB_RUN_ID:-0}"
down=0
alert_errors=0
if [[ -z "${DRY_RUN:-}" ]]; then
  gh label create incident --color B60205 --description "Panne détectée par la surveillance" >/dev/null 2>&1 || true
fi

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name fn what <<<"$entry"
  if run_check "$fn"; then
    echo "UP    $name"
    status=up
  else
    echo "DOWN  $name ($what)"
    status=down
    down=$((down + 1))
  fi
  [[ -n "${DRY_RUN:-}" ]] && continue
  if ! issue="$(open_issue_number "$name")"; then
    echo "::error::Unable to inspect existing incident issues for $name." >&2
    alert_errors=$((alert_errors + 1))
    continue
  fi
  if [[ "$status" == down && -z "$issue" ]]; then
    gh issue create --label incident --title "Panne: $name" \
      --body "**$name est en panne** depuis $now (après $ATTEMPTS essais à ${PAUSE} s d'intervalle).

Vérifié : $what.
Exécution : $run_url

Cette fiche se ferme toute seule quand le service répond de nouveau." >/dev/null && echo "      issue opened" || {
      echo "::error::Unable to open outage issue for $name." >&2
      alert_errors=$((alert_errors + 1))
    }
  elif [[ "$status" == up && -n "$issue" ]]; then
    if ! gh issue comment "$issue" --body "✅ $name répond de nouveau ($now). Exécution : $run_url" >/dev/null; then
      echo "::error::Unable to comment on recovery issue for $name." >&2
      alert_errors=$((alert_errors + 1))
    elif gh issue close "$issue" >/dev/null; then
      echo "      issue #$issue closed (recovered)"
    else
      echo "::error::Unable to close recovery issue for $name." >&2
      alert_errors=$((alert_errors + 1))
    fi
  fi
done

# A successfully created incident remains green; failed notification delivery must be red.
echo "services down: $down"
if (( alert_errors > 0 )); then
  echo "::error::Monitoring could not reconcile $alert_errors incident alert(s)." >&2
  exit 1
fi
