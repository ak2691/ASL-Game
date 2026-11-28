# Deploying to AWS (cost first)

One small Lightsail server runs everything in Docker: **Caddy** (HTTPS) → **the game** (web app + game server,
one image) → **Postgres** (data on the server's disk, in a Docker volume). GitHub Actions checks every push and
deploys `main`.

```
players ──https/wss──> Lightsail (static IP)
                        ├─ caddy     :80 :443   certificates from Let's Encrypt, renewed automatically
                        ├─ app       :8787      the image GitHub Actions built (ghcr.io/ak2691/asl-game)
                        └─ db        (private)  Postgres 16, volume "pgdata"; nightly dump -> S3
```

## What it costs

| Item | Monthly | Notes |
| --- | --- | --- |
| Lightsail 1 GB (2 vCPU, 40 GB SSD, 2 TB transfer) | $7 | First 3 months free on one bundle. Move to 2 GB ($12) when memory gets tight. |
| Static IP | $0 | Free while attached to the instance. |
| HTTPS (Let's Encrypt via Caddy) | $0 | |
| Image registry (ghcr.io) | $0 | Free for public images; private ones have a free storage allowance. |
| GitHub Actions | $0 | Free minutes cover this easily (a run is ~3–5 min). |
| S3 backups | ~$0.01 | A few MB a night, 30 days kept. |
| Secrets Manager | $0.40 | One secret holding every setting (step 5). |
| Domain | ~$1.50 | ~$14 a year through Route 53, plus $0.50 a month for its hosted zone. |

Prices: [Lightsail pricing](https://aws.amazon.com/lightsail/pricing). Check before you start; they change.

**Why not RDS, ECS, or a load balancer?** Each costs more than the whole server (RDS from ~$15, a load balancer
~$18). Rooms and queues live in one process's memory, so there's only ever one game server anyway.

**Why Docker?** The server builds nothing: GitHub builds one image, the server pulls it. Postgres and Caddy
come as ready images (no installing or upgrading them by hand), the database is a volume, and rolling back is
running an older image tag. The cost is ~100 MB of memory, fine on 1 GB with swap.

**Why not CloudFront (yet)?** It doesn't make the game faster: the fight runs over one WebSocket to the server,
and CloudFront can't shorten that. It would cache the ~3 MB app for faraway visitors, but adds a second place
for HTTPS and hides players' real addresses behind its own (the server limits sockets per address, so that
needs extra setup). See "Later: CloudFront" at the end for when and how.

---

## 1. A domain

Buy one (or use one you have). You'll point it at the server in step 4. Phones only allow the camera on HTTPS,
so the game needs a real domain; a bare IP won't do.

## 2. The Lightsail server

1. [Lightsail console](https://lightsail.aws.amazon.com) → **Create instance**.
2. Region: closest to most players (each fight is one WebSocket, so distance is lag). Linux → **OS only →
   Ubuntu 24.04 LTS**.
3. Plan: **$7 (1 GB, dual-stack)**. Name it `asl-game`. Create.
4. **Networking** tab → **Attach static IP** (free while attached). Note the IP.
5. Same tab, **IPv4 firewall**: keep SSH (22), add **HTTP (80)** and **HTTPS (443)**. (Caddy uses 80 only to
   get certificates and redirect to HTTPS.)
6. **Snapshots** tab (optional, ~$2/month for 40 GB): turn on automatic daily snapshots for whole-server restores.
   The S3 database backups in step 8 are the cheaper must-have.

## 3. Set the server up (once)

Connect: Lightsail → the instance → **Connect using SSH** (browser), or your own SSH client with the key
Lightsail gives you. Then run these:

```bash
# Updates, and 2 GB of swap so a 1 GB server doesn't run out of memory during an image pull.
sudo apt update && sudo apt -y upgrade
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker, from Docker's own apt repository.
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu   # then log out and back in

# Security updates install themselves.
sudo apt -y install unattended-upgrades

mkdir -p ~/asl
```

## 4. DNS

Route 53 → **Hosted zones** → `aslwizard.com` → **Create record**: name empty, type **A**, value = the static IP,
TTL 300, Simple routing. (Optional: the same again with name `www`.) Leave the NS and SOA records alone.
Wait until `nslookup aslwizard.com` shows the IP (minutes, sometimes an hour). Caddy can't get a certificate
before that.

## 5. Settings in AWS Secrets Manager

All the game's settings live in **one secret** in AWS Secrets Manager ($0.40 a month for the secret; reads are
effectively free). Before each start, `fetch-secrets.sh` on the server reads it and writes `~/asl/.env`
(readable only by you), which Docker fills into `compose.yaml`. You never edit files on the server.

1. **Make the database password** (on your computer or the server):
   ```bash
   openssl rand -hex 24
   ```
   Save a copy in your password manager too. Postgres takes it when the database is first created (step 7);
   after that, changing it in the secret also needs `ALTER USER` (see "Change the database password" below).
2. **Secrets Manager** console, in your usual region → **Store a new secret** → **Other type of secret** →
   **Key/value**, one row per setting (the list is in `deploy/env.example`):

   | Key | Value |
   | --- | --- |
   | `SITE_ADDRESS` | `aslwizard.com` (with www too: `aslwizard.com, www.aslwizard.com`) |
   | `PUBLIC_URL` | `https://aslwizard.com` |
   | `POSTGRES_PASSWORD` | the value from 1 |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from the Google Cloud console |
   | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | leave out until Discord sign-in is built |
   | `BACKUP_BUCKET` | add in step 8 |

   Encryption key: the default `aws/secretsmanager`. Name it **`prod/aslwizard`**. No rotation. Store.
   (Values can't contain a single quote or a line break; generated passwords and OAuth keys never do.)
3. **Google sign-in:** in the Google Cloud console, add `https://aslwizard.com/auth/google/callback` to the OAuth
   client's **Authorized redirect URIs**.
4. **A key for the server.** Lightsail can't use AWS's built-in instance permissions, so the server gets its own
   IAM user, allowed only to read this secret (and, in step 8, write backups):
   - IAM console → **Users → Create user** `aslwizard-server`, no console access → Create.
   - The user → **Add permissions → Create inline policy → JSON**, paste (your region and account id; the
     secret's full ARN is on its Secrets Manager page, the `-*` covers the random letters AWS adds):
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
           "Resource": "arn:aws:secretsmanager:<region>:<account id>:secret:prod/aslwizard-*" }
       ]
     }
     ```
     Name it `aslwizard-read-settings`.
   - The user → **Security credentials → Create access key** → "Application running outside AWS". Copy both
     parts now (the secret part is shown once).
5. **On the server**, install the AWS command line and give it that key:
   ```bash
   sudo snap install aws-cli --classic
   aws configure          # the key from 4; region = the secret's region; output: json
   ```
   Check (after step 7 has copied the scripts there, or copy `deploy/fetch-secrets.sh` to `~/asl` yourself):
   ```bash
   ~/asl/fetch-secrets.sh   # "wrote .env from prod/aslwizard (N settings)"
   ```

**Change a setting later:** edit the secret's value in the console, then deploy (or run `~/asl/update.sh` on the
server). Nothing is read from the secret while the game runs, only at each start.

**Change the database password** (rarely): set the new one inside Postgres first, then in the secret, then update:
```bash
cd ~/asl && docker compose exec db psql -U aslwizard -c "ALTER USER aslwizard PASSWORD '<new>'"
# edit POSTGRES_PASSWORD in the secret, then:
./update.sh
```

## 6. GitHub: let the server pull the image

The deploy workflow pushes the image to `ghcr.io/ak2691/asl-game`. After the first run (step 7), either:
- **make the package public** (GitHub → your profile → Packages → asl-game → Package settings → Change
  visibility). There's nothing secret in it: the settings live in Secrets Manager. Simplest, or
- keep it private and log the server in once: create a classic token with only `read:packages`, then on the
  server `echo <token> | docker login ghcr.io -u ak2691 --password-stdin`.

## 7. GitHub Actions

The workflows are in `.github/workflows/`:
- **CI** (`ci.yml`), on every push and pull request: lint, typecheck and build the web app, build the Docker
  image, start it and check it answers.
- **Deploy** (`deploy.yml`), on every push to `main` (or the Run workflow button): the same checks, then the image
  goes to ghcr.io tagged with the commit, then the server runs `update.sh`: it **waits until no match is being
  played** (up to 10 min; a restart ends matches in progress), pulls the image, restarts the game, and checks
  it's healthy.

Set it up:

1. A key just for deploys, on your own computer:
   ```powershell
   ssh-keygen -t ed25519 -f asl-deploy -N '""' -C "github-deploy"
   ```
   Put the contents of `asl-deploy.pub` on its own line in the server's `~/.ssh/authorized_keys`.
2. The server's fingerprint, so the workflow knows it's talking to your server:
   ```powershell
   ssh-keyscan <static IP>
   ```
3. GitHub repo → **Settings → Environments → New environment** `production`. Add yourself under **Required
   reviewers**: each deploy then waits for your OK (so you choose when matches get interrupted).
   Then add these **environment secrets**:

   | Secret | Value |
   | --- | --- |
   | `DEPLOY_HOST` | the static IP (or the domain) |
   | `DEPLOY_USER` | `ubuntu` |
   | `DEPLOY_SSH_KEY` | the whole `asl-deploy` file (the private key) |
   | `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan` |

   Then delete `asl-deploy` from your computer, or keep it somewhere safe.
4. Merge to `main` (or Actions → Deploy → Run workflow). The first run copies `compose.yaml`, `Caddyfile` and the
   scripts to `~/asl` and starts everything. Open `https://<domain>`: the certificate is fetched on the first
   visit (a few seconds).

Check on the server any time:

```bash
cd ~/asl
docker compose ps                 # all three up; app "healthy"
docker compose logs -f app        # the game's log
docker compose exec app wget -qO- localhost:8787/healthz   # {"ok":true,"busy":<matches running>,"db":true}
```

## 8. Database backups

The database is the `pgdata` volume on the server's disk. It survives restarts and deploys. **Never run
`docker compose down -v`**: `-v` deletes it.

Nightly dumps to S3 (pennies):

1. S3 console → **Create bucket** (e.g. `aslwizard-backups-<random>`), same region, everything else default
   (private). **Management → Lifecycle rule**: expire objects after 30 days.
2. IAM → the `aslwizard-server` user from step 5 → **Add permissions → Create inline policy → JSON**, only allowed
   to add files to that bucket:
   ```json
   { "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::<bucket>/db/*" }] }
   ```
   Name it `aslwizard-write-backups`.
3. Add `BACKUP_BUCKET` = the bucket name to the `prod/aslwizard` secret, then on the server:
   ```bash
   ~/asl/fetch-secrets.sh             # picks up BACKUP_BUCKET
   ~/asl/backup.sh                    # try it once: "backup ok: ..."
   (crontab -l 2>/dev/null; echo '17 4 * * * $HOME/asl/backup.sh >> $HOME/asl/backup.log 2>&1') | crontab -
   ```
   Each night at 04:17 (server time): a dump in `~/asl/backups` (last 14 kept) and a copy in S3.

**Restore** (replaces the current data; stop the game first):

```bash
cd ~/asl
docker compose stop app
docker compose exec -T db psql -U aslwizard -d postgres -c "DROP DATABASE aslwizard WITH (FORCE)" -c "CREATE DATABASE aslwizard OWNER aslwizard"
gunzip -c backups/aslwizard-YYYYMMDD-HHMM.sql.gz | docker compose exec -T db psql -U aslwizard -d aslwizard
docker compose start app
```

(From S3: download the file in the S3 console and copy it to the server, since the server's key can only add
backups, not read them.)

## 9. Day to day

- **Roll back**: Actions → an older successful Deploy run shows its tag (12 characters of the commit). On the
  server: `~/asl/update.sh <that tag>`.
- **Change settings**: edit the `prod/aslwizard` secret, then deploy or run `~/asl/update.sh` (step 5).
- **Disk**: `df -h`. Logs are capped (10 MB × 3 per container); old images are pruned on each deploy.
- **Alerts** (free): Lightsail → the instance → **Metrics** → add alarms for CPU and for status check failures,
  with email notification.
- **Bigger server**: Lightsail → Snapshots → create one → create a new instance from it on the $12 plan → move the
  static IP to it. The database comes along (it's on the disk).

## Later: CloudFront

Worth it when many players are far from the server's region, or when the bandwidth from the app's files starts
to matter (CloudFront's free tier: 1 TB and 10 million requests a month). Then:

1. A certificate for the domain in **ACM, us-east-1** (DNS validation). Free.
2. A CloudFront distribution: origin = the server's domain on HTTPS (Caddy keeps its own certificate, so the
   hop from CloudFront to the server stays encrypted). Behaviors: `/assets/*` cached (the "CachingOptimized"
   policy); everything else, including `/ws`, `/api/*`, `/auth/*`, **not cached** ("CachingDisabled") and with
   all headers, cookies and query strings forwarded ("AllViewer"). WebSockets work through CloudFront.
3. Point the domain at the distribution instead of the IP (an origin name like `origin.<domain>` keeps
   pointing at the server for CloudFront).
4. Real player addresses: tell Caddy to trust CloudFront's `X-Forwarded-For` (Caddy's `trusted_proxies` with
   CloudFront's published address ranges), or every player looks like a handful of CloudFront addresses and the
   12-sockets-per-address limit starts refusing people.
