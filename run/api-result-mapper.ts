/**
 * API経由モードの結果マッパー（DB 非依存・純関数）。
 *
 * `GET /v1/batch/{job_id}` の completed レスポンス（results[]）を、集計層が食べる
 * per-row レコード（BenchmarkRow）へ変換する。正規化はサーバ側で走るため、第三者は
 * API キーと生成入力だけで同一計測を再現できる。オラクル（truth/ambiguous）は
 * 投入時の row_index で突き合わせる。
 */
import type { CaseType } from "../build-dataset/perturbation-gen.js";
import type { BenchmarkRow } from "../report/aggregate.js";

export type ApiBatchResultRow = {
  row_index: number;
  confidence: "confident" | "review" | "unmatched";
  score: number;
  candidate_count: number;
  matched_corporate_number: string | null;
  // `GET /v1/batch/{job_id}` の completed レスポンスは候補配列に corporate_number を
  // 含む（apps/api result-presenter・最大5件）。これで API 経由モードでもカーブの低閾値点と
  // review 救済率を算出できる（候補番号が取れるため、DB直結モードと同じ candidateNumbers を
  // 保持できる）。
  candidates?: Array<{ corporate_number?: string; score: number }>;
};

/**
 * オラクル値。caseType/absorbable も束ね、API 経由モードでもケース種別内訳を
 * 実測から出せるようにする（正規化後のレスポンスにはケース種別が残らないため、
 * 投入時のメタデータをここで持ち回る）。
 */
export type OracleEntry = {
  truth: string;
  ambiguous: boolean;
  caseType: CaseType;
  absorbable: boolean;
  /** この行に都道府県ヒントを付与して投入したか（ヒント有無別集計に使う）。 */
  hintPrefecture: boolean;
};

export type OracleByRowIndex = Map<number, OracleEntry>;

/**
 * レスポンスの候補配列から法人番号を最大5件（スコア降順のまま）抽出する。
 * 候補配列が省略された行は matched_corporate_number へフォールバックする
 * （非nullなら1件、unmatched の null なら空配列）。
 */
function candidateNumbersFrom(result: ApiBatchResultRow): string[] {
  const fromCandidates = result.candidates
    ?.slice(0, 5)
    .map((candidate) => candidate.corporate_number)
    .filter((number): number is string => number !== undefined);
  if (fromCandidates && fromCandidates.length > 0) {
    return fromCandidates;
  }
  return result.matched_corporate_number === null
    ? []
    : [result.matched_corporate_number];
}

/**
 * API 結果を per-row レコードへ変換する。オラクルが対応しない row_index は
 * スキップする（投入とレスポンスの整合を壊さない）。
 */
export function mapApiResults(
  results: readonly ApiBatchResultRow[],
  oracle: OracleByRowIndex,
): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];
  for (const result of results) {
    const truth = oracle.get(result.row_index);
    if (!truth) {
      continue;
    }
    const secondScore = result.candidates?.[1]?.score ?? 0;
    // 候補番号はレスポンスの候補配列から最大5件取る（matched_corporate_number は
    // unmatched で null になるため無条件保持には使えない）。候補配列が省略された場合の
    // 保険として matched_corporate_number（非nullなら1件）へフォールバックする。
    const candidateNumbers = candidateNumbersFrom(result);
    rows.push({
      topScore: result.score,
      secondScore,
      candidateCount: result.candidate_count,
      candidateNumbers,
      productionConfidence: result.confidence,
      productionMatchedNumber: result.matched_corporate_number,
      truth: truth.truth,
      ambiguous: truth.ambiguous,
      caseType: truth.caseType,
      absorbable: truth.absorbable,
      hintPrefecture: truth.hintPrefecture,
    });
  }
  return rows;
}
