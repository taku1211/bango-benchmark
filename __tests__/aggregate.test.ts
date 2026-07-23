/**
 * 集計層のテスト。
 *
 * 要点:
 *   - 0件/全confident/全unmatched/ambiguous分離/別番号confident の境界。
 *   - per-row レコードからカバレッジ-精度カーブを閾値掃引で再構成する。
 */
import { describe, expect, it } from "vitest";

import {
  type BenchmarkRow,
  caseBreakdown,
  coveragePrecisionCurve,
  DEFAULT_CURVE_THRESHOLDS,
  summarize,
} from "../report/aggregate.js";

function row(overrides: Partial<BenchmarkRow>): BenchmarkRow {
  return {
    topScore: 0,
    secondScore: 0,
    candidateCount: 0,
    candidateNumbers: [],
    productionConfidence: "unmatched",
    productionMatchedNumber: null,
    truth: "1000000000000",
    ambiguous: false,
    caseType: "identity",
    absorbable: true,
    hintPrefecture: false,
    ...overrides,
  };
}

/** production が confident を返した正解行。 */
function confidentCorrect(overrides: Partial<BenchmarkRow> = {}): BenchmarkRow {
  return row({
    topScore: 0.95,
    candidateCount: 1,
    candidateNumbers: ["1000000000000"],
    productionConfidence: "confident",
    productionMatchedNumber: "1000000000000",
    truth: "1000000000000",
    ...overrides,
  });
}

describe("summarize", () => {
  it("0件入力で全指標が0（NaN を出さない）", () => {
    const s = summarize([]);
    expect(s.coverage).toBe(0);
    expect(s.confidentPrecision).toBe(0);
    expect(s.reviewRate).toBe(0);
    expect(s.unmatchedRate).toBe(0);
    expect(Number.isNaN(s.confidentPrecision)).toBe(false);
  });

  it("全件confident正解でカバレッジ1.0・精度1.0", () => {
    const rows = [confidentCorrect(), confidentCorrect({ topScore: 0.9 })];
    const s = summarize(rows);
    expect(s.coverage).toBe(1);
    expect(s.confidentPrecision).toBe(1);
  });

  it("全件unmatchedでカバレッジ0", () => {
    const rows = [
      row({ topScore: 0.1, productionConfidence: "unmatched" }),
      row({ topScore: 0, productionConfidence: "unmatched" }),
    ];
    const s = summarize(rows);
    expect(s.coverage).toBe(0);
    expect(s.unmatchedRate).toBe(1);
  });

  it("ambiguous行はconfident精度の分母からのみ分離される（率系分母には残る）", () => {
    const rows = [
      confidentCorrect(),
      confidentCorrect({
        topScore: 0.99,
        candidateNumbers: ["9999999999999"],
        productionMatchedNumber: "9999999999999",
        ambiguous: true,
      }),
    ];
    const s = summarize(rows);
    // 全評価行 N=2（率系分母）。精度の実分母は confident 全行（2件）。
    expect(s.evaluated).toBe(2);
    expect(s.precisionEvaluated).toBe(2);
    expect(s.ambiguousRows).toBe(1);
    // カバレッジは全 N を分母にする → 2 件とも confident なので 1.0。
    expect(s.coverage).toBe(1);
    // 精度分母は confident 全行（2件）。実効 ambiguous の confident 化は「review が正解」の
    // 違反＝失敗として分子に入れないため、精度は 1/2 に下がりゲートが劣化を検知できる。
    expect(s.confidentPrecision).toBe(0.5);
    expect(s.ambiguousConfidentViolations).toBe(1);
  });

  it("率系（coverage/review/unmatched/偽陰性）は ambiguous を含む全 N を分母にする", () => {
    const rows = [
      // 非 ambiguous confident 正解。
      confidentCorrect(),
      // ambiguous だが production は review（同名多数を review に落とせている）。
      row({
        productionConfidence: "review",
        candidateNumbers: ["1000000000000"],
        ambiguous: true,
      }),
      // unmatched。
      row({ productionConfidence: "unmatched" }),
    ];
    const s = summarize(rows);
    expect(s.evaluated).toBe(3);
    expect(s.coverage).toBeCloseTo(1 / 3);
    expect(s.reviewRate).toBeCloseTo(1 / 3);
    expect(s.unmatchedRate).toBeCloseTo(1 / 3);
    expect(s.falseNegativeRate).toBeCloseTo(1 / 3);
  });

  it("実効 ambiguous 行の confident 化はヒント有無を問わず違反に計上する", () => {
    // ambiguity はヒント適用後の実効候補範囲で判定済み。ヒント付きで残る ambiguous は
    // ヒントでも一意化できなかった行であり、confident 化は同様に違反。
    const rows = [
      confidentCorrect({ ambiguous: true, hintPrefecture: false }),
      confidentCorrect({ ambiguous: true, hintPrefecture: true }),
      // 非 ambiguous confident は違反と無関係。
      confidentCorrect(),
    ];
    const s = summarize(rows);
    expect(s.ambiguousConfidentViolations).toBe(2);
  });

  it("ヒント有無別の coverage・confident 精度を分けて集計する", () => {
    const rows = [
      // ヒントあり: 2件 confident・両方正解 → coverage 1.0 / precision 1.0。
      confidentCorrect({ hintPrefecture: true }),
      confidentCorrect({ hintPrefecture: true }),
      // ヒントなし: 2件中 1件 confident（正解）・1件 unmatched → coverage 0.5 / precision 1.0。
      confidentCorrect({ hintPrefecture: false }),
      row({ hintPrefecture: false, productionConfidence: "unmatched" }),
    ];
    const s = summarize(rows);
    expect(s.hintPresent.total).toBe(2);
    expect(s.hintPresent.coverage).toBe(1);
    expect(s.hintPresent.confidentPrecision).toBe(1);
    expect(s.hintAbsent.total).toBe(2);
    expect(s.hintAbsent.coverage).toBe(0.5);
    expect(s.hintAbsent.confidentPrecision).toBe(1);
  });

  it("別法人番号へのconfidentは失敗として計上される", () => {
    const rows = [
      confidentCorrect(),
      confidentCorrect({
        candidateNumbers: ["2222222222222"],
        productionMatchedNumber: "2222222222222",
      }),
    ];
    const s = summarize(rows);
    expect(s.coverage).toBe(1);
    expect(s.confidentPrecision).toBe(0.5);
  });

  it("production が review を返した行は review へ計上される", () => {
    const rows = [
      row({
        topScore: 0.9,
        secondScore: 0.85,
        candidateCount: 2,
        candidateNumbers: ["1000000000000"],
        productionConfidence: "review",
        productionMatchedNumber: "1000000000000",
      }),
    ];
    const s = summarize(rows);
    expect(s.coverage).toBe(0);
    expect(s.reviewRate).toBe(1);
  });

  it("ヘッドラインは production の confidence 経路から出る（判定式を再計算しない）", () => {
    // production が緩和され topScore=0.80 でも confident を返すと、その誤りは
    // ゲート対象 confidentPrecision に反映される。判定式を 0.85 でハードコード
    // 再計算していたら 0.80<0.85 でこの行は confident に数えられず精度は動かない。
    const rows = [
      confidentCorrect(),
      row({
        topScore: 0.8,
        candidateCount: 1,
        candidateNumbers: ["9999999999999"],
        productionConfidence: "confident",
        productionMatchedNumber: "9999999999999",
        truth: "1000000000000",
      }),
    ];
    const s = summarize(rows);
    expect(s.coverage).toBe(1);
    expect(s.confidentPrecision).toBe(0.5);
  });

  it("review救済率は真値が候補5件内に居るreview行の割合（top2-5も救済）", () => {
    // 3 件の review 行:
    //   (1) 真値が候補先頭 → 救済
    //   (2) 真値が候補4番目（top2-5）→ 救済
    //   (3) 真値が候補外 → 非救済
    const reviewRow = (candidateNumbers: string[]): BenchmarkRow =>
      row({
        productionConfidence: "review",
        candidateNumbers,
        truth: "1000000000000",
      });
    const rows = [
      reviewRow(["1000000000000", "2000000000000"]),
      reviewRow([
        "2000000000000",
        "3000000000000",
        "4000000000000",
        "1000000000000",
      ]),
      reviewRow(["2000000000000", "3000000000000"]),
    ];
    const s = summarize(rows);
    expect(s.reviewRate).toBe(1);
    expect(s.reviewRescueRate).toBeCloseTo(2 / 3);
  });

  it("review行が0件なら救済率は0（NaNを出さない）", () => {
    const s = summarize([confidentCorrect()]);
    expect(s.reviewRescueRate).toBe(0);
    expect(Number.isNaN(s.reviewRescueRate)).toBe(false);
  });

  it("偽陰性率はunmatched行の割合（reviewは偽陰性に数えない）", () => {
    const rows = [
      confidentCorrect(),
      row({ productionConfidence: "review", candidateNumbers: ["x"] }),
      row({ productionConfidence: "unmatched" }),
      row({ productionConfidence: "unmatched" }),
    ];
    const s = summarize(rows);
    // 4 行中 unmatched は 2 件 → 偽陰性率 0.5。review は分子に入らない。
    expect(s.falseNegativeRate).toBe(0.5);
  });
});

describe("coveragePrecisionCurve", () => {
  it("既定の閾値掃引（0.70〜0.95・gap固定）で各点を返す", () => {
    const rows = [
      row({
        topScore: 0.8,
        candidateCount: 1,
        candidateNumbers: ["1000000000000"],
      }),
    ];
    const curve = coveragePrecisionCurve(rows);
    expect(curve.map((p) => p.threshold)).toEqual([...DEFAULT_CURVE_THRESHOLDS]);
  });

  it("閾値を上げるとカバレッジは単調に下がる", () => {
    const rows = [
      row({
        topScore: 0.72,
        candidateCount: 1,
        candidateNumbers: ["1000000000000"],
      }),
      row({
        topScore: 0.88,
        candidateCount: 1,
        candidateNumbers: ["1000000000000"],
      }),
      row({
        topScore: 0.93,
        candidateCount: 1,
        candidateNumbers: ["1000000000000"],
      }),
    ];
    const curve = coveragePrecisionCurve(rows);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.coverage).toBeLessThanOrEqual(curve[i - 1]!.coverage);
    }
    // 0.70 では 3 件全て confident, 0.95 では 0 件。
    expect(curve[0]!.coverage).toBeCloseTo(1);
    expect(curve.at(-1)!.coverage).toBe(0);
  });

  it("ambiguous行はカーブの分母からも除外される", () => {
    const rows = [
      row({
        topScore: 0.9,
        candidateCount: 1,
        candidateNumbers: ["1000000000000"],
      }),
      row({ topScore: 0.9, candidateCount: 1, ambiguous: true }),
    ];
    const curve = coveragePrecisionCurve(rows, [0.85]);
    expect(curve[0]!.coverage).toBe(1);
  });

  it("低閾値点は production が review でも top 候補が正解なら精度に正しく計上する", () => {
    // production は topScore=0.72 で review（confident 未満）だが top 候補は正解。
    // カーブは無条件保持の candidateNumbers[0] で正誤を判定するので 0.70 点の精度は
    // 1.0 になる。旧実装は confident のみに付く matchedNumber を使い null 扱いで
    // 精度 0 に潰していた（この行がその回帰の固定）。
    const rows = [
      row({
        topScore: 0.72,
        candidateCount: 1,
        candidateNumbers: ["1000000000000"],
        productionConfidence: "review",
        productionMatchedNumber: "1000000000000",
        truth: "1000000000000",
      }),
    ];
    const curve = coveragePrecisionCurve(rows, [0.7]);
    expect(curve[0]!.coverage).toBe(1);
    expect(curve[0]!.precision).toBe(1);
  });
});

describe("caseBreakdown", () => {
  it("拡張された全ケース種別（複合含む）が内訳に現れる", () => {
    // 許可リストの手書き乖離で新ファミリーが公開内訳から黙って脱落しないこと。
    const rows = [
      confidentCorrect({ caseType: "kind_drop", absorbable: true }),
      confidentCorrect({ caseType: "width", absorbable: true }),
      confidentCorrect({ caseType: "long_sound", absorbable: true }),
      row({ caseType: "kana", absorbable: false }),
      row({ caseType: "abbrev", absorbable: false }),
      confidentCorrect({ caseType: "composite", absorbable: true }),
      row({ caseType: "composite", absorbable: false }),
    ];
    const breakdown = caseBreakdown(rows);
    const types = breakdown.map((b) => `${b.caseType}:${b.absorbable}`);
    expect(types).toContain("kind_drop:true");
    expect(types).toContain("width:true");
    expect(types).toContain("long_sound:true");
    expect(types).toContain("kana:false");
    expect(types).toContain("abbrev:false");
    // composite は吸収可否が行ごとに異なるため吸収/非吸収の別行に分割される。
    expect(types).toContain("composite:true");
    expect(types).toContain("composite:false");
  });


  it("ケース種別ごとに件数・カバレッジ・confident精度を集計する", () => {
    const rows = [
      // identity: 2件 confident・両方正解 → coverage 1.0 / precision 1.0
      confidentCorrect({ caseType: "identity", absorbable: true }),
      confidentCorrect({ caseType: "identity", absorbable: true }),
      // typo: 2件・1件 confident（誤爆）・1件 unmatched → coverage 0.5 / precision 0
      row({
        caseType: "typo",
        absorbable: false,
        productionConfidence: "confident",
        productionMatchedNumber: "2222222222222",
        truth: "1000000000000",
      }),
      row({
        caseType: "typo",
        absorbable: false,
        productionConfidence: "unmatched",
      }),
    ];
    const breakdown = caseBreakdown(rows);
    const identity = breakdown.find((b) => b.caseType === "identity");
    const typo = breakdown.find((b) => b.caseType === "typo");
    expect(identity).toMatchObject({
      absorbable: true,
      evaluated: 2,
      coverage: 1,
      confidentPrecision: 1,
    });
    expect(typo).toMatchObject({
      absorbable: false,
      evaluated: 2,
      coverage: 0.5,
      confidentPrecision: 0,
    });
  });

  it("ambiguous 行の confident 化は内訳でもヘッドラインと同じく失敗として計上する", () => {
    const rows = [
      // 非 ambiguous confident 正解。
      confidentCorrect({ caseType: "variant", absorbable: true }),
      // 実効 ambiguous の confident 化（review が正解の違反＝失敗）。
      confidentCorrect({
        caseType: "variant",
        absorbable: true,
        ambiguous: true,
        candidateNumbers: ["9999999999999"],
        productionMatchedNumber: "9999999999999",
      }),
    ];
    const variant = caseBreakdown(rows).find((b) => b.caseType === "variant");
    // coverage の分母は総数 2（両方 confident）→ 1.0。
    expect(variant?.evaluated).toBe(2);
    expect(variant?.coverage).toBe(1);
    // 精度分母は confident 全行（2件）。ambiguous confident は失敗計上 → 1/2。
    // バケットだけ除外扱いにするとヘッドライン（失敗計上済み）と食い違うため同一ルール。
    expect(variant?.confidentPrecision).toBe(0.5);
  });

  it("出力順は生成器のケース列挙順（吸収系→非吸収系）で安定する", () => {
    const rows = [
      row({ caseType: "partial", absorbable: false }),
      row({ caseType: "identity", absorbable: true }),
      row({ caseType: "spacing", absorbable: true }),
    ];
    const breakdown = caseBreakdown(rows);
    expect(breakdown.map((b) => b.caseType)).toEqual([
      "identity",
      "spacing",
      "partial",
    ]);
  });
});
