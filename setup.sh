#!/bin/bash
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FoundaPay ERP — Local Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo ""
echo "[1/6] Creating PostgreSQL database and user..."
psql -U postgres -c "CREATE DATABASE foundapay_erp;" 2>/dev/null || echo "    (database already exists, continuing)"
psql -U postgres -c "CREATE USER foundapay_user WITH ENCRYPTED PASSWORD 'FoundaPay2026!';" 2>/dev/null || echo "    (user already exists, continuing)"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE foundapay_erp TO foundapay_user;" 2>/dev/null || true
psql -U postgres -d foundapay_erp -c "GRANT ALL ON SCHEMA public TO foundapay_user;" 2>/dev/null || true
psql -U postgres -d foundapay_erp -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true

echo ""
echo "[2/6] Installing backend dependencies..."
cd "$ROOT_DIR/backend"
npm install --silent

echo ""
echo "[3/6] Running database migrations..."
node src/migrations/run.js

echo ""
echo "[4/6] Seeding database..."
if [ -f "src/seeds/run.js" ]; then
  node src/seeds/run.js
else
  echo "    seeds/run.js not found — using example data"
  node src/seeds/run.example.js
fi

echo ""
echo "[5/6] Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install --silent

echo ""
echo "[6/6] Starting servers..."
cd "$ROOT_DIR/backend"
node server.js > /tmp/foundapay-backend.log 2>&1 &
BACKEND_PID=$!
echo "    Backend PID: $BACKEND_PID  (logs: /tmp/foundapay-backend.log)"

sleep 2

cd "$ROOT_DIR/frontend"
npm run dev > /tmp/foundapay-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "    Frontend PID: $FRONTEND_PID  (logs: /tmp/foundapay-frontend.log)"

sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ FoundaPay ERP is running"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Frontend:  http://localhost:5173"
echo "  Backend:   http://localhost:5000/api/health"
echo "  Login:     admin@foundapay.com / StrongAdmin@123"
echo ""
echo "  To stop: kill $BACKEND_PID $FRONTEND_PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
