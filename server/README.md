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

## Cheating and flooding

- **Drawings are read on the server.** The browser says which spell shape it read, but the server keeps the
  stroke points it was sent and reads them with the same function (`readStroke` in `shapes.ts`); its reading
  decides. The browser can still fizzle its own stroke (too short for its hand size, which only it measures).
  Tested Nov 27: 16 of 17 recorded real spell strokes read the same (the miss is a Doom right at its tip
  threshold); scribbles claimed as Doom or Meteor, and nothing drawn, fizzle.
- `npm run dev` trusts drawings (`--trust-drawings`) so the `?debug` cast buttons, which send example paths,
  still work. `npm start` always checks.
- Letters can't be checked (the server never gets video). A charge still has to follow the fight's rules.
- **Rate limit** per socket: 60 messages a second on average, bursts of 120 (a drawing player sends ~20). Extra
  messages are dropped; a socket far over is closed. At most 12 sockets per address (first `X-Forwarded-For`
  entry behind Render; this machine has no cap, for the load test).
- `STATS=1` also logs claims agreed and overruled, dropped messages, kicked and refused sockets.

## Traffic and load

- The server runs each fight 40 times a second but sends a player only the fields that changed (nothing, most
  ticks). Timers and wear go out as end times, and the browser counts them down. WebSocket compression is on.
- `npm run loadtest --prefix server -- [rooms] [2|4 players] [seconds] [url]` runs fake players that cast a line every
  few seconds and prints bytes per player, reply times, and which fields are sent most. Start the server with
  `STATS=1` to log rooms, CPU, event-loop lag and state-building time every 10 s.
- Nov 27, on a laptop (timings are rough: Windows moves long jobs to slower cores):

| Load | Per player (on the wire) | Reply time (median / p95) |
| --- | --- | --- |
| 20 rooms 1v1, before | 36 msgs/s, 1.0 KB/s (59 KB/s before compression) | 15 / 50 ms, server ~1 core |
| 20 rooms 1v1, after | 9 msgs/s, 0.2 KB/s | 2 / 5 ms, server ~0.2 core |
| 20 rooms 2v2, after | 20 msgs/s, 0.6 KB/s | 3 / 11 ms |
| 200 rooms 1v1 (400 players), after | 9 msgs/s, 0.2 KB/s | 9 / 19 ms, server ~0.8 core |
