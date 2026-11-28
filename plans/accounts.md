# Accounts, matchmaking and social: design (draft, Nov 27 2026)

For the `usersandmatchmaking` branch. Nothing here is built yet. Mockups: `plans/mockups/accounts.html`.
**Decided** lines were confirmed Nov 27 (the recommended option each time).

## What changes for players

- **Guests keep everything they have today:** Tower, Training, Tutorial, Custom games, and Casual quick match.
  An account is needed for **Ranked**, a profile, friends, and keeping progress across devices.
- Home: **Duel** becomes **Play**, with three tabs: **Casual**, **Ranked**, **Custom** (today's room codes).
  A profile corner (portrait, name, rank) and a Friends button sit on the home screen.

## Signing in

- **Decided (Nov 27): sign in with Google or Discord only (no passwords)**, or add email + password later.
  - No passwords means nothing to leak, no reset emails, no password rules. Discord fits a game audience.
  - Done on our own Node server with a small OAuth library (`arctic`) rather than a hosted service, so the
    whole flow is ours to explain. AWS Cognito is the alternative if we want it on the resume.
- After sign-in: pick a **username** (3-16 letters, numbers, `_`; unique; changeable every 30 days) and a
  **portrait**: everyone starts as the Apprentice; each Tower wizard you beat unlocks theirs (built Nov 27; Tower
  progress is kept in the browser and on the account, merged on sign-in).

## Sessions: how the server knows a message is really you

**Stateful** (built Nov 27): a session is a row in Postgres; the browser holds only a random token. Sign-out (and
"everywhere") kills a session at once, which stateless tokens (JWTs) can't do without a blocklist. Cost: one
indexed lookup per page load and per socket connect; fights never touch the database.

- After OAuth, the server makes a **session**: 32 random bytes, sent as a cookie that is `HttpOnly` (page
  scripts can't read it, so an injected script can't steal it), `Secure` (HTTPS only), `SameSite=Lax`.
  The database stores only its SHA-256 hash, so a leaked database can't be used to log in. 30-day expiry,
  renewed while you play; "Log out everywhere" deletes them all.
- **The WebSocket is authenticated once, at connect.** The browser sends the cookie with the upgrade request
  (same site). The server looks it up and binds that user to the socket. Every message on the socket is then
  from that user: the connection is TLS (`wss://`), so nobody else can inject into it.
- **Messages never say who you are.** No user id or seat in any game message; the server takes both from the
  socket. Each action is still checked: you're in that room, it's your seat, the phase allows it, the fight's
  rules allow it (already true today).
- **Origin check** on the WebSocket upgrade and on every form/API request: only our own site may open a socket
  with your cookie (stops another site from opening one in your name).
- One game socket per account: a second tab or device takes over the seat and the old one is closed (as today's
  rejoin token does).
- Rate limits on sign-in and the HTTP API, like the socket's.

## Anti-cheat (v1: simple)

Already done: the server runs the fight (HP, damage, statuses, timing); silenced, locked, fizzled or staggered
players are refused by the server, not the browser; drawings are read on the server; message rate limits.
Add for ranked:
- **Letter plausibility:** the server can't see video, so it checks timing only: a minimum time between
  letter changes and between a charge and its throw (from real play data). Too fast gets refused and counted.
- **Flags, not bans:** superhuman stats (cast speed, perfect parries) and overruled drawings are logged per
  account for a look by hand. Plus a **Report** button after a match.
- **Smurf brake:** an account needs 5 casual matches before Ranked unlocks.

## Matchmaking

- **Decided (Nov 27): parties.** Make a party, invite a friend from the friend list or share a party code (the same
  4-letter code look as today's rooms). The leader queues; party of up to 2. Solo players can queue 2v2 and
  get a random teammate.
  - Alternative: code lobbies only (Duo Tower style). Simpler, but no friend invites and no solo 2v2 queue.
- Queues: **Casual 1v1, Casual 2v2, Ranked 1v1, Ranked 2v2.**
- **Guests (decided Nov 27, chess.com style):** a unique name like `Guest38291` (kept per tab), Casual only, and
  only matched with other guests. Custom rooms with a code stay open to guests and accounts together (invite a
  friend who hasn't signed up); those games are never rated and guests aren't recorded.
- **Camera (changed Nov 27):** queueing doesn't use the camera. Every online match (Custom and Duo Tower too,
  Nov 28) starts with a 20 s setup
  countdown: the camera turns on, and each player presses Ready once it's running; when all are ready it drops to
  3 s (AFK players are already caught by the Accept). No best of 3 for now.
- **Built Nov 27 (Casual 1v1):** a first-come queue (no rating yet), "Match found" with a 10 s Accept, the room
  starts at once (`server/index.ts`, "Quick match"). After the fight it's a normal room (Rematch or Leave).
- **Built Nov 27 (parties, 2v2, quick chat):** a party is 2 players with a code (Play menu, under the queue);
  the leader queues 2v2 for both (a party of 2 can't queue 1v1). 2v2 matches party vs party first, then a party
  vs two solos, then four solos (strongest with weakest). Ranked 2v2 has its own rating (`ranked2v2`), each
  player rated against the other team's average. A member gone 60 s leaves the party; whoever stays keeps the
  code. Quick chat: 6 preset lines from the pause menu, shown 4 s under the sender's name, 1.5 s apart at
  most, with Mute chat. Not yet: ASL sign emotes for the lines, friend invites.
- Matching by rating, closest first, in a window that widens while you wait: ±50 at first, +50 every 10 s,
  capped at ±400 (reached at 70 s; changed Nov 27, was ±100 and anyone after 60 s).
- Casual (Nov 27): a hidden rating (`ratings` queue `casual`, Glicko-2, updated after queued Casual matches between
  accounts; guests sit at 1500), matched the same way but speed first: ±200, +100 every 5 s, anyone after 20 s.
- Ranked 2v2 teammates (Nov 27): at most 400 apart. A party further apart can't queue Ranked; solos are
  only put together within 400, split the fairest way. Casual has no such limit.
- Not the same opponent twice in a row when anyone else is close. 2v2: a team's rating is its average;
  parties prefer parties.
- **Match found:** a 10 s Accept. Declining or missing it twice puts you out of the queue for 2 minutes.
- Leaving or disconnecting for good mid-match counts as a loss (the 15 s rejoin grace stays).

## Rating

- **Glicko-2** under the hood: a rating plus how sure it is, so new players move fast and settle down.
  Separate ratings for 1v1 and 2v2 (2v2: your own rating, updated from team averages). Casual has a hidden
  rating of its own, used only to match.
- **Open (Nov 27): how ranks look.** Placement matches (5) are decided; the display isn't. Glicko-2 runs
  underneath either way, so this is only what players see, and can be settled any time before Ranked ships.
  - Wizard tiers (Apprentice, Adept, Conjurer, Sorcerer, Archmage; Grand Archmage for the top 100): fits the game.
  - Metal tiers (Bronze, Silver, Gold, Platinum, Diamond): everyone reads them at once, but generic.
  - The number only (chess style): honest and simple, least to design, but less of a goal to chase.
- Wins show `+18`, losses `-15`, at the result screen. A fight always has a winner, so no draws; a forfeit
  is a loss. Seasons later.

## Profile

What anyone can see:
- Portrait, username, tier and rating for each ranked queue, peak tier, member since.
- **Match record:** wins, losses, win rate, best win streak (Ranked and Casual).
- **Spellcasting** (the ASL part, the stats no other game has):
  - Fastest cast: sign to throw, in seconds (best and average).
  - Favorite element and most-cast spell, in their colors.
  - Letters signed, spells drawn, drawings that read right (%).
  - Parries landed, counterspells landed, Dooms survived.
- **Tower:** wizards beaten in the Tower (of the ladder), highest Duo Tower floor.
- **Badges** (a few for v1): First Win, Reflected a Meteor, 10 parries in one match, Beat Lady Glass,
  Won without healing.
- **Recent matches:** last 20: result, mode, opponent(s), rating change, the spell that ended it.

Kept private: the email and sign-in provider. No video is ever stored or sent (unchanged).

**Built Nov 27 (step 5):** every online match except Duo Tower is saved when it ends (`matches`, `match_players`
in `server/db/schema.sql`): mode, size, start and end, how it ended (knockout, forfeit, left), the finishing spell,
and per player the account (or the guest's name), team, win, and stats counted by `Combat` (`FighterStats`: casts
per element and spell, fastest and average charge-to-throw, drawings read, fizzles, parries, stuns landed, damage
dealt and taken, healing). `GET /api/matches` returns your last 20.

**Built Nov 27 (profile):** `GET /api/profile?name=` (public) totals every saved match; `ProfilePage.tsx` shows it
as the signed-in account page (Edit wizard opens the name and portrait form). Opponents' names open their profiles.
Badges for now: First Win, Ten Parries, No Heals Needed, Beat Lady Glass. Not yet: Reflected a Meteor, Dooms
survived, Duo Tower floor (still only in the browser), Ranked 2v2.

## Friends and chat

- Friends: add by username, accept or decline requests, remove, block. The list shows online, in queue,
  in a match. Invite to party from the list.
- **Decided (Nov 27): no free text with strangers in v1.** In matches: **quick chat** with preset lines (Good game,
  Nice parry, Well played, Oops) shown as **ASL sign emotes** (the GG sign, a thumbs up). Free text only
  between friends, with block and report. ASL learners include kids, and strangers' chat needs moderation
  we don't have.
  - Alternative: free text everywhere with a word filter.

**Built Nov 27 (friends; text chat removed Nov 28):** a Friends button on Home (number = friend requests) opens the
Friends page: find wizards by name, add, accept or decline, the list with Online / Finding a match / In a match /
Offline. Tapping a wizard opens their profile with Invite to party, Remove, Block, Report. **No text chat anywhere**
(Nov 28: only the quick chat lines in matches; nothing to moderate). The app keeps its own small socket for this
while signed in (`friends.ts`, server `social.ts`), so presence and invites are live. An invite pops up on Home and
in the Play menu's Party box (Join). Expired sessions are removed hourly (`cleanUp` in `server/db.ts`).
Profiles (Nov 28): no badges, no fastest or average cast (it depends on the spell, not the player), no favorite
element or most-cast spell (it tells opponents what you throw), no "Ended by" in match lines. Pictures: the first
letter of the name on a color from the name (`Avatar.tsx`) until uploaded pictures and a drawn default exist;
the AI wizard portraits stay only for the Tower's opponents. Sign-in: Google only for now.
Tier badges (Nov 28): rune sigils (`RankBadge` in `PlayMenu.tsx`), style A "Breaking the seal" from
`plans/mockups/rank-sigils.html`, no animation: the circle's inner shape gains a side per tier (3, 4, 5, 6, 8), an
inner ring from Apprentice, runes from Mage; points break out of the circle as you climb (4 small, 4 long, 8, then
16 in two lengths); 1-3 marks inside at the top for the division; dashed grey before placement. Archmage's color
stays the current pale blue (Nov 28: other colors and pairs were mocked up and passed on).
Names (Nov 28): fights and the setup card show everyone's real name (yours too, no "You"); long names end in "…"
(checked with 16-letter names in 2v2 on desktop and phone). The room list has no "You" tag (your seat is outlined);
HP is a small box on the right and Ready a check. Home's account button is a plain person icon with your name.
2v2 teammate view (Nov 28): while your teammate casts, their card shows a small live view of their stroke and
what it is (element, spell, and who it's aimed at once ready); otherwise the card is one compact row.
Phones (portrait, and landscape under 500 px tall): a narrow (about 44% wide), slightly see-through teammate card at the bottom left of your half:
name cut to ~9 characters, HP number at the far right, then their drawing (always fitted whole) with the shortest
label bottom left: "F" or "Mag F+E" while charging; once ready the shape too and the side, "F Counter → R". No status
icons or power there; hits still flash on it. Your own drawing paints above it (video and drawing are mirrored
separately so the card sits between them). The drawing's height is the "Teammate view" setting (default 72 px);
on desktop the same setting sizes the card's drawing.

**Performance pass (Nov 27):** profiles read one `player_totals` row (updated as each match is saved;
`server/totals.ts`, filled in for older matches at start) plus the last 20 matches by index. Name search
(`/api/search`, from 2 letters, 20 results, prefix index) on the Friends page. Ranked unlock reads the totals,
not a count of matches. Queue: one line per mode/size/guests, token lookups by map, Ranked matched by rating
neighbours (sorted, walk out until past the window) instead of every pair; 2v2 tries 7 rating neighbours of the
10 oldest. Sockets by token / user are maps, not scans. Every hot query checked with EXPLAIN to use an index.

## Data (Postgres)

`users` (id, username, portrait, created), `identities` (provider, provider id → user), `sessions`
(hash, user, expires), `ratings` (user, queue, rating, deviation, volatility, games), `matches` and
`match_players` (team, rating before/after, per-match stats), `friends` (pair, status), `blocks`, `reports`,
`progress` (Tower and Duo Tower: moves from localStorage to the account on sign-in).

## Hosting (with this branch)

**Set up Nov 27 (cost first):** one Lightsail server ($7, 1 GB) running Docker Compose: Caddy (HTTPS via
Let's Encrypt) → the game image → Postgres in a volume, nightly dumps to S3. GitHub Actions: CI on every push
(lint, build, image smoke test); Deploy on `main` pushes the image to ghcr.io and runs `deploy/update.sh` on the
server, which waits for running matches to end. Settings live in one AWS Secrets Manager secret (`prod/aslwizard`);
`deploy/fetch-secrets.sh` writes the server's `.env` from it before each start. No RDS, ECS, load balancer or CloudFront for now (each costs more
than the server, or doesn't help a WebSocket game). Step by step: `deploy/README.md`.

Earlier plan:

Main stays on Render for testers. This branch moves to AWS: the Node server in a container (ECS Fargate or a
small EC2), Postgres on RDS (or Neon to start), the web app on CloudFront. Rooms and queues stay in the one
server's memory (fine for hundreds of players; see `server/README.md`); the database holds accounts and results.

## Build order

1. Postgres + accounts: Google/Discord sign-in, sessions, username and portrait, sign out.
2. Socket auth (cookie at connect, Origin check) and guest vs account seats.
3. Play screen with Casual quick match (1v1), queue and Accept.
4. Ratings and Ranked 1v1, result screen with rating change, match history.
5. Profile and stats.
6. Parties and 2v2 queues.
7. Friends, quick chat, friend chat.
8. AWS deploy.
