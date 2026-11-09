/**
 * DB直結ベンチマークのコアループのテスト（DB 非依存・依存注入）。
 *
 * 要点:
 *   - 候補取得は注入された searchCandidates 経由（インライン SQL を持たない）。
 *   - 各摂動入力に buildMatchingKey を適用してから searchCandidates に渡す（生入力不可）。
 *   - ランク判定に注入された rankCandidates を用いる。
 */
import { describe, expect, it, vi } from "vitest";

import {
  type BenchmarkInputCase,
  type RankOutcome,
  runBenchmarkCore,
} from "../run/run-benchmark-core.js";

const CASES: BenchmarkInputCase[] = [
  {
    input: "髙崎製作所株式会社",
    truth: "1000000000000",
    ambiguous: false,
    caseType: "variant",
    absorbable: true,
  },
  {
    input: "山田工業（同）",
    truth: "2000000000000",
    ambiguous: true,
    caseType: "shorthand",
    absorbable: true,
  },
];

function confidentOutcome(number: string): RankOutcome {
  return {
    confidence: "confident",
    matchedCorporateNumber: number,
    score: 0.95,
    candidateCount: 1,
  };
}

describe("runBenchmarkCore", () => {
  it("各入力に buildMatchingKey を適用してから searchCandidates に渡す", async () => {
    const buildMatchingKey = vi.fn((input: string) => `key:${input}`);
    const searchCandidates = vi.fn(async () => [
      {
        corporateNumber: "1000000000000",
        name: "髙崎製作所株式会社",
        nameKana: null,
        score: 0.95,
      },
    ]);
    const rankCandidates = vi.fn(() => confidentOutcome("1000000000000"));

    await runBenchmarkCore(CASES, {
      buildMatchingKey,
      searchCandidates,
      rankCandidates,
    });

    expect(buildMatchingKey).toHaveBeenCalledWith("髙崎製作所株式会社");
    // searchCandidates は照合キー化済みの入力を受け取る（生入力ではない）。ヒントなしの
    // 行は prefectureCode を undefined で渡す。
    expect(searchCandidates).toHaveBeenCalledWith({
      inputNameNormalized: "key:髙崎製作所株式会社",
      prefectureCode: undefined,
    });
    expect(searchCandidates).not.toHaveBeenCalledWith({
      inputNameNormalized: "髙崎製作所株式会社",
      prefectureCode: undefined,
    });
  });

  it("prefectureHint 付きの行は prefectureCode として searchCandidates へ渡し hintPrefecture を立てる", async () => {
    const searchCandidates = vi.fn(async () => [
      {
        corporateNumber: "1000000000000",
        name: "髙崎製作所株式会社",
        nameKana: null,
        score: 0.95,
      },
    ]);
    const rankCandidates = vi.fn(() => confidentOutcome("1000000000000"));
    const rows = await runBenchmarkCore(
      [{ ...CASES[0]!, prefectureHint: "13" }],
      { buildMatchingKey: (i) => i, searchCandidates, rankCandidates },
    );
    expect(searchCandidates).toHaveBeenCalledWith({
      inputNameNormalized: "髙崎製作所株式会社",
      prefectureCode: "13",
    });
    expect(rows[0]!.hintPrefecture).toBe(true);
  });

  it("候補取得は注入 searchCandidates 経由で行われる（各入力ごとに呼ばれる）", async () => {
    const searchCandidates = vi.fn(async () => [
      {
        corporateNumber: "1000000000000",
        name: "髙崎製作所株式会社",
        nameKana: null,
        score: 0.9,
      },
    ]);
    const rankCandidates = vi.fn(() => confidentOutcome("1000000000000"));

    await runBenchmarkCore(CASES, {
      buildMatchingKey: (i) => i,
      searchCandidates,
      rankCandidates,
    });

    expect(searchCandidates).toHaveBeenCalledTimes(CASES.length);
  });

  it("ランク判定に注入 rankCandidates を用い、per-row レコードを組み立てる", async () => {
    const candidates = [
      {
        corporateNumber: "1000000000000",
        name: "髙崎製作所株式会社",
        nameKana: null,
        score: 0.95,
      },
      {
        corporateNumber: "3000000000000",
        name: "山田工業合同会社",
        nameKana: null,
        score: 0.7,
      },
    ];
    const searchCandidates = vi.fn(async () => candidates);
    const rankCandidates = vi.fn(() => confidentOutcome("1000000000000"));

    const rows = await runBenchmarkCore([CASES[0]!], {
      buildMatchingKey: (i) => i,
      searchCandidates,
      rankCandidates,
    });

    expect(rankCandidates).toHaveBeenCalledWith(candidates, {
      inputNameNormalized: CASES[0]!.input,
    });
    expect(rows[0]).toMatchObject({
      topScore: 0.95,
      secondScore: 0.7,
      candidateCount: 2,
      candidateNumbers: ["1000000000000", "3000000000000"],
      productionConfidence: "confident",
      productionMatchedNumber: "1000000000000",
      truth: "1000000000000",
      ambiguous: false,
      caseType: "variant",
      absorbable: true,
    });
  });

  it("候補番号は confidence に関わらず無条件保持する（低閾値カーブ・救済率用）", async () => {
    // production が review でも候補番号を candidateNumbers に残す。
    // production の confidence/番号は別フィールドに忠実記録する。
    const searchCandidates = vi.fn(async () => [
      {
        corporateNumber: "1000000000000",
        name: "髙崎製作所株式会社",
        nameKana: null,
        score: 0.7,
      },
    ]);
    const rankCandidates = vi.fn(
      (): RankOutcome => ({
        confidence: "review",
        matchedCorporateNumber: "1000000000000",
        score: 0.7,
        candidateCount: 1,
      }),
    );

    const rows = await runBenchmarkCore([CASES[0]!], {
      buildMatchingKey: (i) => i,
      searchCandidates,
      rankCandidates,
    });

    expect(rows[0]!.candidateNumbers).toEqual(["1000000000000"]);
    expect(rows[0]!.productionConfidence).toBe("review");
    expect(rows[0]!.productionMatchedNumber).toBe("1000000000000");
  });

  it("候補ゼロなら candidateNumbers は空配列", async () => {
    const searchCandidates = vi.fn(async () => []);
    const rankCandidates = vi.fn(
      (): RankOutcome => ({
        confidence: "unmatched",
        matchedCorporateNumber: null,
        score: 0,
        candidateCount: 0,
      }),
    );

    const rows = await runBenchmarkCore([CASES[0]!], {
      buildMatchingKey: (i) => i,
      searchCandidates,
      rankCandidates,
    });

    expect(rows[0]!.candidateNumbers).toEqual([]);
    expect(rows[0]!.productionConfidence).toBe("unmatched");
    expect(rows[0]!.productionMatchedNumber).toBeNull();
  });

  it("照合キーが空になる入力は unmatched 行として分母に残す", async () => {
    // production は空キー入力も行として処理し unmatched にするため、落とすと
    // 分母から静かに消え API モードとも件数がずれる。検索は呼ばず unmatched を出す。
    const searchCandidates = vi.fn(async () => []);
    const rankCandidates = vi.fn(() => confidentOutcome("x"));

    const rows = await runBenchmarkCore([CASES[0]!], {
      buildMatchingKey: () => "",
      searchCandidates,
      rankCandidates,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.productionConfidence).toBe("unmatched");
    expect(rows[0]!.candidateCount).toBe(0);
    expect(searchCandidates).not.toHaveBeenCalled();
  });
});
