/**
 * 評価データセットの同一性ハッシュ（DB 非依存・normalizer 非 import）。
 *
 * baseline の誤比較防止キーは fixture SQL のハッシュだけでは不十分で、評価行は
 * 摂動生成（seed・比率）・ヒント条件・実効 ambiguous 集合にも依存する。これらが
 * 変わったのに fixture が同一だと、易化したデータセットが旧 baseline に対して
 * pass し得るため、生成入力列と ambiguous 集合・生成条件を丸ごとハッシュ化して
 * baseline キーに含める。DB直結モードと API モードは同一の単一ソース条件から
 * 同一のデータセットを組むため、このハッシュも一致する。
 */
import { createHash } from "node:crypto";

export type DatasetHashInput = {
  /** 摂動後の生成入力列（行順）。 */
  inputs: readonly string[];
  /** 行順の実効 ambiguous フラグ。 */
  ambiguous: readonly boolean[];
  /**
   * 行順の適用済み都道府県ヒント（未付与は null）。ヒントは searchCandidates の候補
   * 範囲を変えるため、抽選条件（ratio/seed）だけでなく実際の割当値まで同一性に含める。
   */
  appliedHints: readonly (string | null)[];
  seed: number;
  nonAbsorbableRatio: number;
  compositeRatio: number;
  hintRatio: number;
  hintSeed: number;
};

/** 評価データセットの決定論ハッシュ（sha256 先頭 16 桁）。 */
export function computeDatasetHash(input: DatasetHashInput): string {
  const payload = JSON.stringify({
    inputs: input.inputs,
    ambiguous: input.ambiguous,
    appliedHints: input.appliedHints,
    seed: input.seed,
    nonAbsorbableRatio: input.nonAbsorbableRatio,
    compositeRatio: input.compositeRatio,
    hintRatio: input.hintRatio,
    hintSeed: input.hintSeed,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}
