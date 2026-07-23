/**
 * ベンチマーク集計層。
 *
 * per-row レコードを保持し、ヘッドライン指標とカバレッジ-精度カーブを別経路で導出する。
 * 件数だけを持つ集計器は閾値掃引でカーブを描けないため、生スコアを捨てずに残すのが
 * 設計要件。
 *
 * 2 つの経路を厳密に分ける:
 *   - ヘッドライン（coverage/confidentPrecision/review/unmatched）は **production の
 *     confidence 経路**（productionConfidence / productionMatchedNumber）から直接集計する。
 *     判定式をここで複製・再計算しない（production rank.ts の閾値緩和がそのまま反映され、
 *     判定式ドリフトが起きない）。ゲート対象の confidentPrecision はこの経路の値。
 *   - カバレッジ-精度カーブは **post-hoc の閾値掃引**（topScore 閾値 T を動かし gap 固定）
 *     で描く分析成果物であり、ゲート値ではない。正誤は candidateNumbers[0]===truth で判定
 *     する（候補配列は confidence に関わらず無条件保持されるため、低閾値点でも正しく計上
 *     できる）。
 *
 * 分母設計（ここが指標の解釈を決める）:
 *   - **率系（coverage / reviewRate / unmatchedRate / falseNegativeRate）は全評価行 N を
 *     分母にする**。N は summarize に渡された rows.length（コアの空キースキップ後の総数）で、
 *     ambiguous 行を含む。ambiguous（同名多数・生成入力衝突で正解が一意に定まらない行）は
 *     設計書 §1-3 で「reviewが正解」＝confident にしないのが正しい挙動なので、率系の分母から
 *     落とすと「reviewに落とせた」ことが coverage/review率に反映されず指標が歪む。
 *   - **confident 精度は分子・分母とも非 ambiguous 行のみ**。ambiguous 行の真値は一意でない
 *     ため「confident が正解か」を判定できず、精度計算にだけは含められない。
 *   - **ambiguousConfidentViolations**: ヒント不在の ambiguous 行が confident になった件数。
 *     設計書「同名多数はreview正解」に照らした違反件数で、精度分母には入らない ambiguous 行の
 *     挙動監視に使う。都道府県ヒントで正当に一意化された行は違反に数えない（ヒント経路の
 *     計測導入後の正当な confident を回帰に見せないため、ヒント不在の行に限定する）。
 */
import {
  ABSORBABLE_CASES,
  NON_ABSORBABLE_CASES,
} from "../build-dataset/perturbation-gen.js";
import type { CaseType } from "../build-dataset/perturbation-gen.js";

export type BenchmarkRow = {
  /** 最上位候補のスコア。候補ゼロなら 0。 */
  topScore: number;
  /** 2位候補のスコア。1件以下なら 0。 */
  secondScore: number;
  /** 候補数。 */
  candidateCount: number;
  /**
   * 候補の法人番号（最大5件・スコア降順）。confidence に関わらず無条件保持する
   * （候補ゼロなら空配列）。先頭が top 候補。カーブの低閾値点で「production は review
   * だが top 候補は正解」を正しく計上し、review 救済率で「真値が top2-5 に居る」も
   * 判定するため、単一 top 番号でなく候補配列を持つ。
   */
  candidateNumbers: readonly string[];
  /** production rankCandidates が返した confidence（ヘッドラインの唯一のソース）。 */
  productionConfidence: "confident" | "review" | "unmatched";
  /** production rankCandidates が付けた法人番号（confident/review で非null・unmatchedでnull）。 */
  productionMatchedNumber: string | null;
  /** 生成元の真の法人番号（オラクル）。 */
  truth: string;
  /** オラクルが一意に定まらない行（照合キーが DB 内で非一意）。 */
  ambiguous: boolean;
  /** 生成した摂動ケース種別（内訳集計の分類キー）。 */
  caseType: CaseType;
  /** 正規化が畳み込む吸収摂動か（内訳表示の吸収/非吸収列）。 */
  absorbable: boolean;
  /**
   * この行に都道府県ヒントを付与して照合したか。ヒント有無別の指標（coverage・
   * confident 精度）と ambiguousConfidentViolations のヒント不在スコープに使う。
   */
  hintPrefecture: boolean;
};

/** ケース種別ごとの件数・カバレッジ・confident 精度。公開ページの内訳表示に対応。 */
export type CaseBreakdownRow = {
  caseType: CaseType;
  absorbable: boolean;
  /** この種別の評価件数（ambiguous を含む総数。coverage の分母）。 */
  evaluated: number;
  /** カバレッジ = confident 件数 / 総数（ambiguous を含む）。 */
  coverage: number;
  /** confident 精度 = 非 ambiguous の confident 正解 / 非 ambiguous の confident 件数。 */
  confidentPrecision: number;
};

/** ヒント有無別の指標（coverage・confident 精度）。ヒント経路の効き目を分けて見せる。 */
export type HintSplitMetrics = {
  /** この区分の総件数（ambiguous を含む。coverage の分母）。 */
  total: number;
  coverage: number;
  confidentPrecision: number;
};

export type BenchmarkSummary = {
  /** 全評価件数 N（ambiguous を含む。率系指標の分母）。 */
  evaluated: number;
  /** confident 精度の分母（非 ambiguous 行数）。 */
  precisionEvaluated: number;
  /** ambiguous として精度計算からのみ分離した件数（率系分母には含む）。 */
  /** 実効 ambiguous の行数（confident 化した行は精度分母に失敗として含まれる）。 */
  ambiguousRows: number;
  /** カバレッジ = confident 件数 / 全評価件数 N。 */
  coverage: number;
  /** confident 精度 = 真の番号に付いた confident / 非 ambiguous の confident 件数。 */
  confidentPrecision: number;
  reviewRate: number;
  unmatchedRate: number;
  /**
   * review 救済率 = review 行のうち真値が候補5件内（top-5）に含まれる割合。
   * review の山を目視で拾えるかの指標。review 行が 0 件なら 0。
   */
  reviewRescueRate: number;
  /**
   * 偽陰性率 = 真値が DB に存在するのに unmatched になった割合。
   * review は偽陰性に数えない（unmatched のみ）。v1 合成コーパスは全行が
   * コーパス由来で真値は必ず DB 内に存在するため DB 不在の分母除外は発生せず、
   * 偽陰性率は unmatchedRate と一致する（DB 不在ケースは T1 後続トラック）。分母は N。
   */
  falseNegativeRate: number;
  /**
   * ヒント不在の ambiguous 行が confident になった件数（設計書「同名多数はreview正解」
   * の違反）。ヒントで正当に一意化された ambiguous 行は違反に数えない。
   */
  ambiguousConfidentViolations: number;
  /** 都道府県ヒントを付与した行の指標（coverage・confident 精度）。 */
  hintPresent: HintSplitMetrics;
  /** 都道府県ヒントを付与しなかった行の指標（coverage・confident 精度）。 */
  hintAbsent: HintSplitMetrics;
};

export type CurvePoint = {
  /** 掃引した topScore 閾値。 */
  threshold: number;
  coverage: number;
  precision: number;
};

/** カーブ掃引の既定範囲。gap は固定し topScore 閾値のみ動かす。 */
export const DEFAULT_CURVE_THRESHOLDS: readonly number[] = [
  0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
];
export const DEFAULT_CONFIDENT_GAP = 0.15;

function isConfident(
  row: BenchmarkRow,
  threshold: number,
  gap: number,
): boolean {
  return (
    row.topScore >= threshold &&
    (row.candidateCount <= 1 || row.topScore - row.secondScore >= gap)
  );
}

/**
 * 指定した (threshold, gap) で判定式を掃引し、evaluated 行のカバレッジと精度を返す。
 * ここは **カーブ専用の post-hoc 掃引**でありゲート値ではない。正誤は無条件保持の
 * candidateNumbers[0]===truth で判定する（低閾値点でも production の confidence に
 * 縛られず top 候補の正誤を計上できる）。カバレッジは全行分母・精度のみ ambiguous 除外。
 */
export function evaluateAt(
  rows: readonly BenchmarkRow[],
  threshold: number,
  gap: number,
): { coverage: number; precision: number } {
  if (rows.length === 0) {
    return { coverage: 0, precision: 0 };
  }
  // 分母の定義はヘッドラインと同一: カバレッジは全評価行 N、精度は confident 全行を
  // 分母にし、実効 ambiguous の confident 化は失敗として分子に入れない。
  let confident = 0;
  let confidentCorrect = 0;
  for (const row of rows) {
    if (!isConfident(row, threshold, gap)) {
      continue;
    }
    confident += 1;
    if (!row.ambiguous && row.candidateNumbers[0] === row.truth) {
      confidentCorrect += 1;
    }
  }
  return {
    coverage: confident / rows.length,
    precision: confident === 0 ? 0 : confidentCorrect / confident,
  };
}

/** ヒント区分ごとの coverage・confident 精度を組む小ヘルパ（分母設計は summarize と同一）。 */
function hintSplit(rows: readonly BenchmarkRow[]): HintSplitMetrics {
  const total = rows.length;
  let confident = 0;
  let precisionConfident = 0;
  let precisionCorrect = 0;
  for (const row of rows) {
    if (row.productionConfidence !== "confident") {
      continue;
    }
    confident += 1;
    // 分母は confident 全行。実効 ambiguous の confident 化は失敗として分子に入れない
    //（summarize と同一ルール）。
    precisionConfident += 1;
    if (!row.ambiguous && row.productionMatchedNumber === row.truth) {
      precisionCorrect += 1;
    }
  }
  return {
    total,
    coverage: total === 0 ? 0 : confident / total,
    confidentPrecision:
      precisionConfident === 0 ? 0 : precisionCorrect / precisionConfident,
  };
}

/**
 * ヘッドライン指標を production の confidence 経路から直接集計する。
 * 判定式はここで複製・再計算せず、production rankCandidates が返した
 * productionConfidence / productionMatchedNumber をそのまま数える（＝ゲート対象の
 * confidentPrecision は production 挙動と常に一致し、閾値緩和がそのまま反映される）。
 *
 * 分母設計（詳細はファイル冒頭）: 率系（coverage/review/unmatched/falseNegative）は全評価行
 * N（rows.length・ambiguous を含む）を分母にし、confident 精度のみ非 ambiguous 行に絞る。
 */
export function summarize(rows: readonly BenchmarkRow[]): BenchmarkSummary {
  const total = rows.length;
  // 実効 ambiguous の行数。confident 化した ambiguous 行は「除外」ではなく精度分母に
  // 失敗として含まれるため、「excluded」でなく実態どおり件数として報告する。
  const ambiguousRows = rows.filter((row) => row.ambiguous).length;

  // 率系（confident/review/unmatched）は全行 N を分母にする。
  let confident = 0;
  let review = 0;
  let reviewRescued = 0;
  let unmatched = 0;
  // confident 精度の分母は confident 全行。実効 ambiguous（ヒント適用後も真値が一意で
  // ない）行の confident 化は「review が正解」の違反＝失敗として分子に入れず精度を
  // 押し下げる。除外扱いにすると同名企業の自動確定というリグレッションをゲート指標が
  // 隠してしまうため、失敗計上が正しい。
  let precisionConfident = 0;
  let precisionCorrect = 0;
  // 実効 ambiguous 行が confident になった件数（設計書「同名多数はreview正解」違反）。
  // ambiguity はヒント適用後に判定済みなので、ヒント有無を問わず違反に数える。
  let ambiguousConfidentViolations = 0;

  for (const row of rows) {
    switch (row.productionConfidence) {
      case "confident":
        confident += 1;
        precisionConfident += 1;
        if (row.ambiguous) {
          ambiguousConfidentViolations += 1;
        } else if (row.productionMatchedNumber === row.truth) {
          precisionCorrect += 1;
        }
        break;
      case "review":
        review += 1;
        // 救済＝真値が候補5件内（top-5）に含まれること。目視で拾える率。
        if (row.candidateNumbers.includes(row.truth)) {
          reviewRescued += 1;
        }
        break;
      default:
        unmatched += 1;
        break;
    }
  }

  return {
    evaluated: total,
    // confidentPrecision の実分母（confident 全行）。非 ambiguous 総数を返すと
    // 精度の標本サイズを過大に見せるため、実際に割っている数を報告する。
    precisionEvaluated: precisionConfident,
    ambiguousRows,
    coverage: total === 0 ? 0 : confident / total,
    confidentPrecision:
      precisionConfident === 0 ? 0 : precisionCorrect / precisionConfident,
    reviewRate: total === 0 ? 0 : review / total,
    unmatchedRate: total === 0 ? 0 : unmatched / total,
    reviewRescueRate: review === 0 ? 0 : reviewRescued / review,
    // v1 は全行 DB 内に真値あり → 分母は N。DB 不在ケース導入時は分母を
    // 「真値が DB 内の行」に絞る（review は偽陰性に数えない）。
    falseNegativeRate: total === 0 ? 0 : unmatched / total,
    ambiguousConfidentViolations,
    hintPresent: hintSplit(rows.filter((row) => row.hintPrefecture)),
    hintAbsent: hintSplit(rows.filter((row) => !row.hintPrefecture)),
  };
}

/**
 * topScore 閾値を掃引し、各点の (カバレッジ, 精度) を返す。gap は固定。
 * 公開ページのカバレッジ-精度カーブ描画に使う分析成果物（ゲート値ではない）。
 */
export function coveragePrecisionCurve(
  rows: readonly BenchmarkRow[],
  thresholds: readonly number[] = DEFAULT_CURVE_THRESHOLDS,
  gap = DEFAULT_CONFIDENT_GAP,
): CurvePoint[] {
  return thresholds.map((threshold) => {
    const { coverage, precision } = evaluateAt(rows, threshold, gap);
    return { threshold, coverage, precision };
  });
}

/**
 * ケース種別ごとの内訳（件数・カバレッジ・confident 精度）を返す。
 * ヘッドラインと同じ分母設計: coverage の分母は種別総数（ambiguous を含む）、
 * confident 精度の分母は非 ambiguous の confident 件数のみ。公開ページの内訳表示が
 * 実測値から出るための集計成果物。出力順は生成器のケース列挙順（吸収系→非吸収系）で安定。
 */
export function caseBreakdown(
  rows: readonly BenchmarkRow[],
): CaseBreakdownRow[] {
  // 出力順は生成器の列挙（吸収系→非吸収系→複合）を単一ソースとして導出する。
  // 手書きの許可リストにすると生成器へのファミリー追加時に公開内訳から黙って
  // 脱落するため、必ず全ケース種別を走査対象にする。
  const order: readonly CaseType[] = [
    ...ABSORBABLE_CASES,
    ...NON_ABSORBABLE_CASES,
    "composite",
  ];
  // composite は発火成分により行ごとに吸収可否が異なるため、種別×吸収可否の
  // 複合キーでバケットし、混合バケットが恣意的な吸収表示にならないようにする。
  const byBucket = new Map<
    string,
    {
      caseType: CaseType;
      absorbable: boolean;
      /** coverage の分母（ambiguous を含む総数）。 */
      evaluated: number;
      /** coverage の分子（ambiguous を含む confident 件数）。 */
      confident: number;
      /** 精度の分母（非 ambiguous の confident 件数）。 */
      precisionConfident: number;
      /** 精度の分子（非 ambiguous の confident 正解）。 */
      precisionCorrect: number;
    }
  >();
  for (const row of rows) {
    const key = `${row.caseType}:${row.absorbable}`;
    const bucket = byBucket.get(key) ?? {
      caseType: row.caseType,
      absorbable: row.absorbable,
      evaluated: 0,
      confident: 0,
      precisionConfident: 0,
      precisionCorrect: 0,
    };
    // coverage の分母は ambiguous を含む総数。
    bucket.evaluated += 1;
    if (row.productionConfidence === "confident") {
      bucket.confident += 1;
      // 精度分母は confident 全行。実効 ambiguous の confident 化は失敗として分子に
      // 入れない（summarize / hintSplit と同一ルール。バケットだけ除外扱いにすると
      // 内訳が 100% を示すのにヘッドラインは失敗計上済みという不整合になる）。
      bucket.precisionConfident += 1;
      if (!row.ambiguous && row.productionMatchedNumber === row.truth) {
        bucket.precisionCorrect += 1;
      }
    }
    byBucket.set(key, bucket);
  }
  const breakdown: CaseBreakdownRow[] = [];
  for (const caseType of order) {
    // 吸収→非吸収の順で同一種別の分割バケットを安定して並べる。
    for (const absorbable of [true, false]) {
      const bucket = byBucket.get(`${caseType}:${absorbable}`);
      if (!bucket) {
        continue;
      }
      breakdown.push({
        caseType,
        absorbable,
        evaluated: bucket.evaluated,
        coverage:
          bucket.evaluated === 0 ? 0 : bucket.confident / bucket.evaluated,
        confidentPrecision:
          bucket.precisionConfident === 0
            ? 0
            : bucket.precisionCorrect / bucket.precisionConfident,
      });
    }
  }
  return breakdown;
}

/**
 * `/benchmark` の実測ブロックへ貼り込む形。DB直結モードと API モードで同一形状にするため
 * 両ランナーがこのビルダを共有する（貼り込みフィールドの手書き乖離を防ぐ）。
 * dbSnapshotDate / commitSha / datasetVersion は運用値のため貼り込み時に埋める（含めない）。
 */
export type BenchmarkWebArtifact = {
  coverage: number;
  confidentPrecision: number;
  reviewRescueRate: number;
  falseNegativeRate: number;
  ambiguousConfidentViolations: number;
  hintPresent: HintSplitMetrics;
  hintAbsent: HintSplitMetrics;
  curve: CurvePoint[];
  caseBreakdown: Array<{
    caseType: CaseType;
    absorbable: boolean;
    coverage: number;
    confidentPrecision: number;
  }>;
};

export function buildWebArtifact(
  summary: BenchmarkSummary,
  curve: readonly CurvePoint[],
  breakdown: readonly CaseBreakdownRow[],
): BenchmarkWebArtifact {
  return {
    coverage: summary.coverage,
    confidentPrecision: summary.confidentPrecision,
    reviewRescueRate: summary.reviewRescueRate,
    falseNegativeRate: summary.falseNegativeRate,
    ambiguousConfidentViolations: summary.ambiguousConfidentViolations,
    hintPresent: summary.hintPresent,
    hintAbsent: summary.hintAbsent,
    curve: [...curve],
    caseBreakdown: breakdown.map((b) => ({
      caseType: b.caseType,
      absorbable: b.absorbable,
      coverage: b.coverage,
      confidentPrecision: b.confidentPrecision,
    })),
  };
}
