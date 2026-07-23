/**
 * CI リグレッションゲートの比較関数（DB 非依存の純関数）。
 *
 * 今回計測 vs コミット済み baseline の confident 精度差分を判定する。−0.3pt を
 * 超える悪化で fail。意図的改善時は同 PR で baseline を更新する（差分がレビュー可能）。
 *
 * baseline のキー（normalizerVersion / seed / fixtureHash / datasetHash）が今回の
 * 計測条件と一致しない場合は、古い baseline との誤比較を避けるため fail にする。
 * datasetHash は生成入力列・実効 ambiguous 集合・生成条件のハッシュで、fixture が
 * 同一のまま評価データセットだけが変わる誤比較（易化コーパスの pass）を防ぐ。
 */

/** 悪化許容幅（pt）。これを超える精度低下で fail。 */
export const PRECISION_REGRESSION_TOLERANCE_PT = 0.3;

export type BaselineKey = {
  normalizerVersion: string;
  seed: number;
  fixtureHash: string;
  datasetHash: string;
};

export type BenchmarkMetrics = BaselineKey & {
  confidentPrecision: number;
};

export type CompareResult = {
  ok: boolean;
  reason:
    | "pass"
    | "precision-regressed"
    | "key-mismatch"
    | "invalid-precision";
  /** 精度差分（pt, 今回 - baseline）。key 不一致時は null。 */
  precisionDeltaPt: number | null;
};

function keysMatch(a: BaselineKey, b: BaselineKey): boolean {
  return (
    a.normalizerVersion === b.normalizerVersion &&
    a.seed === b.seed &&
    a.fixtureHash === b.fixtureHash &&
    a.datasetHash === b.datasetHash
  );
}

/**
 * 今回計測を baseline と比較しゲート結果を返す。
 * - キー不一致: fail（誤比較防止）
 * - 精度が −0.3pt を「超えて」悪化: fail（ちょうど −0.3pt は pass）
 * - 同値・改善・許容内: pass
 */
export function compareToBaseline(
  current: BenchmarkMetrics,
  baseline: BenchmarkMetrics,
): CompareResult {
  if (!keysMatch(current, baseline)) {
    return { ok: false, reason: "key-mismatch", precisionDeltaPt: null };
  }

  // 手保守の baseline.json が欠損・型崩れしても比較が pass へ落ちない（fail-closed）。
  const validPrecision = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (
    !validPrecision(current.confidentPrecision) ||
    !validPrecision(baseline.confidentPrecision)
  ) {
    return { ok: false, reason: "invalid-precision", precisionDeltaPt: null };
  }

  const precisionDeltaPt =
    (current.confidentPrecision - baseline.confidentPrecision) * 100;

  // 0.95-0.953 のような差は二進浮動小数点で -0.3000...27pt になり、許容ちょうどの
  // 悪化を誤って fail させるため、微小な計算誤差ぶんだけ許容側に倒す。
  const EPSILON_PT = 1e-9;
  if (precisionDeltaPt < -PRECISION_REGRESSION_TOLERANCE_PT - EPSILON_PT) {
    return { ok: false, reason: "precision-regressed", precisionDeltaPt };
  }

  return { ok: true, reason: "pass", precisionDeltaPt };
}
