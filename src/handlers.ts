import {
  COLOR,
  Component,
  Embed,
  EPHEMERAL,
  Interaction,
  ResponseType,
  ephemeral,
  interactionUser,
  respond,
  Env,
} from "./types";
import { eloDeltas, ranksFromScores } from "./elo";
import {
  getHistory,
  getNames,
  getRanking,
  getRatings,
  getUserStats,
  jstMonth,
  saveGame,
  undoGame,
  upsertPlayers,
} from "./db";

const MODE_LABEL: Record<number, string> = { 4: "四人麻雀", 3: "三人麻雀" };
const EXPECTED_TOTAL: Record<number, number> = { 4: 100000, 3: 105000 };
const RANK_EMOJI = ["🥇", "🥈", "🥉", "4️⃣"];

function fmtScore(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtDelta(d: number): string {
  return d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
}

// 全角数字・カンマ・空白などを許容して整数にパースする
function parseScore(raw: string): number | null {
  const normalized = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－ー]/g, "-")
    .replace(/[,，\s点]/g, "");
  if (!/^-?\d+$/.test(normalized)) return null;
  return parseInt(normalized, 10);
}

// ---------------- スラッシュコマンド ----------------

export async function handleCommand(
  i: Interaction,
  env: Env
): Promise<Response> {
  if (!i.guild_id)
    return ephemeral("このコマンドはサーバー内でのみ使用できます。");
  const name = i.data!.name!;
  const opts = new Map((i.data!.options ?? []).map((o) => [o.name, o.value]));

  switch (name) {
    case "対局登録": {
      const mode = Number(opts.get("mode") ?? 4);
      return registrationSelectResponse(mode);
    }
    case "パネル設置":
      return panelResponse();
    case "成績": {
      const targetId = String(opts.get("user") ?? interactionUser(i).id);
      return statsResponse(env, i.guild_id, targetId);
    }
    case "ランキング":
      return rankingResponse(env, i.guild_id, "rate", 4, false);
    case "履歴": {
      const targetId = opts.get("user") ? String(opts.get("user")) : null;
      return historyResponse(env, i.guild_id, targetId);
    }
    case "ヘルプ":
      return helpResponse();
    default:
      return ephemeral(`未知のコマンドです: ${name}`);
  }
}

// 対局者選択メニュー付きのメッセージ (/対局登録 とパネルのボタンで共用)
function registrationSelectResponse(mode: number): Response {
  return respond(ResponseType.CHANNEL_MESSAGE, {
    content: `**${MODE_LABEL[mode]}** の対局者 ${mode} 名を選択してください。`,
    flags: EPHEMERAL,
    components: [
      {
        type: 1,
        components: [
          {
            type: 5, // ユーザー選択メニュー
            custom_id: `sel:${mode}`,
            placeholder: `対局者 ${mode} 名を選択`,
            min_values: mode,
            max_values: mode,
          },
        ],
      },
    ],
  });
}

// 操作パネル (ピン留め想定の常設メッセージ)
function panelResponse(): Response {
  return respond(ResponseType.CHANNEL_MESSAGE, {
    embeds: [
      {
        title: "🀄 麻雀成績管理パネル",
        description: [
          "ボタンから対局の登録や成績の確認ができます。",
          "",
          "**対局登録** … 対局者を選択 → 素点を入力して記録",
          "**成績** … 自分のレート・平均順位・順位率を表示",
          "**ランキング** … レート/月間対局数/月間最高素点/トップ率",
          "**履歴** … 直近 10 局の結果",
        ].join("\n"),
        color: COLOR,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: "対局登録 (四麻)",
            emoji: { name: "✍️" },
            custom_id: "panel:reg:4",
          },
          {
            type: 2,
            style: 1,
            label: "対局登録 (三麻)",
            emoji: { name: "✍️" },
            custom_id: "panel:reg:3",
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "成績",
            emoji: { name: "📊" },
            custom_id: "panel:stats",
          },
          {
            type: 2,
            style: 2,
            label: "ランキング",
            emoji: { name: "🏆" },
            custom_id: "panel:rank",
          },
          {
            type: 2,
            style: 2,
            label: "履歴",
            emoji: { name: "📜" },
            custom_id: "panel:hist",
          },
        ],
      },
    ],
  });
}

// ---------------- コンポーネント (ボタン・選択メニュー) ----------------

export async function handleComponent(
  i: Interaction,
  env: Env
): Promise<Response> {
  const guildId = i.guild_id!;
  const customId = i.data!.custom_id!;
  const [kind, ...args] = customId.split(":");

  // 常設パネルのボタン (応答は本人にのみ見える形で返す)
  if (kind === "panel") {
    const action = args[0];
    if (action === "reg") return registrationSelectResponse(Number(args[1]));
    if (action === "stats")
      return statsResponse(env, guildId, interactionUser(i).id, EPHEMERAL);
    if (action === "rank")
      return rankingResponse(env, guildId, "rate", 4, false, EPHEMERAL);
    if (action === "hist")
      return historyResponse(env, guildId, null, EPHEMERAL);
  }

  // 対局者選択 → 素点入力モーダルを表示
  if (kind === "sel") {
    const mode = Number(args[0]);
    const userIds = i.data!.values ?? [];
    const resolved = i.data!.resolved;
    const players = userIds.map((id) => {
      const user = resolved?.users?.[id];
      const nick = resolved?.members?.[id]?.nick;
      return {
        id,
        name: nick || user?.global_name || user?.username || id,
        bot: user?.bot ?? false,
      };
    });
    if (players.some((p) => p.bot)) {
      return ephemeral("Bot は対局者に指定できません。");
    }
    await upsertPlayers(env.DB, guildId, players);
    return respond(ResponseType.MODAL, {
      custom_id: `mdl:${mode}:${userIds.join(",")}`,
      title: `素点入力 (${MODE_LABEL[mode]})`,
      components: players.map((p, idx) => ({
        type: 1,
        components: [
          {
            type: 4, // テキスト入力
            custom_id: `s${idx}`,
            style: 1,
            label: `${p.name.slice(0, 38)} の素点`,
            placeholder: "例: 32000 (マイナス可)",
            required: true,
            max_length: 8,
          },
        ],
      })),
    });
  }

  // 対局の取消
  if (kind === "undo") {
    const gameId = Number(args[0]);
    const requesterId = interactionUser(i).id;
    const result = await undoGame(env.DB, guildId, gameId, requesterId);
    if (!result.ok) return ephemeral(`⚠️ ${result.reason}`);
    return respond(ResponseType.UPDATE_MESSAGE, {
      content: "🗑️ この対局の登録は取り消されました。",
      embeds: [],
      components: [],
    });
  }

  // ランキングの種別切替 (選択メニュー)
  if (kind === "rank_t") {
    const mode = Number(args[0]);
    const type = i.data!.values![0];
    return rankingResponse(env, guildId, type, mode, true);
  }

  // ランキングのモード切替 (ボタン)
  if (kind === "rank_m") {
    const [type, mode] = args;
    return rankingResponse(env, guildId, type, Number(mode), true);
  }

  return ephemeral("不明な操作です。");
}

// ---------------- モーダル送信 (素点入力) ----------------

export async function handleModal(i: Interaction, env: Env): Promise<Response> {
  const guildId = i.guild_id!;
  const [kind, modeStr, idsStr] = i.data!.custom_id!.split(":");
  if (kind !== "mdl") return ephemeral("不明な操作です。");

  const mode = Number(modeStr);
  const userIds = idsStr.split(",");

  // 入力値の取得とバリデーション
  const inputs = new Map<string, string>();
  for (const row of i.data!.components ?? []) {
    for (const c of row.components) inputs.set(c.custom_id, c.value);
  }
  const scores: number[] = [];
  for (let idx = 0; idx < userIds.length; idx++) {
    const parsed = parseScore(inputs.get(`s${idx}`) ?? "");
    if (parsed === null) {
      return ephemeral(
        `⚠️ ${idx + 1} 人目の素点「${inputs.get(
          `s${idx}`
        )}」を数値として読み取れませんでした。/対局登録 からやり直してください。`
      );
    }
    scores.push(parsed);
  }
  const total = scores.reduce((a, b) => a + b, 0);
  if (total !== EXPECTED_TOTAL[mode]) {
    return ephemeral(
      `⚠️ 素点の合計が ${fmtScore(total)} 点です。${
        MODE_LABEL[mode]
      }では合計 ${fmtScore(
        EXPECTED_TOTAL[mode]
      )} 点になるはずです。/対局登録 からやり直してください。\n入力値: ${scores
        .map(fmtScore)
        .join(" / ")}`
    );
  }

  // 着順・レート計算
  const ranks = ranksFromScores(scores);
  const ratingMap = await getRatings(env.DB, guildId, mode, userIds);
  const before = userIds.map((id) => ratingMap.get(id)!);
  const deltas = eloDeltas(before, ranks);

  const gameId = await saveGame(env.DB, {
    guildId,
    mode,
    recordedBy: interactionUser(i).id,
    entries: userIds.map((userId, idx) => ({
      userId,
      seat: idx,
      score: scores[idx],
      rank: ranks[idx],
      delta: deltas[idx],
    })),
  });

  const names = await getNames(env.DB, guildId, userIds);
  const order = userIds
    .map((_, idx) => idx)
    .sort((a, b) => ranks[a] - ranks[b] || a - b);

  const lines = order.map((idx) => {
    const id = userIds[idx];
    const after = before[idx] + deltas[idx];
    return `${RANK_EMOJI[ranks[idx] - 1]} **${
      names.get(id) ?? id
    }**  ${fmtScore(scores[idx])} 点  R${Math.round(after)} (${fmtDelta(
      deltas[idx]
    )})`;
  });

  return respond(ResponseType.CHANNEL_MESSAGE, {
    embeds: [
      {
        title: `🀄 対局結果を登録しました — ${MODE_LABEL[mode]}`,
        description: lines.join("\n"),
        color: COLOR,
        footer: { text: `対局 #${gameId} • レートは登録後の値` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "この登録を取り消す",
            emoji: { name: "🗑️" },
            custom_id: `undo:${gameId}`,
          },
        ],
      },
    ],
  });
}

// ---------------- 各種表示 ----------------

async function statsResponse(
  env: Env,
  guildId: string,
  userId: string,
  flags = 0
): Promise<Response> {
  const names = await getNames(env.DB, guildId, [userId]);
  const displayName = names.get(userId) ?? `<@${userId}>`;
  const fields: Embed["fields"] = [];

  for (const mode of [4, 3]) {
    const s = await getUserStats(env.DB, guildId, userId, mode);
    if (!s) continue;
    const rankRates = s.rankCounts
      .slice(0, mode)
      .map((c, idx) => `${idx + 1}位 ${((c / s.games) * 100).toFixed(1)}%`)
      .join(" / ");
    fields.push({
      name: `🀄 ${MODE_LABEL[mode]}`,
      value: [
        `**レート: ${Math.round(s.rating)}**`,
        `対局数: ${s.games} 局 (今月 ${s.monthlyGames} 局)`,
        `平均順位: ${s.avgRank.toFixed(2)} 位`,
        `平均素点: ${fmtScore(
          Math.round(s.avgScore)
        )} 点 / 最高素点: ${fmtScore(s.bestScore)} 点`,
        rankRates,
      ].join("\n"),
      inline: false,
    });
  }

  if (fields.length === 0) {
    return ephemeral(`${displayName} さんの対局記録はまだありません。`);
  }
  return respond(ResponseType.CHANNEL_MESSAGE, {
    embeds: [{ title: `📊 ${displayName} さんの成績`, color: COLOR, fields }],
    flags,
  });
}

const RANKING_TYPES: { value: string; label: string; emoji: string }[] = [
  { value: "rate", label: "レートランキング", emoji: "🏆" },
  { value: "mgames", label: "月間対局数ランキング", emoji: "🔥" },
  { value: "mscore", label: "月間最高素点ランキング", emoji: "💯" },
  { value: "top", label: "トップ率ランキング", emoji: "👑" },
];

function rankingValueLabel(
  type: string,
  e: { value: number; games?: number }
): string {
  switch (type) {
    case "rate":
      return `R${Math.round(e.value)}`;
    case "mgames":
      return `${e.value} 局`;
    case "mscore":
      return `${fmtScore(e.value)} 点`;
    case "top":
      return `${e.value}% (${e.games} 局)`;
    default:
      return String(e.value);
  }
}

async function rankingResponse(
  env: Env,
  guildId: string,
  type: string,
  mode: number,
  isUpdate: boolean,
  flags = 0
): Promise<Response> {
  const entries = await getRanking(env.DB, guildId, mode, type);
  const meta = RANKING_TYPES.find((t) => t.value === type)!;
  const monthNote = type.startsWith("m") ? ` (${jstMonth()})` : "";
  const minNote = type === "top" ? "\n※ 5 局以上のプレイヤーが対象" : "";

  const description =
    entries.length === 0
      ? "まだ記録がありません。"
      : entries
          .map((e, idx) => {
            const medal = idx < 3 ? RANK_EMOJI[idx] : `**${idx + 1}.**`;
            return `${medal} **${e.name}**  ${rankingValueLabel(type, e)}`;
          })
          .join("\n") + minNote;

  const components: Component[] = [
    {
      type: 1,
      components: [
        {
          type: 3, // 文字列選択メニュー
          custom_id: `rank_t:${mode}`,
          options: RANKING_TYPES.map((t) => ({
            label: t.label,
            value: t.value,
            emoji: { name: t.emoji },
            default: t.value === type,
          })),
        },
      ],
    },
    {
      type: 1,
      components: [4, 3].map((m) => ({
        type: 2,
        style: m === mode ? 1 : 2,
        label: MODE_LABEL[m],
        custom_id: `rank_m:${type}:${m}`,
        disabled: m === mode,
      })),
    },
  ];

  return respond(
    isUpdate ? ResponseType.UPDATE_MESSAGE : ResponseType.CHANNEL_MESSAGE,
    {
      embeds: [
        {
          title: `${meta.emoji} ${meta.label}${monthNote} — ${MODE_LABEL[mode]}`,
          description,
          color: COLOR,
        },
      ],
      components,
      flags,
    }
  );
}

async function historyResponse(
  env: Env,
  guildId: string,
  userId: string | null,
  flags = 0
): Promise<Response> {
  const games = await getHistory(env.DB, guildId, userId);
  if (games.length === 0) {
    return ephemeral("対局記録はまだありません。");
  }
  const titleName = userId
    ? (await getNames(env.DB, guildId, [userId])).get(userId) ?? "指定ユーザー"
    : null;
  const fields = games.map((g) => ({
    name: `#${g.id} ${MODE_LABEL[g.mode]}`,
    // タイムスタンプ (<t:...>) はフィールド名では展開されないため value 側に置く
    value:
      `<t:${g.played_at}:f>\n` +
      g.entries
        .map((e) => `${RANK_EMOJI[e.rank - 1]} ${e.name} ${fmtScore(e.score)}`)
        .join("　"),
    inline: false,
  }));
  return respond(ResponseType.CHANNEL_MESSAGE, {
    embeds: [
      {
        title: titleName
          ? `📜 ${titleName} さんの対局履歴`
          : "📜 対局履歴 (直近 10 局)",
        color: COLOR,
        fields,
      },
    ],
    flags,
  });
}

function helpResponse(): Response {
  return respond(ResponseType.CHANNEL_MESSAGE, {
    flags: EPHEMERAL,
    embeds: [
      {
        title: "🀄 麻雀成績管理 Bot の使い方",
        color: COLOR,
        fields: [
          {
            name: "/対局登録",
            value:
              "四麻・三麻を選び、対局者を選択 → 素点を入力して対局を記録します。登録直後なら 🗑️ ボタンで取消できます。",
          },
          {
            name: "/成績 [user]",
            value:
              "自分 (または指定ユーザー) のレート・平均順位・順位率などを表示します。",
          },
          {
            name: "/ランキング",
            value:
              "レートランキングを表示します。メニューから月間対局数・月間最高素点・トップ率に切替、ボタンで四麻/三麻を切替できます。",
          },
          { name: "/履歴 [user]", value: "直近 10 局の対局結果を表示します。" },
          {
            name: "レートについて",
            value:
              "初期値 1500 のイロレーティングです。同卓者全員との着順の比較でレートが増減し、格上に勝つほど大きく上がります。",
          },
        ],
      },
    ],
  });
}
