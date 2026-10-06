# Lenis Platform — Production Deployment Guide

This guide walks through deploying the Lenis Web3 Financial Infrastructure
platform to a production server (tested on Google Compute Engine running
Ubuntu 22.04 LTS, but applicable to any Linux host with Docker).

---

## 1. Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Docker Engine | 24.x | Install via `apt-get install docker-ce` |
| Docker Compose v2 | Bundled with Docker Desktop; `docker compose` (no hyphen) | Use `docker compose version` to verify |
| `certbot` | Any recent release | Used to obtain Let's Encrypt TLS certificates |
| `git` | 2.x | For cloning the repository |

On a fresh Debian/Ubuntu server:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in

# Certbot
sudo apt-get install -y certbot

# Git
sudo apt-get install -y git
```

---

## 2. Required Environment Variables

Copy `.env.example` to `.env` and fill in every value before starting the
stack. The table below documents all variables.

| Name | Description | Example |
|------|-------------|---------|
| `APP_NAME` | Human-readable application name shown in emails and UI | `Lenis` |
| `APP_ENV` | Runtime environment — controls logging format, debug features | `production` |
| `DEBUG` | Enable FastAPI interactive docs and verbose errors | `false` |
| `DATABASE_URL` | Async SQLAlchemy connection string (use `asyncpg` in production) | `postgresql+asyncpg://lenis:secret@postgres:5432/lenis` |
| `REDIS_URL` | Redis connection URL (general cache & rate-limit state) | `redis://redis:6379/0` |
| `CELERY_BROKER_URL` | Redis URL for Celery task queue | `redis://redis:6379/1` |
| `CELERY_RESULT_BACKEND` | Redis URL for Celery result storage | `redis://redis:6379/2` |
| `JWT_PRIVATE_KEY` | RSA-2048 private key (PEM, `\n` escaped) for signing JWT access tokens | *(output of `generate_keypair.py`)* |
| `JWT_PUBLIC_KEY` | RSA-2048 public key (PEM, `\n` escaped) for verifying JWT access tokens | *(output of `generate_keypair.py`)* |
| `JWT_ALGORITHM` | JWT signing algorithm — must be `RS256` | `RS256` |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL in minutes | `15` |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token TTL in days | `7` |
| `JWT_ISSUER` | JWT `iss` claim | `lenis` |
| `JWT_AUDIENCE` | JWT `aud` claim | `lenis-api` |
| `SMTP_HOST` | SMTP server hostname | `smtp.sendgrid.net` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username / API key login | `apikey` |
| `SMTP_PASS` | SMTP password / API key value | `SG.xxxx` |
| `SMTP_FROM_ADDRESS` | Sender email address | `noreply@lenis.io` |
| `SMTP_FROM_NAME` | Sender display name | `Lenis Pay` |
| `SMTP_TLS` | Use implicit TLS (port 465) | `false` |
| `SMTP_START_TLS` | Use STARTTLS (port 587) | `true` |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | Max requests per IP per minute on auth endpoints | `10` |
| `LOGIN_FAILURE_MAX_ATTEMPTS` | Consecutive failures before IP lockout | `5` |
| `LOGIN_FAILURE_WINDOW_SECONDS` | Sliding window for failure counting | `600` |
| `LOGIN_BLOCK_TTL_SECONDS` | IP lockout duration in seconds | `900` |
| `FRONTEND_ORIGIN` | Allowed CORS origin for the frontend SPA | `https://app.lenis.io` |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia testnet RPC endpoint | `https://sepolia.base.org` |
| `POLYGON_MUMBAI_RPC_URL` | Polygon Mumbai testnet RPC endpoint | `https://rpc-mumbai.maticvigil.com` |
| `ARBITRUM_SEPOLIA_RPC_URL` | Arbitrum Sepolia testnet RPC endpoint | *(provider URL)* |
| `OPTIMISM_SEPOLIA_RPC_URL` | Optimism Sepolia testnet RPC endpoint | *(provider URL)* |
| `ETHEREUM_SEPOLIA_RPC_URL` | Ethereum Sepolia testnet RPC endpoint | *(provider URL)* |
| `TESTNET_MODE` | Route payments to testnet chains instead of mainnet | `false` |
| `BLOCKCHAIN_WEBHOOK_SECRET` | HMAC-SHA256 secret shared with Alchemy / QuickNode for signature verification | *(random hex string)* |
| `INDEXER_POLLING_ENABLED` | Enable the 15-second Celery beat polling fallback for on-chain events | `false` |
| `WEBHOOK_ENCRYPTION_KEY` | 32-byte AES-GCM key (base64-encoded) for encrypting webhook secrets at rest | *(see generation command below)* |
| `COINGECKO_API_KEY` | CoinGecko Demo API key for fiat price oracle (optional, but raises rate limits) | `CG-xxxx` |
| `UPLOAD_STORAGE` | Storage backend for merchant document uploads — `local` or `s3` | `s3` |
| `AWS_S3_BUCKET` | S3 bucket name for file uploads | `lenis-uploads-prod` |
| `AWS_ACCESS_KEY_ID` | AWS IAM access key ID with `s3:PutObject` / `s3:GetObject` permissions | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret access key | *(IAM secret)* |
| `AWS_REGION` | AWS region where the S3 bucket resides | `us-east-1` |
| `POSTGRES_DB` | PostgreSQL database name (used by the `postgres` Docker service) | `lenis` |
| `POSTGRES_USER` | PostgreSQL username | `lenis` |
| `POSTGRES_PASSWORD` | PostgreSQL password | *(strong random password)* |

---

## 3. Initial Deployment Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-org/lenis.git
cd lenis

# 2. Copy and populate the environment file
cp .env.example .env
nano .env   # fill in every required value

# 3. Generate the RS256 JWT key pair
python scripts/generate_keypair.py
# Paste the printed private and public keys into .env as
# JWT_PRIVATE_KEY and JWT_PUBLIC_KEY (replace literal newlines with \n)

# 4. Generate the webhook encryption key (must be exactly 32 random bytes)
python -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())"
# Paste the output into .env as WEBHOOK_ENCRYPTION_KEY

# 5. Build all images
docker compose -f docker-compose.prod.yml build

# 6. Start the data stores first and wait for them to be ready
docker compose -f docker-compose.prod.yml up -d postgres redis
sleep 10   # give PostgreSQL a moment to initialise

# 7. Run database migrations
docker compose -f docker-compose.prod.yml run --rm app alembic upgrade head

# 8. Bring up the full stack
docker compose -f docker-compose.prod.yml up -d
```

---

## 4. TLS Setup with Let's Encrypt

Stop any service on port 80 before running certbot standalone mode.

```bash
# Obtain a certificate (replace yourdomain.com with your actual domain)
sudo certbot certonly --standalone -d yourdomain.com

# The certificate files will be written to:
#   /etc/letsencrypt/live/yourdomain.com/fullchain.pem
#   /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

Create `nginx/prod.conf` (nginx reads this from inside the container):

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass         http://app:8000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Set up automatic renewal via cron:

```bash
# Edit root crontab
sudo crontab -e

# Add this line to renew at 02:30 AM on the 1st and 15th of every month.
# After renewal, reload nginx so it picks up the new certificate.
30 2 1,15 * * certbot renew --quiet && docker compose -f /path/to/lenis/docker-compose.prod.yml exec nginx nginx -s reload
```

---

## 5. GCE Firewall Rules

If running on Google Compute Engine, open the required ports:

```bash
gcloud compute firewall-rules create lenis-http \
    --allow tcp:80 \
    --description "Allow HTTP traffic for Lenis (ACME / redirect)" \
    --target-tags lenis-server

gcloud compute firewall-rules create lenis-https \
    --allow tcp:443 \
    --description "Allow HTTPS traffic for Lenis" \
    --target-tags lenis-server
```

Then add the `lenis-server` network tag to your GCE instance:

```bash
gcloud compute instances add-tags YOUR_INSTANCE_NAME --tags lenis-server
```

---

## 6. Health Check Verification

After the stack is up, verify all services are healthy:

```bash
# Liveness probe — always fast, no DB/Redis calls
curl https://yourdomain.com/health
# Expected: {"status":"ok"}

# Readiness probe — checks PostgreSQL and Redis connectivity
curl https://yourdomain.com/ready
# Expected: {"status":"ok","db":"ok","redis":"ok"}
```

If the readiness probe returns `503` with `"db":"error"` or `"redis":"error"`,
inspect the relevant container logs:

```bash
docker compose -f docker-compose.prod.yml logs postgres
docker compose -f docker-compose.prod.yml logs redis
```

---

## 7. libmagic Note

The Docker image installs `libmagic1` via `apt-get` during the build (see
`Dockerfile`). In production, `python-magic` uses this system library for
server-side MIME type validation of all uploaded files — the lightweight
byte-header fallback used in development is intentionally **disabled** in
production (Requirement 16.4).

If libmagic is not available at startup (e.g., a custom base image that omits
it), the application will log a critical error and **exit with code 1** rather
than silently accepting potentially spoofed file types. Ensure the Docker image
is built correctly before deploying.

To verify inside a running container:

```bash
docker compose -f docker-compose.prod.yml exec app python -c "import magic; print(magic.from_buffer(b'%PDF', mime=True))"
# Expected output: application/pdf
```

---

## 8. Updating the Application

```bash
# 1. Pull the latest code
git pull origin main

# 2. Rebuild images (only changed layers are rebuilt)
docker compose -f docker-compose.prod.yml build

# 3. Apply any new database migrations
docker compose -f docker-compose.prod.yml run --rm app alembic upgrade head

# 4. Restart services with zero-downtime rolling update
docker compose -f docker-compose.prod.yml up -d
```

Docker Compose will restart only the containers whose image or configuration
changed, keeping Redis and PostgreSQL running throughout.
