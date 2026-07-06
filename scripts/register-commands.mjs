// スラッシュコマンドを Discord に登録するスクリプト (デプロイとは独立して 1 回実行)
//
// 使い方:
//   DISCORD_APP_ID / DISCORD_BOT_TOKEN を環境変数に設定して `npm run register`
//   GUILD_ID を設定すると対象サーバーに即時反映 (未設定ならグローバル登録: 反映まで最大 1 時間)
//
// PowerShell の例:
//   $env:DISCORD_APP_ID = "..."; $env:DISCORD_BOT_TOKEN = "..."; $env:GUILD_ID = "..."; npm run register

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!APP_ID || !TOKEN) {
  console.error("環境変数 DISCORD_APP_ID と DISCORD_BOT_TOKEN を設定してください。");
  process.exit(1);
}

const commands = [
  {
    name: "対局登録",
    description: "対局結果を登録します (対局者を選択して素点を入力)",
    options: [
      {
        type: 4, // INTEGER
        name: "mode",
        description: "四人麻雀 / 三人麻雀",
        required: true,
        choices: [
          { name: "四人麻雀", value: 4 },
          { name: "三人麻雀", value: 3 },
        ],
      },
    ],
  },
  {
    name: "成績",
    description: "レート・平均順位・順位率などの成績を表示します",
    options: [
      {
        type: 6, // USER
        name: "user",
        description: "対象ユーザー (省略時は自分)",
        required: false,
      },
    ],
  },
  {
    name: "ランキング",
    description: "レート・月間対局数・月間最高素点などのランキングを表示します",
  },
  {
    name: "履歴",
    description: "直近の対局結果を表示します",
    options: [
      {
        type: 6, // USER
        name: "user",
        description: "対象ユーザー (省略時はサーバー全体)",
        required: false,
      },
    ],
  },
  {
    name: "ヘルプ",
    description: "この Bot の使い方を表示します",
  },
  {
    name: "パネル設置",
    description: "ボタンで操作できる常設パネルをこのチャンネルに設置します (要サーバー管理権限)",
    default_member_permissions: "32", // MANAGE_GUILD
  },
];

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (res.ok) {
  const data = await res.json();
  console.log(`✅ ${data.length} 件のコマンドを登録しました (${GUILD_ID ? `guild: ${GUILD_ID}` : "グローバル"})`);
} else {
  console.error(`❌ 登録に失敗しました: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}
