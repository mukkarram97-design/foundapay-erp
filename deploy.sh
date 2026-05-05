#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FoundaPay ERP — Production deploy script
# Usage:  bash /var/www/foundapay/deploy.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/var/www/foundapay}"
cd "$ROOT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FoundaPay ERP — Deploying to Production"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "[1/6] Pulling latest code..."
git pull origin main

echo ""
echo "[2/6] Installing backend dependencies..."
cd "$ROOT_DIR/backend"
npm install --omit=dev

echo ""
echo "[3/6] Running database migrations..."
node src/migrations/run.js
# Run any newer numbered migrations idempotently
for sql in src/migrations/*.sql; do
  base=$(basename "$sql")
  if [ "$base" != "schema.sql" ]; then
    echo "    Applying $base..."
    PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -f "$sql" || true
  fi
done

echo ""
echo "[4/6] Restarting backend with PM2..."
pm2 restart foundapay-api 2>/dev/null || \
  pm2 start "$ROOT_DIR/ecosystem.config.js" --env production

echo ""
echo "[5/6] Building frontend..."
cd "$ROOT_DIR/frontend"
npm install
npm run build

echo ""
echo "[6/6] Reloading Nginx..."
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment complete"
echo "  🌍 https://portal.foundapay.com"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 status
