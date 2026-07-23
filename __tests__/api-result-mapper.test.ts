/**
 * API経由モードの結果マッパーのテスト。
 *
 * 要点:
 *   - production の confidence/番号を忠実記録し、top 候補番号は無条件保持する。
 *   - 2位候補スコアから secondScore を取り、ギャップ判定を集計層で再現可能にする。
 *   - オラクル未対応の row_index はスキップする。
 */
import { describe, expect, it } from "vitest";

import {
  type ApiBatchResultRow,
  mapApiResults,
  type OracleByRowIndex,
} from "../run/api-result-mapper.js";

const oracle: OracleByRowIndex = new Map([
  [
    0,
    {
      truth: "1000000000000",
      ambiguous: false,
      caseType: "identity",
      absorbable: true,
      hintPrefecture: false,
    },
  ],
  [
    1,
    {
      truth: "2000000000000",
      ambiguous: true,
      caseType: "typo",
      absorbable: false,
      hintPrefecture: false,
    },
  ],
]);

describe("mapApiResults", () => {
  it("confident 行を truth/secondScore/top候補付きで変換する", () => {
    const results: ApiBatchResultRow[] = [
      {
        row_index: 0,
        confidence: "confident",
        score: 0.95,
        candidate_count: 2,
        matched_corporate_number: "1000000000000",
        candidates: [
          { corporate_number: "1000000000000", score: 0.95 },
          { corporate_number: "3000000000000", score: 0.6 },
        ],
      },
    ];
    const rows = mapApiResults(results, oracle);
    expect(rows[0]).toMatchObject({
      topScore: 0.95,
      secondScore: 0.6,
      candidateCount: 2,
      candidateNumbers: ["1000000000000", "3000000000000"],
      productionConfidence: "confident",
      productionMatchedNumber: "1000000000000",
      truth: "1000000000000",
      ambiguous: false,
    });
  });

  it("review 行でも候補配列の番号を candidateNumbers に保持する（低閾値カーブ・救済率用）", () => {
    // topScore<0.85 で production は review だが top 候補は truth。カーブの低閾値点で
    // 精度を正しく出すには候補番号を残す必要がある。
    const results: ApiBatchResultRow[] = [
      {
        row_index: 0,
        confidence: "review",
        score: 0.72,
        candidate_count: 1,
        matched_corporate_number: "1000000000000",
        candidates: [{ corporate_number: "1000000000000", score: 0.72 }],
      },
    ];
    const rows = mapApiResults(results, oracle);
    expect(rows[0]!.candidateNumbers).toEqual(["1000000000000"]);
    expect(rows[0]!.productionConfidence).toBe("review");
    expect(rows[0]!.productionMatchedNumber).toBe("1000000000000");
  });

  it("候補配列が省略された行は matched_corporate_number にフォールバックする", () => {
    const results: ApiBatchResultRow[] = [
      {
        row_index: 0,
        confidence: "confident",
        score: 0.95,
        candidate_count: 1,
        matched_corporate_number: "1000000000000",
      },
    ];
    const rows = mapApiResults(results, oracle);
    expect(rows[0]!.candidateNumbers).toEqual(["1000000000000"]);
  });

  it("ambiguous オラクルの行は ambiguous フラグを引き継ぐ", () => {
    const results: ApiBatchResultRow[] = [
      {
        row_index: 1,
        confidence: "confident",
        score: 0.99,
        candidate_count: 1,
        matched_corporate_number: "9999999999999",
      },
    ];
    const rows = mapApiResults(results, oracle);
    expect(rows[0]!.ambiguous).toBe(true);
  });

  it("オラクルの caseType/absorbable を行に引き継ぐ（API モードの内訳集計用）", () => {
    const results: ApiBatchResultRow[] = [
      {
        row_index: 0,
        confidence: "confident",
        score: 0.95,
        candidate_count: 1,
        matched_corporate_number: "1000000000000",
      },
      {
        row_index: 1,
        confidence: "unmatched",
        score: 0.2,
        candidate_count: 0,
        matched_corporate_number: null,
      },
    ];
    const rows = mapApiResults(results, oracle);
    expect(rows[0]).toMatchObject({ caseType: "identity", absorbable: true });
    expect(rows[1]).toMatchObject({ caseType: "typo", absorbable: false });
  });

  it("オラクル未対応の row_index はスキップする", () => {
    const results: ApiBatchResultRow[] = [
      {
        row_index: 99,
        confidence: "confident",
        score: 0.95,
        candidate_count: 1,
        matched_corporate_number: "1000000000000",
      },
    ];
    expect(mapApiResults(results, oracle)).toHaveLength(0);
  });
});

describe("buildOracle row-index alignment", () => {
  // 都道府県コードは 5 列目（quoted 2 桁）。fixture SQL の VALUES 並びと一致させる。
  const FIXTURE_SQL =
    "INSERT INTO corporations (corporate_number, name, name_normalized, name_no_kind, prefecture_code, status) VALUES\n" +
    "('1000000000001', '甲社', 'コウシャ', 'コウシャ', '13', 'active'),\n" +
    "('1000000000002', '乙社', 'オツシャ', 'オツシャ', '27', 'active');";
  const emptyMeta = {
    seed: 0,
    nonAbsorbableRatio: 0,
    compositeRatio: 0,
    hintRatio: 0,
    hintSeed: 0,
    corpusSize: 2,
    ambiguousIndices: [] as number[],
  };

  it("keys the oracle by the API's one-based row_index and carries case metadata", async () => {
    const { buildOracle, parseFixtureCorps } = await import(
      "../run/run-benchmark.js"
    );
    const corps = parseFixtureCorps(FIXTURE_SQL);
    const generated = [
      { input: "甲社", caseType: "identity" as const, absorbable: true },
      { input: "乙社", caseType: "typo" as const, absorbable: false },
    ];
    const oracle = buildOracle(corps, generated, emptyMeta);
    // バッチAPIは row_index を投入順 index + 1 で割り当てるため 0 キーは存在しない。
    expect(oracle.has(0)).toBe(false);
    expect(oracle.get(1)?.truth).toBe("1000000000001");
    expect(oracle.get(2)?.truth).toBe("1000000000002");
    // ケースメタデータをグローバル row_index に沿って束ねる。
    expect(oracle.get(1)).toMatchObject({
      caseType: "identity",
      absorbable: true,
    });
    expect(oracle.get(2)).toMatchObject({ caseType: "typo", absorbable: false });
  });

  it("実効ambiguousメタデータの index に該当する行を ambiguous にする", async () => {
    const { buildOracle, parseFixtureCorps } = await import(
      "../run/run-benchmark.js"
    );
    // コーパスキーは重複しないが、build-fixture がヒント適用後の実効候補範囲で事前計算した
    // メタデータが 0/1 行を指すため、両行 ambiguous になる（メタデータのみを根拠にし、
    // DB直結モードの markEffectiveAmbiguity と同一集合へ揃う）。
    const corps = parseFixtureCorps(FIXTURE_SQL);
    const generated = [
      { input: "甲社", caseType: "typo" as const, absorbable: false },
      { input: "乙社", caseType: "typo" as const, absorbable: false },
    ];
    const oracle = buildOracle(corps, generated, {
      ...emptyMeta,
      ambiguousIndices: [0, 1],
    });
    expect(oracle.get(1)?.ambiguous).toBe(true);
    expect(oracle.get(2)?.ambiguous).toBe(true);
  });
});

describe("assertCompleteResults", () => {
  const resultRow = (rowIndex: number): ApiBatchResultRow => ({
    row_index: rowIndex,
    confidence: "unmatched",
    matched_corporate_number: null,
    score: 0,
    candidate_count: 0,
    candidates: [],
  });

  it("全行そろっていれば通す", async () => {
    const { assertCompleteResults } = await import("../run/run-benchmark.js");
    expect(() =>
      assertCompleteResults([resultRow(1), resultRow(2)], 2),
    ).not.toThrow();
  });

  it("欠落・重複・未知 index はいずれも fail する（部分データのexit 0防止）", async () => {
    const { assertCompleteResults } = await import("../run/run-benchmark.js");
    expect(() => assertCompleteResults([resultRow(1)], 2)).toThrow(/incomplete/);
    expect(() =>
      assertCompleteResults([resultRow(1), resultRow(1)], 2),
    ).toThrow(/duplicate/);
    expect(() =>
      assertCompleteResults([resultRow(1), resultRow(3)], 2),
    ).toThrow(/unexpected/);
  });
});
