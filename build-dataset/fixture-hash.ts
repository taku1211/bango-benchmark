/**
 * 合成コーパス fixture SQL のハッシュ（baseline / manifest キー）。
 *
 * baseline.json と dataset-manifest.json が同一アルゴリズム・同一ファイルから
 * fixtureHash を確定できるよう、SQL テキストの sha256 先頭 16 桁を返す純関数に
 * 切り出す。内容が変われば baseline を無効化し、manifest の焼き込み値も追従する。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/synthetic-corporations.sql",
);

/** 与えた SQL テキストの sha256 先頭 16 桁を返す。 */
export function fixtureHashOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

/** コミット済み fixture SQL の fixtureHash を返す。 */
export function fixtureHash(): string {
  return fixtureHashOf(readFileSync(FIXTURE_PATH, "utf8"));
}
