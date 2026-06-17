# Deploying Sentinal OMR

Production deployment to an Ubuntu server, designed to coexist with other sites
(e.g. biobid) on the same machine. Only the **API + built web client** and a
**PostgreSQL database** run on the server. The mobile app and hub agent run
elsewhere and point at the public URL.

Isolation from other sites:
- Internal port **3002** (nginx routes by domain; the port is never public)
- Dedicated database **`neet_omr`**
- Subdomain **`sentinel.YOURDOMAIN.com`**
- Its own pm2 app **`sentinal-omr`**

## Prerequisites (already present if biobid runs here)
- Node.js 18+, PostgreSQL 14+, nginx, certbot, pm2

## 1. Clone
```bash
sudo mkdir -p /var/www/sentinal-omr
sudo chown $USER:$USER /var/www/sentinal-omr
git clone https://github.com/vedvyas1012/sentinal-omr.git /var/www/sentinal-omr
cd /var/www/sentinal-omr
```

## 2. Database
```bash
sudo -u postgres createdb neet_omr
sudo -u postgres psql -c "CREATE USER sentinel WITH PASSWORD 'STRONG_PASSWORD';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE neet_omr TO sentinel;"
```
Migrations and demo users seed automatically on first start.

## 3. Environment
Create `/var/www/sentinal-omr/.env`:
```ini
NODE_ENV=production
PORT=3002
DATABASE_URL=postgresql://sentinel:STRONG_PASSWORD@localhost:5432/neet_omr
JWT_SECRET=__paste_a_long_random_string__
HUB_API_KEY=__paste_a_long_random_string__
```
Generate strong secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # HUB_API_KEY
```

### Signing keys
On first start the server generates an Ed25519 keypair at
`server/crypto/keys/` and reuses it on every restart (the folder is gitignored,
so `git pull` never deletes it). **Back this folder up** — losing the private
key means previously signed records can no longer be verified.

For a hardened setup, inject the keys via env instead and omit the files:
```ini
SIGNING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SIGNING_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
```

## 4. Install & build
```bash
npm ci
npm --prefix client ci
npm --prefix client run build   # outputs client/dist, served by Express in production
```

## 5. Start with pm2
Edit `cwd` in `deploy/ecosystem.config.js` if your path differs, then:
```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup   # run the command it prints, so it survives reboot
pm2 logs sentinal-omr   # verify: "Listening on http://localhost:3002"
```

## 6. nginx + TLS
```bash
sudo cp deploy/nginx-sentinel.conf /etc/nginx/sites-available/sentinel.YOURDOMAIN.com
# edit server_name to your real subdomain
sudo ln -s /etc/nginx/sites-available/sentinel.YOURDOMAIN.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d sentinel.YOURDOMAIN.com
```
Point an A record for `sentinel.YOURDOMAIN.com` at the server's public IP, and
forward ports 80/443 to the box if it's behind a home router.

## 7. Point the other components at the public URL
- **Mobile app** — set both URLs in `invigilator-app/src/config.js` to
  `https://sentinel.YOURDOMAIN.com`, then rebuild (EAS build) or run via Expo Go.
- **Hub agent** — on the scanner PC, set `SERVER_URL=https://sentinel.YOURDOMAIN.com`
  and the matching `HUB_API_KEY` in `hub-agent/.env`.

## 8. Verify
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sentinel.YOURDOMAIN.com/api/auth/me   # 401 = up
```
Open `https://sentinel.YOURDOMAIN.com` and log in (`mod1 / mod123`).

## Updating later
```bash
cd /var/www/sentinal-omr
git pull
npm ci && npm --prefix client ci && npm --prefix client run build
pm2 restart sentinal-omr
```

## Notes
- Cookies are `secure` + `httpOnly` in production; the app sets `trust proxy` so
  it works behind nginx. HTTPS is therefore required (certbot handles it).
- Change the seeded demo passwords before real use.
