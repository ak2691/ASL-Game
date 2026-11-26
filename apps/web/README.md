# ASL Wizard: web app

The game (React + TypeScript + Vite). How it fits together: `Tech Stack.md` at the repo root.

```
npm install
npm run dev     # http://localhost:5173 (online rooms also need the server: see server/README.md)
npm run build   # type check + production build into dist/
npm run lint
npm run sim     # practice AI ladder simulation (results go in plans/ladder-sim.md)
```

Type check alone: `npx tsc --noEmit -p tsconfig.app.json`. Add `?debug` to the URL for cast buttons and stroke
downloads (play without a camera). `?theme=pixel|cartoon|classic` switches the look.
