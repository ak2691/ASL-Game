-- Accounts (plans/accounts.md). Run by the server at start; every statement must be safe to run again.

CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  username text, -- null until picked (after the first sign-in)
  username_lower text UNIQUE, -- for case-insensitive uniqueness
  username_changed_at timestamptz,
  portrait text NOT NULL DEFAULT 'apprentice', -- 'apprentice', or a beaten Tower wizard's id (battle.ts LADDER)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A sign-in account (Google, Discord) linked to a user. The email is kept private (never shown or sent).
CREATE TABLE IF NOT EXISTS identities (
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text,
  display_name text, -- the name on the sign-in account (only used to suggest a username)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);

-- Sessions: only the SHA-256 of the cookie's token is stored, so a copy of this table can't sign anyone in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Nov 27: Tower wizards beaten (their portraits unlock); new players start as the Apprentice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tower_beaten text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ALTER COLUMN portrait SET DEFAULT 'apprentice';

-- Nov 27: online match results (Casual, Custom; Ranked later). Duo Tower and the solo Tower aren't recorded.
CREATE TABLE IF NOT EXISTS matches (
  id bigserial PRIMARY KEY,
  mode text NOT NULL, -- 'casual' | 'custom' (later 'ranked')
  size text NOT NULL, -- '1v1', '2v2', '1v2'
  started_at timestamptz,
  ended_at timestamptz NOT NULL DEFAULT now(),
  ended_by text NOT NULL, -- 'knockout' | 'forfeit' | 'left'
  winner_team text, -- 'player' | 'enemy' (the server's team names)
  finisher text -- the spell that ended it (knockouts)
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id bigint REFERENCES users(id) ON DELETE SET NULL, -- null: a guest
  name text NOT NULL, -- as shown in that match (a wizard name, or Guest12345)
  team text NOT NULL,
  won boolean NOT NULL,
  rating_before integer, -- Ranked only
  rating_after integer,
  stats jsonb NOT NULL -- FighterStats (apps/web/src/combat.ts)
);
CREATE INDEX IF NOT EXISTS match_players_user ON match_players(user_id, match_id);
CREATE INDEX IF NOT EXISTS match_players_match ON match_players(match_id);

-- Nov 27: Glicko-2 ratings per ranked queue (server/glicko.ts). Peak is kept once placements are done.
CREATE TABLE IF NOT EXISTS ratings (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queue text NOT NULL, -- 'ranked1v1' (later 'ranked2v2')
  rating double precision NOT NULL DEFAULT 1500,
  rd double precision NOT NULL DEFAULT 350,
  vol double precision NOT NULL DEFAULT 0.06,
  games integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  peak double precision,
  PRIMARY KEY (user_id, queue)
);

-- Nov 27: friends (plans/accounts.md "Friends and chat"). A request is one 'pending' row (asker -> asked);
-- accepted, it's two 'friends' rows, one each way. Blocks stop requests and messages both ways.
CREATE TABLE IF NOT EXISTS friends (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL, -- 'pending' | 'friends'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friends_friend ON friends(friend_id);
CREATE TABLE IF NOT EXISTS blocks (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id)
);
-- Reports, for a look by hand. context: unused since text chat was removed (Nov 28).
CREATE TABLE IF NOT EXISTS reports (
  id bigserial PRIMARY KEY,
  reporter_id bigint REFERENCES users(id) ON DELETE SET NULL,
  reported_id bigint REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Nov 27: index for the hourly cleanup (server/db.ts): expired sessions.
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

-- Nov 27: per-player running totals (server/totals.ts), updated as each match is saved: a profile reads one row.
CREATE TABLE IF NOT EXISTS player_totals (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  casual_wins integer NOT NULL DEFAULT 0,
  casual_losses integer NOT NULL DEFAULT 0,
  ranked_wins integer NOT NULL DEFAULT 0,
  ranked_losses integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0, -- wins in a row right now
  best_streak integer NOT NULL DEFAULT 0,
  casts integer NOT NULL DEFAULT 0,
  cast_ms_total bigint NOT NULL DEFAULT 0,
  fastest_ms integer,
  drawings integer NOT NULL DEFAULT 0,
  fizzles integer NOT NULL DEFAULT 0,
  parries integer NOT NULL DEFAULT 0,
  silences integer NOT NULL DEFAULT 0,
  by_element jsonb NOT NULL DEFAULT '{}',
  by_spell jsonb NOT NULL DEFAULT '{}',
  badges text[] NOT NULL DEFAULT '{}'
);
-- Name search: prefix matches on the lower-case name ("ro" finds Rowan803), newest index-friendly form.
CREATE INDEX IF NOT EXISTS users_name_prefix ON users (username_lower text_pattern_ops);
