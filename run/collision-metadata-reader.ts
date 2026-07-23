/**
 * 実効 ambiguous メタデータの読み込み（公開再現パス用・normalizer 非 import）。
 *
 * メタデータの生成（buildMatchingKey を要する）は build-dataset/collision-metadata.ts の
 * サーバ側ビルド工程が担い、公開再現パス（run-benchmark.ts）は本モジュール経由で
 * コミット済み JSON を読むだけにする。生成側モジュールを import すると normalizer への
 * top-level 依存が公開ハーネスへ混入し、第三者実行が起動前に失敗するため分離している。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CollisionMetadata = {
  /** 生成条件（再現性のためメタデータ自身にも刻む）。 */
  seed: number;
  nonAbsorbableRatio: number;
  compositeRatio: number;
  hintRatio: number;
  hintSeed: number;
  /** コーパス総件数（index の妥当性検証用）。 */
  corpusSize: number;
  /**
   * ヒント適用後の実効候補範囲で真値が一意に定まらない行の 0 始まり index（昇順）。
   * SYNTHETIC_CORPS = DB コーパス（corporate_number 昇順）と同一並び。
   */
  ambiguousIndices: number[];
};

export const COLLISION_METADATA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../build-dataset/collision-metadata.json",
);

/** コミット済み collision-metadata.json を読み込む。 */
export function loadCollisionMetadata(
  path: string = COLLISION_METADATA_PATH,
): CollisionMetadata {
  return JSON.parse(readFileSync(path, "utf8")) as CollisionMetadata;
}

/** 0 始まり index 配列から、size 長の boolean 配列（index→ambiguous か）を組む。 */
export function collisionFlagsFrom(
  meta: CollisionMetadata,
  size: number,
): boolean[] {
  const flags = new Array<boolean>(size).fill(false);
  for (const index of meta.ambiguousIndices) {
    if (index >= 0 && index < size) {
      flags[index] = true;
    }
  }
  return flags;
}
