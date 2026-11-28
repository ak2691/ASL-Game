# Accounts: local setup

## 1. Database (once)

Creates the game's own Postgres user and database on Postgres 18 (port 5433). It asks for the `postgres`
password you set when installing Postgres; the game's password is generated and stays in `server/.env`.

```powershell
powershell -ExecutionPolicy Bypass -File server\db\setup-local.ps1
```

Restart the game server: the log no longer says "accounts are off", and the tables are made on start.

## 2. Google sign-in

1. Go to console.cloud.google.com and create a project (any name, e.g. "ASL Wizard").
2. **APIs & Services → OAuth consent screen** (now called "Google Auth Platform"): Get started. App name
   "ASL Wizard", your email as support and contact email, Audience **External**. While it's in Testing,
   only the Test users you add can sign in: add your own Google account under **Audience → Test users**.
3. **Clients → Create client**: type **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173`
   - Authorized redirect URIs: `http://localhost:5173/auth/google/callback`
4. Copy the **Client ID** and **Client secret** into `server/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

## 3. Discord sign-in

1. Go to discord.com/developers/applications → **New Application** ("ASL Wizard").
2. **OAuth2** page: copy the **Client ID**; **Reset Secret** and copy the **Client Secret**.
3. Same page, **Redirects → Add Redirect**: `http://localhost:5173/auth/discord/callback`. Save.
4. Put both into `server/.env` (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`).

## 4. Try it

Run the game server (`npm run dev --prefix server`) and the web app (`npm run dev --prefix apps/web`), open
`http://localhost:5173`, press **Sign in** (top left of home). Without keys, the **Dev sign-in** box works on
this computer (`DEV_LOGIN=1` in `server/.env`).

The secrets never go in git (`server/.env` is ignored). For AWS, the same values go into its secrets, with the
real site address in `PUBLIC_URL` and in both providers' redirect lists.
