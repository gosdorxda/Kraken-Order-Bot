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

## 4. Salin Proyek ke VPS

```bash
# Opsi A: git clone dari remote
git clone <URL_REPO> /opt/krkn-bot
cd /opt/krkn-bot
```

Opsi B — upload folder proyek dari komputer Windows lokal (jalankan di PowerShell lokal, BUKAN di VPS):

```powershell
# compress dulu tanpa node_modules & .git
scp -r C:\Users\gosdo\Desktop\AI\Bot root@IP_VPS:/opt/krkn-bot
```

## 5. Install Dependencies

```bash
cd /opt/krkn-bot
pnpm install --frozen-lockfile
```

## 6. Konfigurasi Environment Variables

File `.env` dibaca dari **root proyek** `/opt/krkn-bot/.env` (lihat `src/index.ts` yang memuat dotenv dari path tersebut — bukan di dalam `artifacts/api-server/`):

```bash
cat > /opt/krkn-bot/.env << 'EOF'
NODE_ENV=production
PORT=8080

# Kraken API (wajib)
KRAKEN_API_KEY=your_kraken_api_key
KRAKEN_API_SECRET=your_kraken_api_secret

# XT.com API (opsional, isi jika pakai bot XT)
XT_API_KEY=
XT_API_SECRET=

# MEXC API (opsional, isi jika pakai bot MEXC)
MEXC_API_KEY=
MEXC_API_SECRET=

# Dashboard auth (wajib)
DASHBOARD_PASSWORD=password_dashboard_kamu
SESSION_SECRET=random_string_minimal_32_karakter

# Telegram notifikasi (opsional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Log level (opsional, default: info)
LOG_LEVEL=info
EOF
```

> **Tips keamanan:** Pastikan file `.env` tidak bisa dibaca publik:
> ```bash
> chmod 600 /opt/krkn-bot/.env
> ```
>
> Generate `SESSION_SECRET` yang kuat: `openssl rand -hex 32`

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

pm2 start dist/index.mjs --name krkn-api --node-args="--enable-source-maps"

pm2 save
pm2 startup   # ikuti instruksi yang muncul untuk auto-start saat boot
```

> `.env` tidak perlu di-flag karena `src/index.ts` sudah memuatnya otomatis dari `/opt/krkn-bot/.env`.

Cek status:

```bash
pm2 status
pm2 logs krkn-api
```

## 10. Konfigurasi Nginx (berdampingan dengan proyek lain)

File konfigurasi siap pakai sudah ada di repo: `deploy/nginx-krkn-bot.conf`.

Jika VPS sudah menjalankan proyek lain (mis. `arbit` di `/opt/arbit` dengan domain `arbitin.website`), krkn-bot **tidak mengganggu** selama:
1. Memakai **subdomain sendiri** (dipakai di panduan ini: `krkn.vooi.lol`)
2. Memakai **port backend sendiri** (default `8080`)

Langkah:

```bash
# a. Tambah DNS record A untuk subdomain di panel domain vooi.lol:
#    krkn  →  IP_VPS  (type A, TTL auto)
#    Tunggu propagasi (biasanya < 5 menit). Cek dengan:
dig +short krkn.vooi.lol

# b. Salin config (sudah di-set ke krkn.vooi.lol)
sudo cp /opt/krkn-bot/deploy/nginx-krkn-bot.conf /etc/nginx/sites-available/krkn-bot

# c. Aktifkan & tes
sudo ln -s /etc/nginx/sites-available/krkn-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

File `sites-enabled/arbit` milik proyek lama **tidak diubah sama sekali**.

Verifikasi cepat:
```bash
curl -s http://127.0.0.1:8080/api/healthz        # harus: {"status":"ok"}
curl -s -H "Host: krkn.vooi.lol" http://127.0.0.1/ | head -5   # harus: HTML dashboard
```

---

## 11. HTTPS dengan Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d krkn.vooi.lol
sudo systemctl reload nginx
```

Certbot otomatis menambah blok `listen 443 ssl` + redirect 80→443 di file `krkn-bot`, persis seperti yang sudah terjadi pada `arbit`. Sertifikat diperpanjang otomatis.

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

State bot (konfigurasi, fill history, logs) disimpan ke **file JSON lokal**, bukan cloud storage. Path default:

```
/var/lib/krkn-bot/data/state.json
```

Bisa diubah lewat env `DATA_PATH`:

```bash
DATA_PATH=/opt/krkn-bot/data/state.json
```

Folder dibuat otomatis jika belum ada. Disarankan set `DATA_PATH` ke folder di dalam `/opt/krkn-bot/data` agar ikut ter-backup bersama proyek.

### Auto-Start Bot di Production

Bot yang sedang running akan **otomatis start ulang** saat API server restart, karena state-nya dipulihkan dari `state.json` (`BotManager.initialize()`). Sebelum memulai, BotManager juga membatalkan order buy yang masih terbuka di tiap exchange untuk mencegah order ganda.

Catatan: auto-start hanya berlaku saat `NODE_ENV=production`. Di mode development, bot tidak di-autostart (harus diklik Start manual).

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
