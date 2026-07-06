import { INITIAL_RATING } from "./elo";

export interface PlayerRating {
  user_id: string;
  name: string;
  rating: number;
  games: number;
}

// 現在の JST の年月 ("2026-07" 形式)
export function jstMonth(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function upsertPlayers(
  db: D1Database,
  guildId: string,
  players: { id: string; name: string }[]
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO players (guild_id, user_id, name) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET name = excluded.name`
  );
  await db.batch(players.map((p) => stmt.bind(guildId, p.id, p.name)));
}

export async function getNames(
  db: D1Database,
  guildId: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT user_id, name FROM players WHERE guild_id = ? AND user_id IN (${placeholders})`
    )
    .bind(guildId, ...userIds)
    .all<{ user_id: string; name: string }>();
  return new Map(rows.results.map((r) => [r.user_id, r.name]));
}

export async function getRatings(
  db: D1Database,
  guildId: string,
  mode: number,
  userIds: string[]
): Promise<Map<string, number>> {
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT user_id, rating FROM ratings
       WHERE guild_id = ? AND mode = ? AND user_id IN (${placeholders})`
    )
    .bind(guildId, mode, ...userIds)
    .all<{ user_id: string; rating: number }>();
  const map = new Map(rows.results.map((r) => [r.user_id, r.rating]));
  for (const id of userIds) if (!map.has(id)) map.set(id, INITIAL_RATING);
  return map;
}

export interface SaveGameInput {
  guildId: string;
  mode: number;
  recordedBy: string;
  entries: {
    userId: string;
    seat: number;
    score: number;
    rank: number;
    delta: number;
  }[];
}

export async function saveGame(db: D1Database, input: SaveGameInput): Promise<number> {
  const game = await db
    .prepare(
      `INSERT INTO games (guild_id, mode, played_at, recorded_by)
       VALUES (?, ?, unixepoch(), ?) RETURNING id`
    )
    .bind(input.guildId, input.mode, input.recordedBy)
    .first<{ id: number }>();
  const gameId = game!.id;

  const resultStmt = db.prepare(
    `INSERT INTO results (game_id, user_id, seat, score, rank, rating_delta)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const ratingStmt = db.prepare(
    `INSERT INTO ratings (guild_id, user_id, mode, rating, games)
     VALUES (?, ?, ?, ? + ?, 1)
     ON CONFLICT (guild_id, user_id, mode)
     DO UPDATE SET rating = rating + ?, games = games + 1`
  );
  await db.batch(
    input.entries.flatMap((e) => [
      resultStmt.bind(gameId, e.userId, e.seat, e.score, e.rank, e.delta),
      ratingStmt.bind(input.guildId, e.userId, input.mode, INITIAL_RATING, e.delta, e.delta),
    ])
  );
  return gameId;
}

// 取消は「そのギルド・モードの最新対局」のみ許可 (以降のレート計算に影響しないため)
export async function undoGame(
  db: D1Database,
  guildId: string,
  gameId: number,
  requesterId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const game = await db
    .prepare(`SELECT id, mode, recorded_by FROM games WHERE id = ? AND guild_id = ?`)
    .bind(gameId, guildId)
    .first<{ id: number; mode: number; recorded_by: string }>();
  if (!game) return { ok: false, reason: "この対局は既に取消済みです。" };

  const latest = await db
    .prepare(`SELECT MAX(id) AS id FROM games WHERE guild_id = ? AND mode = ?`)
    .bind(guildId, game.mode)
    .first<{ id: number }>();
  if (latest!.id !== gameId) {
    return {
      ok: false,
      reason: "後続の対局が登録済みのため取り消せません (取消は直近の対局のみ可能です)。",
    };
  }

  const results = await db
    .prepare(`SELECT user_id, rating_delta FROM results WHERE game_id = ?`)
    .bind(gameId)
    .all<{ user_id: string; rating_delta: number }>();
  const participants = results.results.map((r) => r.user_id);
  if (game.recorded_by !== requesterId && !participants.includes(requesterId)) {
    return { ok: false, reason: "取消は対局者本人または登録者のみ可能です。" };
  }

  const ratingStmt = db.prepare(
    `UPDATE ratings SET rating = rating - ?, games = games - 1
     WHERE guild_id = ? AND user_id = ? AND mode = ?`
  );
  await db.batch([
    ...results.results.map((r) =>
      ratingStmt.bind(r.rating_delta, guildId, r.user_id, game.mode)
    ),
    db.prepare(`DELETE FROM results WHERE game_id = ?`).bind(gameId),
    db.prepare(`DELETE FROM games WHERE id = ?`).bind(gameId),
  ]);
  return { ok: true };
}

export interface UserStats {
  games: number;
  avgRank: number;
  avgScore: number;
  bestScore: number;
  rankCounts: number[]; // [1位, 2位, 3位, 4位] の回数
  rating: number;
  monthlyGames: number;
}

export async function getUserStats(
  db: D1Database,
  guildId: string,
  userId: string,
  mode: number
): Promise<UserStats | null> {
  const month = jstMonth();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS games,
              AVG(r.rank) AS avg_rank,
              AVG(r.score) AS avg_score,
              MAX(r.score) AS best_score,
              SUM(r.rank = 1) AS r1, SUM(r.rank = 2) AS r2,
              SUM(r.rank = 3) AS r3, SUM(r.rank = 4) AS r4,
              SUM(strftime('%Y-%m', g.played_at, 'unixepoch', '+9 hours') = ?) AS monthly
       FROM results r JOIN games g ON g.id = r.game_id
       WHERE g.guild_id = ? AND g.mode = ? AND r.user_id = ?`
    )
    .bind(month, guildId, mode, userId)
    .first<{
      games: number; avg_rank: number; avg_score: number; best_score: number;
      r1: number; r2: number; r3: number; r4: number; monthly: number;
    }>();
  if (!row || row.games === 0) return null;

  const rating = await db
    .prepare(
      `SELECT rating FROM ratings WHERE guild_id = ? AND user_id = ? AND mode = ?`
    )
    .bind(guildId, userId, mode)
    .first<{ rating: number }>();

  return {
    games: row.games,
    avgRank: row.avg_rank,
    avgScore: row.avg_score,
    bestScore: row.best_score,
    rankCounts: [row.r1, row.r2, row.r3, row.r4],
    rating: rating?.rating ?? INITIAL_RATING,
    monthlyGames: row.monthly,
  };
}

export interface RankingEntry {
  user_id: string;
  name: string;
  value: number;
  games?: number;
}

export async function getRanking(
  db: D1Database,
  guildId: string,
  mode: number,
  type: string,
  limit = 10
): Promise<RankingEntry[]> {
  const month = jstMonth();
  let query: string;
  let binds: (string | number)[];

  switch (type) {
    case "rate":
      query = `SELECT rt.user_id, p.name, rt.rating AS value, rt.games
               FROM ratings rt JOIN players p ON p.guild_id = rt.guild_id AND p.user_id = rt.user_id
               WHERE rt.guild_id = ? AND rt.mode = ? AND rt.games > 0
               ORDER BY rt.rating DESC LIMIT ?`;
      binds = [guildId, mode, limit];
      break;
    case "mgames":
      query = `SELECT r.user_id, p.name, COUNT(*) AS value
               FROM results r
               JOIN games g ON g.id = r.game_id
               JOIN players p ON p.guild_id = g.guild_id AND p.user_id = r.user_id
               WHERE g.guild_id = ? AND g.mode = ?
                 AND strftime('%Y-%m', g.played_at, 'unixepoch', '+9 hours') = ?
               GROUP BY r.user_id ORDER BY value DESC LIMIT ?`;
      binds = [guildId, mode, month, limit];
      break;
    case "mscore":
      query = `SELECT r.user_id, p.name, MAX(r.score) AS value
               FROM results r
               JOIN games g ON g.id = r.game_id
               JOIN players p ON p.guild_id = g.guild_id AND p.user_id = r.user_id
               WHERE g.guild_id = ? AND g.mode = ?
                 AND strftime('%Y-%m', g.played_at, 'unixepoch', '+9 hours') = ?
               GROUP BY r.user_id ORDER BY value DESC LIMIT ?`;
      binds = [guildId, mode, month, limit];
      break;
    case "top":
      // トップ率 (5 局以上のプレイヤーが対象)
      query = `SELECT r.user_id, p.name,
                      ROUND(AVG(r.rank = 1) * 100, 1) AS value, COUNT(*) AS games
               FROM results r
               JOIN games g ON g.id = r.game_id
               JOIN players p ON p.guild_id = g.guild_id AND p.user_id = r.user_id
               WHERE g.guild_id = ? AND g.mode = ?
               GROUP BY r.user_id HAVING COUNT(*) >= 5
               ORDER BY value DESC LIMIT ?`;
      binds = [guildId, mode, limit];
      break;
    default:
      return [];
  }

  const rows = await db.prepare(query).bind(...binds).all<RankingEntry>();
  return rows.results;
}

export interface HistoryGame {
  id: number;
  mode: number;
  played_at: number;
  entries: { name: string; score: number; rank: number }[];
}

export async function getHistory(
  db: D1Database,
  guildId: string,
  userId: string | null,
  limit = 10
): Promise<HistoryGame[]> {
  const filter = userId
    ? `AND g.id IN (SELECT game_id FROM results WHERE user_id = ?)`
    : "";
  const binds: (string | number)[] = userId
    ? [guildId, userId, limit]
    : [guildId, limit];
  const games = await db
    .prepare(
      `SELECT g.id, g.mode, g.played_at FROM games g
       WHERE g.guild_id = ? ${filter}
       ORDER BY g.id DESC LIMIT ?`
    )
    .bind(...binds)
    .all<{ id: number; mode: number; played_at: number }>();
  if (games.results.length === 0) return [];

  const ids = games.results.map((g) => g.id);
  const placeholders = ids.map(() => "?").join(",");
  const results = await db
    .prepare(
      `SELECT r.game_id, p.name, r.score, r.rank
       FROM results r JOIN players p ON p.guild_id = ? AND p.user_id = r.user_id
       WHERE r.game_id IN (${placeholders})
       ORDER BY r.game_id, r.rank, r.seat`
    )
    .bind(guildId, ...ids)
    .all<{ game_id: number; name: string; score: number; rank: number }>();

  const byGame = new Map<number, { name: string; score: number; rank: number }[]>();
  for (const r of results.results) {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id)!.push({ name: r.name, score: r.score, rank: r.rank });
  }
  return games.results.map((g) => ({ ...g, entries: byGame.get(g.id) ?? [] }));
}
