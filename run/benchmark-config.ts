/**
 * ベンチマークの再現条件を単一ソースへ集約する（DB 非依存・純定数）。
 *
 * DB直結モード・API モード・照合キー衝突メタデータ生成の 3 経路が同一の生成条件で
 * データセットを組む必要がある。値が各所に複製されると、build-fixture の --check は
 * 通るのに実行時の ambiguous 集合だけがずれる（衝突メタデータと実測が食い違う）ため、
 * シード・比率・都道府県ヒントの抽選条件はここだけに置き全経路から import する。
 */

/** 摂動生成器のシード（生成入力列を決定づける）。 */
export const SEED = 20260704;
/** 非吸収摂動（かな変換・略語・誤字・部分名）の目標比率。 */
export const NON_ABSORBABLE_RATIO = 0.25;
// 設計は摂動の単独・複合適用の両方を要求する。複合は2〜3ファミリーを重ねるため
// 比率は控えめに固定し、シードとともに再現条件の一部とする。
export const COMPOSITE_RATIO = 0.15;

/**
 * 都道府県ヒント付与を決める抽選シード（摂動 PRNG とは別系統）。
 *
 * ヒント抽選を摂動 PRNG から引くと、1 回の乱数消費が以後の摂動列を丸ごとずらし、
 * baseline / webArtifact / 衝突メタデータが総崩れになる。ヒント割当は行 index の
 * 決定論ハッシュで独立に決め、摂動列に一切干渉させない。DB直結モードと API モードで
 * 同一の行へヒントが付くよう、両経路がこの純関数を共有する。
 */
export const HINT_SEED = 0x9e3779b1;
/** 都道府県ヒントを付与する目標比率（決定論の抽選で一定比率の行に付く）。 */
export const HINT_RATIO = 0.5;

/**
 * 行 index に都道府県ヒントを付与するかを決める決定論の述語。
 * 摂動 PRNG を消費せず（seed を混ぜた index ハッシュを [0,1) 化して閾値比較する）、
 * DB直結モード・API モードの双方で同一行にヒントが付くことを保証する。
 */
export function hasPrefectureHint(
  index: number,
  ratio: number = HINT_RATIO,
  seed: number = HINT_SEED,
): boolean {
  // splitmix32 系の 1 ステップで index を撹拌し [0,1) の一様値へ写す。
  let h = (index + seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < ratio;
}
