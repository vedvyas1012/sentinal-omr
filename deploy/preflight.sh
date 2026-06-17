#!/usr/bin/env bash
# Pre-flight safety check for deploying Sentinal OMR alongside other sites.
# Read-only: it changes nothing. Run it on the server BEFORE the cutover.
#
#   bash deploy/preflight.sh
#
# Override defaults if needed:
#   PORT=3003 DB_NAME=neet_omr PM2_APP=sentinal-omr bash deploy/preflight.sh

set -u

PORT="${PORT:-3002}"
DB_NAME="${DB_NAME:-neet_omr}"
PM2_APP="${PM2_APP:-sentinal-omr}"

pass=0; warn=0; fail=0
ok()   { echo "  [ OK ]  $1"; pass=$((pass+1)); }
warns(){ echo "  [WARN]  $1"; warn=$((warn+1)); }
bad()  { echo "  [FAIL]  $1"; fail=$((fail+1)); }

echo "Sentinal OMR pre-flight  (port=$PORT  db=$DB_NAME  pm2=$PM2_APP)"
echo "------------------------------------------------------------"

# 1. Required tooling
echo "Tooling:"
for c in node npm psql nginx pm2; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c found"; else bad "$c not found"; fi
done
command -v certbot >/dev/null 2>&1 && ok "certbot found" || warns "certbot not found (needed for TLS)"

# 2. Node version >= 18
if command -v node >/dev/null 2>&1; then
  major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
  if [ "${major:-0}" -ge 18 ] 2>/dev/null; then ok "Node $(node -v) >= 18"; else bad "Node $(node -v) is < 18"; fi
fi

# 3. Target port is free (this is what protects the other site from a clash)
echo "Port:"
inuse=""
if command -v lsof >/dev/null 2>&1; then
  inuse=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)
elif command -v ss >/dev/null 2>&1; then
  ss -ltnH 2>/dev/null | grep -q ":$PORT " && inuse="yes"
fi
if [ -z "$inuse" ]; then ok "port $PORT is free"; else bad "port $PORT is already in use — pick another (PORT=NNNN)"; fi

# 4. pm2 app name not already taken
if command -v pm2 >/dev/null 2>&1; then
  if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_APP\""; then
    warns "a pm2 app named '$PM2_APP' already exists (re-deploy?) — it will be replaced"
  else
    ok "pm2 app name '$PM2_APP' is free"
  fi
fi

# 5. Database does not already exist (warn — could be an intentional re-deploy)
echo "Database:"
db_exists=""
if command -v psql >/dev/null 2>&1; then
  if sudo -n -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1; then
    db_exists="yes"
  fi
fi
if [ -n "$db_exists" ]; then
  warns "database '$DB_NAME' already exists — fine for re-deploy, but don't overwrite another app's data"
else
  ok "database '$DB_NAME' does not exist yet (will be created)"
fi

# 6. nginx config currently valid — so reloading after adding the new block is safe
echo "nginx:"
if command -v nginx >/dev/null 2>&1; then
  if sudo -n nginx -t >/dev/null 2>&1; then
    ok "current nginx config passes 'nginx -t' (safe to reload)"
  else
    warns "could not run 'nginx -t' (need sudo?). ALWAYS run 'sudo nginx -t' before reload"
  fi
fi

# 7. Project .env sanity (only if run from the project root)
echo "Config:"
if [ -f .env ]; then
  miss=""
  for k in NODE_ENV PORT DATABASE_URL JWT_SECRET HUB_API_KEY; do
    grep -qE "^${k}=" .env || miss="$miss $k"
  done
  [ -z "$miss" ] && ok ".env has all required keys" || warns ".env missing:$miss"
  grep -qE "^NODE_ENV=production" .env && ok "NODE_ENV=production" || warns "NODE_ENV is not 'production' in .env"
else
  warns ".env not found in current dir (create it before starting — see DEPLOY.md)"
fi
if [ -f client/dist/index.html ]; then ok "client build present (client/dist)"; else warns "client not built yet — run: npm --prefix client run build"; fi

# 8. Memory headroom (informational)
echo "Resources:"
if command -v free >/dev/null 2>&1; then
  echo "  $(free -h | awk 'NR==1||/Mem/')"
  ok "(review available memory above — OMR is capped at 400M in pm2)"
fi

echo "------------------------------------------------------------"
echo "Result: $pass OK, $warn warning(s), $fail failure(s)"
if [ "$fail" -gt 0 ]; then
  echo "NOT safe to deploy yet — resolve the FAIL items above."
  exit 1
fi
echo "No blockers. Review warnings, then proceed with DEPLOY.md."
echo "Reminder: run 'sudo nginx -t' before 'systemctl reload nginx' — that reload is the only step that can affect your other site."
