/**
 * データセット manifest。
 *
 * 第三者が code + seed + manifest だけで T2 データセットを再構築できるよう、
 * バージョン・シード・全生成比率（非吸収/複合）・ヒント抽選条件・コーパス件数・
 * ソース種別・fixtureHash を記録する。生成パラメータが1つでも欠けると再構築列が
 * 実測と異なるデータセットになるため、実行系が使う条件を漏れなく写す。
 * fixtureHash は fixture SQL の sha256 先頭 16 桁（baseline.json と同一アルゴリズム・
 * 同一ファイル）で、manifest テストがコミット済み SQL から算出した値と一致させる。
 * T1 実在ペア導入時は sourceURL（調達元 URL）を追加する前提。
 */
import {
  COMPOSITE_RATIO,
  HINT_RATIO,
  HINT_SEED,
  NON_ABSORBABLE_RATIO,
  SEED,
} from "../run/benchmark-config.js";
import { SYNTHETIC_CORPS } from "./synthetic-corpus.js";

export type DatasetManifest = {
  datasetVersion: string;
  seed: number;
  nonAbsorbableRatio: number;
  compositeRatio: number;
  hintRatio: number;
  hintSeed: number;
  /**
   * 計測時の候補検索類似度閾値。対象デプロイが env で別値に上書きされていると
   * 候補集合ごと変わり同一計測にならないため、再現条件として記録する。
   * 実装の既定値との一致は dataset-manifest.test.ts が worker config と突合して強制する。
   */
  matchSimilarityThreshold: number;
  corpusSize: number;
  /** T2 合成ゆらぎ（正規化辞書非依存）。T1 実在ペアは後続 Issue。 */
  source: "synthetic-t2";
  normalizerVersionForFixture: string;
  /** fixture SQL の sha256 先頭 16 桁（baseline.json と同値）。 */
  fixtureHash: string;
};

export const DATASET_MANIFEST: DatasetManifest = {
  datasetVersion: "1",
  // シード・非吸収比率は benchmark-config を単一ソースとして取り込み、実行系との差異を防ぐ。
  seed: SEED,
  nonAbsorbableRatio: NON_ABSORBABLE_RATIO,
  compositeRatio: COMPOSITE_RATIO,
  hintRatio: HINT_RATIO,
  hintSeed: HINT_SEED,
  matchSimilarityThreshold: 0.5,
  corpusSize: SYNTHETIC_CORPS.length,
  source: "synthetic-t2",
  normalizerVersionForFixture: "2",
  fixtureHash: "038f671410a7a7e5",
};
