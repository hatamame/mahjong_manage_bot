// 多人数対応イロレーティング (着順に基づくペアワイズ比較)
// 各ペア (i, j) について勝敗 S を判定し、K/(n-1) を掛けて合算する。
// 合計変動量が 2 人対戦の K=32 と同水準になるようスケールしている。

export const INITIAL_RATING = 1500;
const K = 32;

export function eloDeltas(ratings: number[], ranks: number[]): number[] {
  const n = ratings.length;
  const kPer = K / (n - 1);
  return ratings.map((ri, i) => {
    let delta = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const expected = 1 / (1 + 10 ** ((ratings[j] - ri) / 400));
      const actual = ranks[i] < ranks[j] ? 1 : ranks[i] > ranks[j] ? 0 : 0.5;
      delta += kPer * (actual - expected);
    }
    return Math.round(delta * 10) / 10;
  });
}

// 素点から着順を計算 (同点は同順位: 1,2,2,4 方式)
export function ranksFromScores(scores: number[]): number[] {
  return scores.map(
    (s) => scores.filter((other) => other > s).length + 1
  );
}
