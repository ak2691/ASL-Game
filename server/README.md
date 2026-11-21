# Game server

Rooms with 4-letter codes and the authoritative fight (HP, shields, traps, timing) over one WebSocket per player at `/ws`. It also serves the built web app, so one service hosts everything.

## Run locally

```
npm install --prefix server
npm run dev --prefix server        # game server on :8787
npm run dev --prefix apps/web      # web app; Vite forwards /ws to :8787
```

Test online play with two tabs. Add `?debug` to the URL to get cast buttons, so a tab can play without a camera.

## Deploy on Render

Easiest: **New → Blueprint** → pick the repo. It reads `render.yaml` (free plan, Node 20, build and start commands below).

Or by hand: **New Web Service** → connect the repo, then:

| Setting | Value |
| --- | --- |
| Root directory | *(blank, repo root)* |
| Build command | `npm ci --prefix apps/web && npm run build --prefix apps/web && npm ci --prefix server` |
| Start command | `npm start --prefix server` |
| Instance type | Free |

Render sets `PORT` and gives you HTTPS, which phones need for the camera. Node 20 is pinned by `.node-version`.

What to expect on the free tier:
- **It sleeps after ~15 min with no visitors.** The first visit then takes up to a minute to wake it. Open the site a minute before friends join.
- **Rooms live in memory.** A restart or redeploy ends every match in progress. Don't deploy while people are playing.
- **One instance only.** Rooms are in this process's memory, so never scale it past one instance.
- Many rooms can run at once (tested: 20 rooms, 40 players).

## Connections

- Each player is identified by a token kept in their tab, so a refresh or a dropped connection rejoins the same seat within 15 s; the fight pauses meanwhile.
- A heartbeat pings every 20 s: a connection that dies silently (a phone losing signal) is noticed within 20–40 s, then gets the same 15 s grace.
- A bad message, or an error in one room, is logged and never stops the server.
