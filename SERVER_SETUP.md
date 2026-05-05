# FoundaPay ERP — Server Setup Guide

End-to-end production setup for `portal.foundapay.com` on a fresh Ubuntu 22.04 VPS.

> **PCI WARNING:** The Virtual Terminal "Process Payment" tab accepts raw card
> numbers. Running this in production triggers PCI DSS SAQ-D scope (annual
> audits, network segmentation, quarterly ASV scans, ~$10–50K/year). Strongly
> recommended: switch the frontend card form to the processor's hosted-fields
> integration (Authorize.net Accept.js, NMI Collect.js) before pointing real
> cards at it. See `backend/src/services/processors/*.js` for inline notes.

---

## 1 · Provision the VPS

- **Provider**: Hostinger / DigitalOcean / Linode — your call
- **Plan**: 2 vCPU, 4–8 GB RAM, Ubuntu 22.04 LTS
- **Cost**: ~$10–15/month

After signup, note the **public IP address**.

## 2 · Point your domain

In your DNS provider:

```
A    portal.foundapay.com    →  <SERVER_IP>
TTL  300
```

Wait 5–30 minutes for propagation. Verify with `dig portal.foundapay.com`.

## 3 · SSH in

```bash
ssh root@<SERVER_IP>
```

## 4 · One-shot install (paste as a single block)

```bash
#!/bin/bash
set -e

# System updates
apt update && apt upgrade -y

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2 + tools
npm install -g pm2
apt install -y postgresql postgresql-contrib nginx certbot python3-certbot-nginx git ufw

# Firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# App directories
mkdir -p /var/www/foundapay /var/log/foundapay /var/www/foundapay/receipts
chown -R www-data:www-data /var/www/foundapay
chmod 755 /var/www/foundapay

# PostgreSQL — replace YOUR_STRONG_PASSWORD before running
sudo -u postgres psql -c "CREATE DATABASE foundapay_erp;"
sudo -u postgres psql -c "CREATE USER foundapay_user WITH ENCRYPTED PASSWORD 'YOUR_STRONG_PASSWORD';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE foundapay_erp TO foundapay_user;"
sudo -u postgres psql -d foundapay_erp -c 'GRANT ALL ON SCHEMA public TO foundapay_user;'
sudo -u postgres psql -d foundapay_erp -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'

echo "✅ Base server setup complete"
```

## 5 · Push your code to GitHub (once, on local Mac)

```bash
cd /Users/syedmukkarram/foundapay-erp
git init
git add .
git commit -m "FoundaPay ERP v2.0"

# Create a private repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/foundapay-erp.git
git branch -M main
git push -u origin main
```

> The `.gitignore` already excludes `backend/.env`, `backend/src/seeds/run.js`,
> and `node_modules/`. Never commit those.

## 6 · Pull code onto the server

```bash
cd /var/www/foundapay
git clone https://github.com/YOUR_USERNAME/foundapay-erp.git .
```

## 7 · Configure environment

```bash
cp backend/.env.production backend/.env
nano backend/.env
```

Fill in:
- `DB_PASSWORD` — match what you set in step 4
- `JWT_SECRET` — generate via `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `MAIL_PASS` — your SendGrid API key (or whatever SMTP service)
- Processor credentials (when you have them)

## 8 · Install + migrate + seed

```bash
cd /var/www/foundapay/backend
npm install --omit=dev
node src/migrations/run.js
# Apply Phase 3 migration
PGPASSWORD=YOUR_STRONG_PASSWORD psql -U foundapay_user -h localhost -d foundapay_erp \
  -f src/migrations/002_brokers_partners.sql

# IMPORTANT: do NOT run seeds/run.js on production unless you want demo data.
# If first deployment AND you want admin user only, run a minimal seed manually.
```

For an admin-only first user without running the full seed:

```bash
node -e "
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { pool } = require('./src/db');
(async () => {
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
  await pool.query(\`INSERT INTO users (email, password_hash, name, role, is_active)
                    VALUES (\$1, \$2, 'FoundaPay Admin', 'super_admin', true)
                    ON CONFLICT (email) DO NOTHING\`,
    [process.env.ADMIN_EMAIL, hash]);
  console.log('Admin ready:', process.env.ADMIN_EMAIL);
  await pool.end();
})();
"
```

## 9 · Start backend with PM2

```bash
cd /var/www/foundapay
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
# Run the command pm2 prints (sets up PM2 to start on boot)
```

## 10 · Build frontend

```bash
cd /var/www/foundapay/frontend
npm install
npm run build
```

## 11 · Configure Nginx

```bash
cp /var/www/foundapay/nginx.conf /etc/nginx/sites-available/foundapay
ln -sf /etc/nginx/sites-available/foundapay /etc/nginx/sites-enabled/
# Disable default if it conflicts
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

## 12 · SSL certificate (free, auto-renew)

```bash
certbot --nginx -d portal.foundapay.com
# When prompted, choose option 2 (redirect HTTP → HTTPS)
```

Auto-renewal is installed as a systemd timer; verify with:

```bash
systemctl status certbot.timer
```

## 13 · Verify

```bash
curl https://portal.foundapay.com/api/health
# → {"ok":true,"service":"foundapay-erp-api","version":"2.0.0",...}
```

Open in a browser: **https://portal.foundapay.com**

Log in with the admin email/password from step 7. **Change the password
immediately** via Users → Edit.

## 14 · Day-2 operations

| Task | Command |
|---|---|
| View logs | `pm2 logs foundapay-api` |
| Restart backend | `pm2 restart foundapay-api` |
| Deploy updates | `bash /var/www/foundapay/deploy.sh` |
| DB backup | `pg_dump -U foundapay_user foundapay_erp > backup-$(date +%F).sql` |
| Tail nginx access | `tail -f /var/log/nginx/access.log` |
| Tail nginx error | `tail -f /var/log/nginx/error.log` |

## 15 · Hardening checklist

- [ ] Disable root SSH (`PermitRootLogin no` in `/etc/ssh/sshd_config`)
- [ ] Add a non-root deploy user with sudo
- [ ] Enable automatic security updates (`unattended-upgrades`)
- [ ] Set up daily DB backups (cron + offsite copy)
- [ ] Configure fail2ban for SSH brute-force protection
- [ ] Rotate `JWT_SECRET` after the initial admin login
- [ ] Confirm `backend/.env` is `chmod 600` and owned by the deploy user
- [ ] Switch payment processors to hosted fields *before* taking real card data

---

**Questions?** All file paths in this guide are absolute. The `deploy.sh`
script automates steps 8–11 for subsequent deploys.
