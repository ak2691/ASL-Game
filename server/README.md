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

New **Web Service** → connect the repo, then:

| Setting | Value |
| --- | --- |
| Root directory | *(blank, repo root)* |
| Build command | `npm ci --prefix apps/web && npm run build --prefix apps/web && npm ci --prefix server` |
| Start command | `npm start --prefix server` |
| Instance type | Free |

Render sets `PORT` and gives you HTTPS, which phones need for the camera. On the free tier the service sleeps when idle, so the first visit takes up to a minute to wake it.
