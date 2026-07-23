/**
 * 合成コーパス生成器のテスト（normalizer 非依存）。
 *
 * 要点:
 *   - 決定論性: 同一シード・同一規模で完全に同じ列を返す（第三者再現の核）。
 *   - 代表 23 ケース（異体字・略記・同名多数「さくら」）を必ず保持する。
 *   - 約 2,000 行規模で、捏造 13 桁番号が一意、ambiguous（no-kind 衝突）を一定量含む。
 *   - build-fixture が焼き込む正規化列に依存しないよう、本モジュールは表示名のみを扱う。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildSyntheticCorps,
  SYNTHETIC_CORPS,
  TARGET_CORPUS_SIZE,
} from "../build-dataset/synthetic-corpus.js";

const REPRESENTATIVE_NAMES = [
  "株式会社高崎製作所",
  "有限会社浜辺商店",
  "株式会社さくら",
  "有限会社さくら",
  "さくら株式会社",
  "邊見建設株式会社",
  "株式会社濱口水産",
];

describe("buildSyntheticCorps", () => {
  it("同一シード・同一規模で完全に同じ列を返す（決定論性）", () => {
    const a = buildSyntheticCorps(123, 500);
    const b = buildSyntheticCorps(123, 500);
    expect(b).toEqual(a);
  });

  it("異なるシードでは列が変化する", () => {
    const a = buildSyntheticCorps(1, 500).map((c) => c.name).join("|");
    const b = buildSyntheticCorps(2, 500).map((c) => c.name).join("|");
    expect(b).not.toEqual(a);
  });

  it("約 2,000 行規模である", () => {
    expect(SYNTHETIC_CORPS.length).toBe(TARGET_CORPUS_SIZE);
    expect(TARGET_CORPUS_SIZE).toBeGreaterThanOrEqual(1900);
  });

  it("代表ケース（異体字・略記・同名多数さくら）を必ず保持する", () => {
    const names = new Set(SYNTHETIC_CORPS.map((c) => c.name));
    for (const rep of REPRESENTATIVE_NAMES) {
      expect(names.has(rep)).toBe(true);
    }
  });

  it("捏造 13 桁番号が全件一意で 13 桁である", () => {
    const numbers = SYNTHETIC_CORPS.map((c) => c.corporateNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) {
      expect(n).toMatch(/^\d{13}$/);
    }
  });

  it("都道府県コードが 2 桁である", () => {
    for (const corp of SYNTHETIC_CORPS) {
      expect(corp.prefectureCode).toMatch(/^\d{2}$/);
    }
  });

  it("ambiguous（法人格を除いたコア名が重複する）ケースを制御された比率で含む", () => {
    // 法人格語をざっくり剥がしたコア名で重複を数える（正規化辞書に依存しない粗い判定）。
    const kinds = ["株式会社", "有限会社", "合同会社", "工業株式会社"];
    const stripKind = (name: string): string => {
      let core = name;
      for (const k of kinds) {
        if (core.startsWith(k)) {
          core = core.slice(k.length);
        }
        if (core.endsWith(k)) {
          core = core.slice(0, core.length - k.length);
        }
      }
      return core;
    };
    const counts = new Map<string, number>();
    for (const corp of SYNTHETIC_CORPS) {
      counts.set(stripKind(corp.name), (counts.get(stripKind(corp.name)) ?? 0) + 1);
    }
    // 衝突コアに属する行数（＝ ambiguous 行の目安）の比率。上下限で挟み、生成分の偶発
    // 衝突で ambiguous が過半を占める退化コーパスを防ぐ（下限で代表さくら＋意図的比率も担保）。
    const ambiguousRows = [...counts.values()]
      .filter((n) => n > 1)
      .reduce((sum, n) => sum + n, 0);
    const frac = ambiguousRows / SYNTHETIC_CORPS.length;
    expect(frac).toBeGreaterThan(0.02);
    expect(frac).toBeLessThan(0.2);
  });

  it("完全一致の表示名重複を作らない（意図的衝突は法人格違いで表示名を変える）", () => {
    const nameCounts = new Map<string, number>();
    for (const corp of SYNTHETIC_CORPS) {
      nameCounts.set(corp.name, (nameCounts.get(corp.name) ?? 0) + 1);
    }
    const exactDuplicates = [...nameCounts.values()].filter((n) => n > 1);
    expect(exactDuplicates).toHaveLength(0);
  });

  it("合成コーパス生成器が正規化辞書を import しない", () => {
    // 依存境界の静的検査: 焼き込み列（正規化）は build-fixture 側の責務で、生成器は
    // @houjin/normalizer を引かない（表示名のみを扱う）。
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../build-dataset/synthetic-corpus.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+"@houjin\/normalizer"/);
    expect(source).not.toMatch(/require\("@houjin\/normalizer"\)/);
  });
});
