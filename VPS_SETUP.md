# KRKN.BOT — Panduan Instalasi di VPS

Panduan lengkap untuk menjalankan KRKN.BOT di VPS Ubuntu/Debian dengan Nginx + PM2.

---

## Prasyarat

- VPS Ubuntu 22.04+ atau Debian 12+
- Minimal 1 vCPU, 1 GB RAM
- Domain (opsional, untuk HTTPS)
- Akses root atau user dengan sudo

---

## 1. Install Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # harus v24.x.x
```

## 2. Install pnpm

```bash
npm install -g pnpm@10
pnpm --version   # harus 10.x.x
```

## 3. Install PM2 dan Nginx

```bash
npm install -g pm2
sudo apt-get install -y nginx
```

## 4. Clone Proyek

```bash
git clone <URL_REPO> /opt/krkn-bot
cd /opt/krkn-bot
```

## 5. Install Dependencies

```bash
pnpm install --frozen-lockfile
```

## 6. Konfigurasi Environment Variables

Buat file `.env` untuk API server:

```bash
cat > /opt/krkn-bot/artifacts/api-server/.env << 'EOF'
NODE_ENV=production
PORT=8080

# Kraken API (wajib)
KRAKEN_API_KEY=your_kraken_api_key
KRAKEN_API_SECRET=your_kraken_api_secret

# Dashboard auth (wajib)
DASHBOARD_PASSWORD=password_dashboard_kamu
SESSION_SECRET=random_string_minimal_32_karakter

# XT.com API (opsional, isi jika pakai bot XT)
XT_API_KEY=
XT_API_SECRET=

# Telegram notifikasi (opsional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Log level (opsional, default: info)
LOG_LEVEL=info
EOF
```

> **Tips keamanan:** Pastikan file `.env` tidak bisa dibaca publik:
> ```bash
> chmod 600 /opt/krkn-bot/artifacts/api-server/.env
> ```

## 7. Build API Server

```bash
cd /opt/krkn-bot
pnpm --filter @workspace/api-server run build
```

Output: `artifacts/api-server/dist/index.mjs`

## 8. Build Frontend (Dashboard)

```bash
cd /opt/krkn-bot
BASE_PATH=/ PORT=8080 pnpm --filter @workspace/kraken-bot run build
```

Output: `artifacts/kraken-bot/dist/public/`

## 9. Jalankan API Server dengan PM2

```bash
cd /opt/krkn-bot/artifacts/api-server

pm2 start dist/index.mjs \
  --name krkn-api \
  --env-file /opt/krkn-bot/artifacts/api-server/.env \
  --node-args="--enable-source-maps" \
  -- 

pm2 save
pm2 startup   # ikuti instruksi yang muncul untuk auto-start saat boot
```

Cek status:

```bash
pm2 status
pm2 logs krkn-api
```

## 10. Konfigurasi Nginx

Buat file konfigurasi Nginx:

```bash
sudo nano /etc/nginx/sites-available/krkn-bot
```

Isi dengan (ganti `yourdomain.com` dengan IP VPS atau domain kamu):

```nginx
server {
    listen 80;
    server_name yourdomain.com;   # atau IP VPS

    # Frontend — static files dari Vite build
    root /opt/krkn-bot/artifacts/kraken-bot/dist/public;
    index index.html;

    # API — proxy ke Express server
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # SPA fallback — semua route ke index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Aktifkan dan reload:

```bash
sudo ln -s /etc/nginx/sites-available/krkn-bot /etc/nginx/sites-enabled/
sudo nginx -t       # pastikan konfigurasi valid
sudo systemctl reload nginx
```

Buka browser: `http://yourdomain.com` atau `http://IP_VPS`

---

## 11. HTTPS dengan Certbot (Opsional, Direkomendasikan)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
sudo systemctl reload nginx
```

Certbot akan otomatis memperbarui sertifikat setiap 90 hari.

---

## Perintah Operasional

| Perintah | Fungsi |
|---|---|
| `pm2 status` | Lihat status semua proses |
| `pm2 logs krkn-api` | Lihat log API server live |
| `pm2 restart krkn-api` | Restart API server |
| `pm2 stop krkn-api` | Stop API server |

---

## Update Aplikasi

```bash
cd /opt/krkn-bot
git pull

# Rebuild API server
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build

# Rebuild frontend (jika ada perubahan di frontend)
BASE_PATH=/ PORT=8080 pnpm --filter @workspace/kraken-bot run build

# Restart API
pm2 restart krkn-api

# Reload Nginx (jika konfigurasi berubah)
sudo systemctl reload nginx
```

---

## Catatan Penting

### Persistensi State Bot

Secara default, proyek ini menggunakan **Replit Object Storage** untuk menyimpan state bot (konfigurasi, fill history, logs). Di VPS, layanan ini tidak tersedia sehingga:

- State bot **tidak akan tersimpan** antar restart server
- Setelah restart, bot perlu dikonfigurasi ulang lewat dashboard
- Fill history dan logs sebelumnya tidak akan muncul kembali

Untuk persistensi di VPS, modifikasi `artifacts/api-server/src/lib/persistence.ts` agar menyimpan ke file lokal (JSON) alih-alih Google Cloud Storage.

### Auto-Start Bot di Production

Bot yang sedang berjalan **tidak akan otomatis start ulang** setelah server restart (karena state tidak tersimpan). Login ke dashboard dan klik Start setelah server restart, atau modifikasi persistensi seperti di atas.

### Firewall

```bash
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Pastikan port 8080 (API server) **tidak** dibuka ke publik — traffic ke API harus lewat Nginx.

---

## Troubleshooting

**API tidak merespons:**
```bash
pm2 logs krkn-api --lines 50
```

**Nginx 502 Bad Gateway:**
```bash
# Pastikan API server berjalan
pm2 status
curl http://127.0.0.1:8080/api/healthz
```

**Frontend blank/error:**
```bash
# Pastikan build frontend sudah dijalankan
ls /opt/krkn-bot/artifacts/kraken-bot/dist/public/
# Harus ada: index.html, assets/
```

**Port 8080 sudah terpakai:**
```bash
# Ganti PORT di .env ke port lain, misal 8081
# Update juga proxy_pass di konfigurasi Nginx
```
