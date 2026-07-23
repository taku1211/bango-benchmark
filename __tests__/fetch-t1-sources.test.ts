/**
 * T1 実在ペア調達スケルトンのテスト。
 *
 * v1 スコープは「スケルトン + 手順」に限定し、ネットワーク取得は実装しない。
 * 取得を試みると明示的に throw して未実装であることを示す（誤って空の T1 セットで
 * 計測されるのを防ぐ）。依存境界（正規化辞書非依存）も静的に確認する。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fetchT1Sources } from "../build-dataset/fetch-t1-sources.js";

describe("fetchT1Sources", () => {
  it("v1 では未実装として throw する（空セットで黙って計測しない）", async () => {
    await expect(
      fetchT1Sources([
        {
          kind: "edinet-code-list",
          url: "https://example.invalid/edinet.csv",
          fetchedAt: "2026-07-17",
        },
      ]),
    ).rejects.toThrow(/not implemented/i);
  });

  it("スケルトンが正規化辞書を import しない", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../build-dataset/fetch-t1-sources.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+"@houjin\/normalizer"/);
    expect(source).not.toMatch(/require\("@houjin\/normalizer"\)/);
  });
});
