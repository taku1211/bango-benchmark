/**
 * ベンチマーク共有設定（都道府県ヒント抽選）のテスト。
 *
 * 要点:
 *   - hasPrefectureHint は決定論（同一 index で同一結果）。摂動 PRNG を消費しない独立系統。
 *   - 目標比率の近傍にヒント付与率が収まる（一定比率で付く）。
 */
import { describe, expect, it } from "vitest";

import { hasPrefectureHint, HINT_RATIO } from "../run/benchmark-config.js";

describe("hasPrefectureHint", () => {
  it("同一 index で決定論的に同じ結果を返す", () => {
    for (const i of [0, 1, 7, 42, 1999]) {
      expect(hasPrefectureHint(i)).toBe(hasPrefectureHint(i));
    }
  });

  it("2,000 行での付与率が目標比率の近傍に収まる", () => {
    let hinted = 0;
    const n = 2000;
    for (let i = 0; i < n; i += 1) {
      if (hasPrefectureHint(i)) {
        hinted += 1;
      }
    }
    const frac = hinted / n;
    // 決定論ハッシュの一様性で目標比率へ寄る（±0.05 の緩い帯で固定）。
    expect(frac).toBeGreaterThan(HINT_RATIO - 0.05);
    expect(frac).toBeLessThan(HINT_RATIO + 0.05);
  });

  it("ratio=0 なら全行ヒントなし・ratio=1 なら全行ヒントあり", () => {
    for (const i of [0, 5, 99]) {
      expect(hasPrefectureHint(i, 0)).toBe(false);
      expect(hasPrefectureHint(i, 1)).toBe(true);
    }
  });
});
