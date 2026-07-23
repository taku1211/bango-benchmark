/**
 * 生成入力の衝突検出（markInputCollisions）のテスト。
 *
 * 要点:
 *   - 異なる 2 社が同一の照合キーを生む入力を持つと両行 ambiguous になる。
 *   - 3 社以上の衝突は全行 ambiguous。
 *   - 同一キーでも真値が同一なら（同一法人の別表記）ambiguous としない。
 *   - 空キー入力はグルーピングから除外し、ambiguous にしない。
 *   - キー化関数を注入し、正規化系（キー化後の一致）でも衝突を拾える。
 */
import { describe, expect, it } from "vitest";

import {
  type EffectiveAmbiguityRow,
  markEffectiveAmbiguity,
  markInputCollisions,
} from "../run/input-collision.js";

const identity = (input: string) => input;

describe("markInputCollisions", () => {
  it("異なる2社が同一入力を生成すると両行 ambiguous", () => {
    const flags = markInputCollisions(
      [
        { input: "サンプル", truth: "1000000000000" },
        { input: "サンプル", truth: "2000000000000" },
      ],
      identity,
    );
    expect(flags).toEqual([true, true]);
  });

  it("衝突しない入力は ambiguous にしない", () => {
    const flags = markInputCollisions(
      [
        { input: "甲社", truth: "1000000000000" },
        { input: "乙社", truth: "2000000000000" },
      ],
      identity,
    );
    expect(flags).toEqual([false, false]);
  });

  it("3社の衝突は3行とも ambiguous、非衝突行は据え置き", () => {
    const flags = markInputCollisions(
      [
        { input: "共通", truth: "1000000000000" },
        { input: "共通", truth: "2000000000000" },
        { input: "共通", truth: "3000000000000" },
        { input: "単独", truth: "4000000000000" },
      ],
      identity,
    );
    expect(flags).toEqual([true, true, true, false]);
  });

  it("同一キーでも真値が同一なら ambiguous としない（同一法人の別表記）", () => {
    const flags = markInputCollisions(
      [
        { input: "サンプル", truth: "1000000000000" },
        { input: "サンプル", truth: "1000000000000" },
      ],
      identity,
    );
    expect(flags).toEqual([false, false]);
  });

  it("空キーになる行はグルーピングから除外し ambiguous にしない", () => {
    // 法人格語のみ等でキーが空になる行は、たとえ複数あっても衝突扱いにしない。
    const keyFn = (input: string) => (input === "株式会社" ? "" : input);
    const flags = markInputCollisions(
      [
        { input: "株式会社", truth: "1000000000000" },
        { input: "株式会社", truth: "2000000000000" },
        { input: "実体名", truth: "3000000000000" },
      ],
      keyFn,
    );
    expect(flags).toEqual([false, false, false]);
  });

  it("キー化関数を通した後の一致で衝突を検出する", () => {
    // 生入力は異なるが keyFn（例: 空白除去）で同一キーへ畳み込まれる 2 社は衝突。
    const stripSpaces = (input: string) => input.replace(/\s+/g, "");
    const flags = markInputCollisions(
      [
        { input: "サン プル", truth: "1000000000000" },
        { input: "サンプル", truth: "2000000000000" },
      ],
      stripSpaces,
    );
    expect(flags).toEqual([true, true]);
  });
});

describe("markEffectiveAmbiguity 入力起点の判定", () => {
  const sakura = (over: Partial<EffectiveAmbiguityRow>): EffectiveAmbiguityRow => ({
    truth: "1000000000001",
    prefecture: "13",
    hint: false,
    corpusNormalizedKey: "株式会社さくら",
    corpusNoKindKey: "さくら",
    inputKey: "株式会社さくら",
    inputNoKindKey: "さくら",
    ...over,
  });

  it("法人格違いの同名は、入力が法人格を保持していれば一意（非ambiguous）", () => {
    // (株)さくら 等の入力は with-kind キーで 株式会社さくら をちょうど1行特定できる。
    const rows = [
      sakura({}),
      sakura({
        truth: "1000000000002",
        corpusNormalizedKey: "有限会社さくら",
        inputKey: "有限会社さくら",
      }),
    ];
    expect(markEffectiveAmbiguity(rows)).toEqual([false, false]);
  });

  it("入力が法人格を失うと no-kind 空間の同名複数で ambiguous になる", () => {
    // kind_drop 等で入力が「さくら」になると 株/有限 のどちらか選べない。
    const rows = [
      sakura({ inputKey: "さくら" }),
      sakura({
        truth: "1000000000002",
        corpusNormalizedKey: "有限会社さくら",
        inputKey: "有限会社さくら",
      }),
    ];
    expect(markEffectiveAmbiguity(rows)).toEqual([true, false]);
  });

  it("完全正規化名が重複するコーパス行は入力に依らず ambiguous", () => {
    const rows = [
      sakura({}),
      sakura({ truth: "1000000000002" }),
    ];
    expect(markEffectiveAmbiguity(rows)).toEqual([true, true]);
  });
});
