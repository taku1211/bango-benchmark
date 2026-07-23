/**
 * API経由モードのバッチ投入ヘルパのテスト（DB 非依存・純関数）。
 *
 * 要点:
 *   - 投入 payload は parser が受け付けるフィールド名 `name` を使う（`inputName` 不可）。
 *   - 入力列を 1 ジョブ上限（1,000 行）以下へ分割し、オフセットを保持する。
 *   - ジョブ内 1 始まり row_index をグローバル 1 始まり index へ復元する。
 */
import { describe, expect, it } from "vitest";

import {
  type BatchInput,
  buildSubmitBody,
  chunkInputs,
  MAX_BATCH_ROWS,
  toGlobalRowIndex,
} from "../run/batch-submit.js";

function named(count: number): BatchInput[] {
  return Array.from({ length: count }, (_, i) => ({ name: `n${i}` }));
}

describe("buildSubmitBody", () => {
  it("companies を name フィールドで組む（inputName ではない）", () => {
    const body = buildSubmitBody([
      { name: "株式会社さくら" },
      { name: "有限会社さくら" },
    ]);
    expect(body).toEqual({
      companies: [{ name: "株式会社さくら" }, { name: "有限会社さくら" }],
    });
    // parser が受け付けないキーを送っていないことを固定する。
    expect(JSON.stringify(body)).not.toContain("inputName");
  });

  it("都道府県ヒントは prefecture_code で載せ、なしの行はキー自体を省く", () => {
    const body = buildSubmitBody([
      { name: "株式会社さくら", prefectureCode: "13" },
      { name: "有限会社さくら" },
    ]);
    expect(body.companies[0]).toEqual({
      name: "株式会社さくら",
      prefecture_code: "13",
    });
    // ヒントなしの行は prefecture_code キーを持たない（未指定を許容する parser 契約）。
    expect(body.companies[1]).toEqual({ name: "有限会社さくら" });
    expect("prefecture_code" in body.companies[1]!).toBe(false);
  });
});

describe("chunkInputs", () => {
  it("上限ちょうど（1,000 件）は 1 チャンク", () => {
    const chunks = chunkInputs(named(MAX_BATCH_ROWS));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.offset).toBe(0);
    expect(chunks[0]!.items).toHaveLength(MAX_BATCH_ROWS);
  });

  it("上限超（1,001 件）は 2 チャンクに割れる", () => {
    const chunks = chunkInputs(named(MAX_BATCH_ROWS + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.offset).toBe(0);
    expect(chunks[0]!.items).toHaveLength(MAX_BATCH_ROWS);
    expect(chunks[1]!.offset).toBe(MAX_BATCH_ROWS);
    expect(chunks[1]!.items).toHaveLength(1);
  });

  it("2,000 件は [0..999] と [1000..1999] のオフセットで割れる", () => {
    const chunks = chunkInputs(named(2000));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.offset).toBe(0);
    expect(chunks[1]!.offset).toBe(1000);
    // 各チャンクは元列の連続スライス。
    expect(chunks[0]!.items[0]!.name).toBe("n0");
    expect(chunks[1]!.items[0]!.name).toBe("n1000");
    expect(chunks[1]!.items.at(-1)!.name).toBe("n1999");
  });

  it("空入力は 0 チャンク", () => {
    expect(chunkInputs([])).toHaveLength(0);
  });
});

describe("toGlobalRowIndex", () => {
  it("ジョブ内 1 始まり index をオフセットで束ねてグローバル index にする", () => {
    // 先頭チャンク（offset 0）は 1 始まりのまま。
    expect(toGlobalRowIndex(0, 1)).toBe(1);
    // 2 番目チャンク（offset 1000）のジョブ内 index 1 はグローバル 1001。
    expect(toGlobalRowIndex(1000, 1)).toBe(1001);
    expect(toGlobalRowIndex(1000, 1000)).toBe(2000);
  });
});
