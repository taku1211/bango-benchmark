/**
 * リグレッションゲート比較関数のテスト。
 *
 * 要点:
 *   - 精度 −0.3pt 超悪化で fail、同値・改善で pass、境界（ちょうど −0.3pt）で pass。
 *   - baseline キー（normalizerVersion/seed/fixtureHash）不一致で fail（誤比較防止）。
 */
import { describe, expect, it } from "vitest";

import {
  type BenchmarkMetrics,
  compareToBaseline,
} from "../compare-to-baseline.js";

const KEY = {
  normalizerVersion: "2",
  seed: 20260704,
  fixtureHash: "abc123",
  datasetHash: "d1",
};

function metrics(confidentPrecision: number): BenchmarkMetrics {
  return { ...KEY, confidentPrecision };
}

describe("compareToBaseline", () => {
  it("datasetHash 不一致で fail する（生成条件だけ変わった誤比較の防止）", () => {
    const result = compareToBaseline(metrics(0.99), {
      ...metrics(0.99),
      datasetHash: "other",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("key-mismatch");
  });


  it("confident精度が前回比−0.3pt超悪化で fail を返す", () => {
    const result = compareToBaseline(metrics(0.95), metrics(0.955));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("precision-regressed");
  });

  it("改善で pass を返す", () => {
    const result = compareToBaseline(metrics(0.97), metrics(0.95));
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("pass");
  });

  it("同値で pass を返す", () => {
    const result = compareToBaseline(metrics(0.95), metrics(0.95));
    expect(result.ok).toBe(true);
    expect(result.precisionDeltaPt).toBeCloseTo(0);
  });

  it("ちょうど−0.3ptの悪化は pass（超過のみ fail）", () => {
    const result = compareToBaseline(metrics(0.95), metrics(0.953));
    expect(result.ok).toBe(true);
    expect(result.precisionDeltaPt).toBeCloseTo(-0.3);
  });

  it("normalizerVersion 不一致で fail（誤比較防止）", () => {
    const result = compareToBaseline(
      { ...metrics(0.95), normalizerVersion: "3" },
      metrics(0.95),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("key-mismatch");
    expect(result.precisionDeltaPt).toBeNull();
  });

  it("seed 不一致で fail", () => {
    const result = compareToBaseline(
      { ...metrics(0.95), seed: 1 },
      metrics(0.95),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("key-mismatch");
  });

  it("fixtureHash 不一致で fail", () => {
    const result = compareToBaseline(
      { ...metrics(0.95), fixtureHash: "zzz" },
      metrics(0.95),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("key-mismatch");
  });
});
