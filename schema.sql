-- 麻雀成績管理 D1 スキーマ
CREATE TABLE IF NOT EXISTS players (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- モード別レーティング (mode: 4 = 四人麻雀, 3 = 三人麻雀)
CREATE TABLE IF NOT EXISTS ratings (
  guild_id TEXT    NOT NULL,
  user_id  TEXT    NOT NULL,
  mode     INTEGER NOT NULL,
  rating   REAL    NOT NULL DEFAULT 1500,
  games    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, mode)
);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  mode        INTEGER NOT NULL,
  played_at   INTEGER NOT NULL, -- unix 秒
  recorded_by TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  game_id      INTEGER NOT NULL REFERENCES games(id),
  user_id      TEXT    NOT NULL,
  seat         INTEGER NOT NULL, -- 入力順 (0 始まり)
  score        INTEGER NOT NULL, -- 素点
  rank         INTEGER NOT NULL, -- 着順 (1 始まり, 同点は同順位)
  rating_delta REAL    NOT NULL,
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_games_guild ON games (guild_id, mode, played_at);
CREATE INDEX IF NOT EXISTS idx_results_user ON results (user_id);
