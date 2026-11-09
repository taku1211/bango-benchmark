/**
 * DB直結ベンチマークのコアループ（DB 非依存・依存注入）。
 *
 * production の service.ts と同じ「searchCandidates → rankCandidates」の順で
 * 各摂動入力を照合し、per-row レコードを組み立てる。SQL・トランザクション wrapper・
 * 判定式は一切複製せず、production の公開ファクトリと rankCandidates を注入して
 * 忠実に再現する。入力は production（apps/api の match.ts）と同様に buildMatchingKey で
 * 照合キー化してから searchCandidates に渡す（生入力を直接渡さない）。
 *
 * ここは純ロジックとして単体テスト可能にし、実 Postgres への配線は薄い
 * run-benchmark-db.ts が担う（service.ts のロジック/配線分離と同型）。
 */
import type { CaseType } from "../build-dataset/perturbation-gen.js";
import type { BenchmarkRow } from "../report/aggregate.js";

// production の rankCandidates（apps/worker rank.ts）が要求する候補ポートに揃える。
// name/nameKana を欠くと注入時に strictFunctionTypes で不整合になる（rankCandidates は
// これらを含む候補を要求するため）。DB 非依存を保つため型は import せずローカルに定義する。
export type BenchmarkCandidate = {
  corporateNumber: string;
  name: string;
  nameKana: string | null;
  score: number;
};

export type RankOutcome = {
  confidence: "confident" | "review" | "unmatched";
  matchedCorporateNumber: string | null;
  score: number;
  candidateCount: number;
};

export type BenchmarkInputCase = {
  /** 摂動を加えた入力名（正規化前の生入力）。 */
  input: string;
  /** 生成元の真の法人番号（オラクル）。 */
  truth: string;
  /** オラクルが一意に定まらない行か。 */
  ambiguous: boolean;
  /** 生成した摂動ケース種別（内訳集計の分類キー）。 */
  caseType: CaseType;
  /** 正規化が畳み込む吸収摂動か。 */
  absorbable: boolean;
  /**
   * この行に付与する都道府県ヒント。決定論の抽選（benchmark-config.hasPrefectureHint）で
   * 一定比率の行にコーパスの都道府県コードを付ける。undefined ならヒントなしで照合する。
   */
  prefectureHint?: string;
};

export type RunBenchmarkDeps = {
  /** production の入力照合キー化（apps/api match.ts と同一の buildMatchingKey）。 */
  buildMatchingKey: (input: string) => string;
  /**
   * production の公開ファクトリ由来 searchCandidates。都道府県ヒントは production の
   * repository がそのまま WHERE 句へ載せる受け口（prefectureCode）へ渡す。
   */
  searchCandidates: (input: {
    inputNameNormalized: string;
    prefectureCode?: string;
  }) => Promise<BenchmarkCandidate[]>;
  /** production の rankCandidates。 */
  rankCandidates: (
    candidates: BenchmarkCandidate[],
    input: { inputNameNormalized: string },
  ) => RankOutcome;
};

/**
 * 摂動入力列を production パイプラインで評価し per-row レコードを返す。
 * 照合キーが空になる入力（法人格語のみ等）も production は行として処理し unmatched に
 * するため、落とさず unmatched 行として計上する（落とすと分母から静かに消え、
 * API モードとも件数がずれる）。
 */
export async function runBenchmarkCore(
  cases: readonly BenchmarkInputCase[],
  deps: RunBenchmarkDeps,
): Promise<BenchmarkRow[]> {
  const rows: BenchmarkRow[] = [];

  for (const testCase of cases) {
    const inputNameNormalized = deps.buildMatchingKey(testCase.input);
    if (inputNameNormalized === "") {
      rows.push({
        topScore: 0,
        secondScore: 0,
        candidateCount: 0,
        candidateNumbers: [],
        productionConfidence: "unmatched",
        productionMatchedNumber: null,
        truth: testCase.truth,
        ambiguous: testCase.ambiguous,
        caseType: testCase.caseType,
        absorbable: testCase.absorbable,
        hintPrefecture: testCase.prefectureHint !== undefined,
      });
      continue;
    }

    const candidates = await deps.searchCandidates({
      inputNameNormalized,
      prefectureCode: testCase.prefectureHint,
    });
    // production の service.ts と同じく照合キーを判定にも渡す（#690 完全一致判定）。
    const ranked = deps.rankCandidates(candidates, { inputNameNormalized });

    rows.push({
      topScore: candidates[0]?.score ?? 0,
      secondScore: candidates[1]?.score ?? 0,
      candidateCount: candidates.length,
      // 候補番号を最大5件、confidence に関わらず無条件保持する（カーブの低閾値点で
      // production の confidence に縛られず top 候補の正誤を計上し、review 救済率で
      // 真値が top2-5 に居るかも判定するため）。
      candidateNumbers: candidates.slice(0, 5).map((c) => c.corporateNumber),
      productionConfidence: ranked.confidence,
      productionMatchedNumber: ranked.matchedCorporateNumber,
      truth: testCase.truth,
      ambiguous: testCase.ambiguous,
      caseType: testCase.caseType,
      absorbable: testCase.absorbable,
      hintPrefecture: testCase.prefectureHint !== undefined,
    });
  }

  return rows;
}
