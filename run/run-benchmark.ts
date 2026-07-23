/**
 * API経由ベンチマーク実行エントリ（第三者再現用・公開）。
 *
 * POST /v1/batch/match に生成入力を投入し、GET /v1/batch/{job_id} をポーリングして
 * 結果を取得する。正規化はサーバ側で走るため、第三者は API キーと生成入力（本リポの
 * 生成器 + シード）だけで DB直結モードと同一の計測を再現できる。集計は DB直結モードと
 * 同じ aggregate 層を共有する。
 *
 * バッチ照合は Growth 以上のプランが前提（Starter/Free は 403）。
 *
 * 前提: 対象APIのDBに fixture の合成コーパスが投入されていること。合成コーパスは
 * 捏造名・捏造番号のため、実データのみの本番APIに投げても全行 unmatched となり
 * 計測として無意味になる（fixture を seed した検証用インスタンスに向けること。
 * 実データベースのオラクル対応は T1 実在ペアコーパスの後続トラックで解禁される）。
 *
 * 実行:
 *   BENCHMARK_TARGET_KIND=fixture-seeded \
 *   BENCHMARK_TARGET_NORMALIZER_VERSION=<対象デプロイのnormalizer版（manifestのnormalizerVersionForFixtureと一致）> \
 *   BENCHMARK_TARGET_SIMILARITY_THRESHOLD=<対象デプロイの実効類似度閾値（manifestのmatchSimilarityThresholdと一致）> \
 *   BENCHMARK_API_BASE_URL=<fixtureをseed済みの検証APIベースURL> \
 *   BENCHMARK_API_KEY=... \
 *   npx tsx run/run-benchmark.ts fixtures/synthetic-corporations.sql
 *
 * プラン注意: 本実行は 2,000 行を一括投入する。Growth の月間バッチ行クォータは
 * 2,000 行で、1 回の実行で使い切る（失敗時の再実行も同月内は不可）。再現実行には
 * Pro 以上のキーを推奨する。
 *
 * BENCHMARK_TARGET_KIND=fixture-seeded は「対象APIが合成コーパスを提供している」ことの
 * 明示で、未設定なら起動前に fail する（実データのみの本番APIでは再現不能なため）。
 * fixture の投入手順は build-dataset/README.md を参照。
 *
 * fixture SQL からオラクル（表示名→真の番号）を読み、生成器で摂動入力を作る。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  type CollisionMetadata,
  collisionFlagsFrom,
  loadCollisionMetadata,
} from "./collision-metadata-reader.js";
import {
  generateDataset,
  type GeneratedCase,
} from "../build-dataset/perturbation-gen.js";
import { DATASET_MANIFEST } from "../build-dataset/dataset-manifest.js";
import {
  buildWebArtifact,
  caseBreakdown,
  coveragePrecisionCurve,
  summarize,
} from "../report/aggregate.js";
import {
  type ApiBatchResultRow,
  mapApiResults,
  type OracleByRowIndex,
} from "./api-result-mapper.js";
import {
  type BatchInput,
  buildSubmitBody,
  chunkInputs,
  remapChunkResults,
} from "./batch-submit.js";
import {
  COMPOSITE_RATIO,
  hasPrefectureHint,
  NON_ABSORBABLE_RATIO,
  SEED,
} from "./benchmark-config.js";

const POLL_INTERVAL_MS = 2000;
// 既定 120 秒。1,000 行チャンクの処理時間やジョブ再試行は配備条件で変わるため
// env で上書き可能にする。ジョブが進捗を報告している間は打ち切らない（下記 pollResults）。
// 空・非数値・非正・タイマー範囲外の値は既定へ倒さず fail にする（黙って 0ms や NaN で
// 即中断すると原因が分からないため）。空文字列のみ未設定として既定を使う。
const POLL_TIMEOUT_MS = ((): number => {
  const raw = process.env.BENCHMARK_POLL_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return 120_000;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
    throw new Error(
      `BENCHMARK_POLL_TIMEOUT_MS must be a positive integer of milliseconds, got: ${raw}`,
    );
  }
  return parsed;
})();

type FixtureCorp = {
  corporateNumber: string;
  name: string;
  nameNormalized: string;
  nameNoKind: string;
  prefectureCode: string;
};

/**
 * SQL リテラルの '' エスケープを実値のシングルクォートへ復号する。
 */
function sqlUnescape(value: string): string {
  return value.replaceAll("''", "'");
}

/**
 * fixture SQL の VALUES 行から (番号, 表示名, 正規化キー, no-kind キー, 都道府県) を抽出する。
 * 都道府県コードは決定論の抽選（hasPrefectureHint）でヒント付与する行の照合ペイロードに使う。
 */
export function parseFixtureCorps(sql: string): FixtureCorp[] {
  const corps: FixtureCorp[] = [];
  // SQL リテラルの '' エスケープ（値中のシングルクォート）を1リテラルとして読み取る。
  // 単純な [^']+ だと O''Reilly のような名で行の読み取りが途切れて行が黙って欠落し、
  // 以降の行が衝突メタデータの index とずれて計測が壊れる。
  const lit = "'((?:[^']|'')*)'";
  const rowPattern = new RegExp(
    ["\\(\\s*", lit, "\\s*,\\s*", lit, "\\s*,\\s*", lit, "\\s*,\\s*", lit, "\\s*,\\s*", lit, "\\s*,"].join(""),
    "g",
  );
  let match: RegExpExecArray | null = rowPattern.exec(sql);
  while (match !== null) {
    corps.push({
      corporateNumber: sqlUnescape(match[1]!),
      name: sqlUnescape(match[2]!),
      nameNormalized: sqlUnescape(match[3]!),
      nameNoKind: sqlUnescape(match[4]!),
      prefectureCode: sqlUnescape(match[5]!),
    });
    match = rowPattern.exec(sql);
  }
  return corps;
}

/**
 * 照合キー空間で正解が一意に定まらない行を ambiguous として印付けるオラクルを組む。
 * ambiguous は 2 系統の非一意性を OR で取る:
 *   1. コーパス由来: name_normalized 重複、または name_no_kind が非空で重複する行。
 *   2. 生成入力由来: 摂動後の入力を buildMatchingKey で照合キー化した文字列が別行と衝突し
 *      真値が一意に定まらない行。
 * (1) は fixture の正規化列（サーバ側と同一の normalizer 由来）から数え、DB直結モードと同一
 * ルール。(2) は build-fixture が buildMatchingKey で事前計算しコミットした collision-metadata を
 * 読むことで、DB直結モード（実行時に buildMatchingKey を直接呼ぶ）と同一の衝突集合へ揃える
 * （旧実装の生入力 identity 近似が取りこぼしていた全半角・異体字・法人格略記の衝突を回収）。
 * メタデータを読むだけなので公開再現パスは normalizer を import しない（生成側 collision-metadata.ts
 * が buildMatchingKey を持つ＝build-fixture と同じサーバ側ビルド工程の成果物）。
 *
 * 都道府県ヒントは決定論の抽選（hasPrefectureHint・摂動 PRNG とは別系統）で一定比率の行に付け、
 * DB直結モードと同一の行へ付与する（両モードで同じ純関数を共有するため）。
 */
export function buildOracle(
  corps: readonly FixtureCorp[],
  generated: readonly GeneratedCase[],
  collisionMeta: CollisionMetadata,
): OracleByRowIndex {
  // 実効 ambiguous（コーパス同名衝突・生成入力の照合キー衝突・都道府県ヒントによる
  // 一意化まで含む）はコミット済みメタデータから復元する。判定はサーバ側ビルド工程が
  // buildMatchingKey 基準で事前計算しており、DB直結モードの markEffectiveAmbiguity と
  // 同一集合になる（公開再現パスは normalizer を import しない）。
  const effectiveAmbiguous = collisionFlagsFrom(collisionMeta, generated.length);
  const oracle: OracleByRowIndex = new Map();
  for (let i = 0; i < generated.length; i += 1) {
    const corp = corps[i]!;
    const gen = generated[i]!;
    // グローバル row_index は 1 始まり（投入順 index + 1）。チャンク分割時も
    // 各ジョブ結果を toGlobalRowIndex でグローバル index に戻してから突き合わせる。
    oracle.set(i + 1, {
      truth: corp.corporateNumber,
      ambiguous: effectiveAmbiguous[i]!,
      caseType: gen.caseType,
      absorbable: gen.absorbable,
      hintPrefecture: hasPrefectureHint(i),
    });
  }
  return oracle;
}

async function submitJob(
  baseUrl: string,
  apiKey: string,
  inputs: readonly BatchInput[],
): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/batch/match`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    // production parser が受け付けるフィールド名 `name` を使う（`inputName` は不可）。
    body: JSON.stringify(buildSubmitBody(inputs)),
    // 接続後に応答が返らない stall でも CLI が予測可能に終了するよう投入にも期限を課す。
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`submit failed: ${response.status}`);
  }
  const body = (await response.json()) as { job_id: string };
  return body.job_id;
}

async function pollResults(
  baseUrl: string,
  apiKey: string,
  jobId: string,
): Promise<ApiBatchResultRow[]> {
  // 期限は「進捗が止まってからの経過」で判定する。大きなチャンクやジョブ再試行では
  // 総所要が既定期限を超え得るため、進捗（processed 件数や status 変化）が観測できる
  // 間は期限を都度延長し、健全に進行中のジョブを打ち切らない。
  let deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastProgress = "";
  while (Date.now() < deadline) {
    // 応答が返らない stall でもループが期限判定へ戻れるよう、各リクエスト自体を
    // 残り期限で打ち切る（await が無期限に待つと宣言上のタイムアウトが機能しない）。
    const response = await fetch(`${baseUrl}/v1/batch/${jobId}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (!response.ok) {
      throw new Error(`poll failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      status: string;
      progress?: { done: number; total: number };
      results?: ApiBatchResultRow[];
    };
    if (body.status === "completed") {
      return body.results ?? [];
    }
    if (body.status === "failed") {
      throw new Error("batch job failed");
    }
    const progress = `${body.status}:${body.progress?.done ?? ""}`;
    if (progress !== lastProgress) {
      lastProgress = progress;
      deadline = Date.now() + POLL_TIMEOUT_MS;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    "batch job made no progress before timeout (set BENCHMARK_POLL_TIMEOUT_MS to extend)",
  );
}

/**
 * 全投入行にちょうど 1 件の結果が揃っていることを検証する（欠落・重複・未知 index は
 * いずれも fail）。部分データからの exit 0 レポートを防ぐ。
 */
export function assertCompleteResults(
  results: readonly ApiBatchResultRow[],
  inputCount: number,
): void {
  const seen = new Set<number>();
  for (const result of results) {
    if (
      !Number.isInteger(result.row_index) ||
      result.row_index < 1 ||
      result.row_index > inputCount
    ) {
      throw new Error(`unexpected row_index in results: ${result.row_index}`);
    }
    if (seen.has(result.row_index)) {
      throw new Error(`duplicate row_index in results: ${result.row_index}`);
    }
    seen.add(result.row_index);
  }
  if (seen.size !== inputCount) {
    throw new Error(
      `incomplete results: got ${seen.size} of ${inputCount} submitted rows`,
    );
  }
}

async function main(): Promise<void> {
  // 末尾スラッシュ付きの base URL（https://host/）だと //v1/... になり Hono が
  // マッチしないため、一度だけ正規化してから全リクエストで使う。
  const baseUrl = process.env.BENCHMARK_API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.BENCHMARK_API_KEY;
  const fixturePath = process.argv[2];
  if (!baseUrl || !apiKey) {
    throw new Error(
      "BENCHMARK_API_BASE_URL and BENCHMARK_API_KEY are required",
    );
  }
  if (!fixturePath) {
    throw new Error("fixture SQL path is required as the first argument");
  }

  const fixtureSqlText = readFileSync(fixturePath, "utf8");
  const corps = parseFixtureCorps(fixtureSqlText);
  // 空・不完全な fixture（別ファイルの誤指定等）から 0 行レポートを出さない。
  // 衝突メタデータの前提コーパスと同一件数であることも要求する（indexずれ防止）。
  if (corps.length === 0) {
    throw new Error(`fixture has no parsable rows: ${fixturePath}`);
  }
  // 衝突メタデータの ambiguousIndices は「コミット済みコーパスの行順」に対する位置
  // ラベルなので、件数が合っていても中身・並びが違う fixture に貼ると別法人へ
  // ラベルが付き計測が静かに壊れる。manifest の fixtureHash と同一アルゴリズムで
  // 供給 fixture のハッシュを取り、同一内容であることを検証する。
  // Windows の autocrlf チェックアウトで CRLF 化された公式 fixture を誤拒否しないよう、
  // ハッシュ前に改行を LF へ正規化する（manifest 側は LF 内容から算出）。
  const suppliedHash = createHash("sha256")
    .update(fixtureSqlText.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex")
    .slice(0, 16);
  if (suppliedHash !== DATASET_MANIFEST.fixtureHash) {
    throw new Error(
      `fixture hash mismatch: supplied ${suppliedHash} != manifest ${DATASET_MANIFEST.fixtureHash} (stale or edited fixture; regenerate with build-fixture)`,
    );
  }
  const generated = generateDataset(
    corps.map((c) => c.name),
    { seed: SEED, nonAbsorbableRatio: NON_ABSORBABLE_RATIO, compositeRatio: COMPOSITE_RATIO },
  );
  const collisionMeta = loadCollisionMetadata();
  if (corps.length !== collisionMeta.corpusSize) {
    throw new Error(
      `fixture rows (${corps.length}) do not match collision metadata corpusSize (${collisionMeta.corpusSize}); regenerate with build-fixture`,
    );
  }
  const oracle = buildOracle(corps, generated, collisionMeta);
  // 決定論の抽選でヒント付与する行はコーパスの都道府県コードを prefecture_code として投入する。
  const inputs: BatchInput[] = generated.map((gen, i) => ({
    name: gen.input,
    prefectureCode: hasPrefectureHint(i) ? corps[i]!.prefectureCode : undefined,
  }));

  // 合成コーパスは実データのみの本番APIに存在せず、実行しても全行 unmatched の
  // 無意味な計測になる。fixture を seed した検証インスタンスへ向けたことの明示
  // （BENCHMARK_TARGET_KIND=fixture-seeded）を必須にし、誤って本番へ流す事故と
  // 「Growthキーだけで本番再現できる」という誤解を実行時に遮断する。
  // 実データベースでの第三者再現は T1 実在ペアコーパスの後続トラックで解禁される。
  if (process.env.BENCHMARK_TARGET_KIND !== "fixture-seeded") {
    throw new Error(
      "set BENCHMARK_TARGET_KIND=fixture-seeded to confirm the target API serves the synthetic fixture corpus (a real-data-only API cannot reproduce this benchmark)",
    );
  }
  // 対象デプロイの normalizer 版は API から取得できないため、実行者に明示させて
  // manifest（fixture 焼き込み時の版）と突合する。版が違えば焼き込み列と照合挙動が
  // ずれ、計測が別条件になるため fail-closed にする。
  const targetNormalizerVersion = process.env.BENCHMARK_TARGET_NORMALIZER_VERSION;
  if (!targetNormalizerVersion) {
    throw new Error(
      "set BENCHMARK_TARGET_NORMALIZER_VERSION to the target deployment's normalizer version (must match the fixture's baked version)",
    );
  }
  if (targetNormalizerVersion !== DATASET_MANIFEST.normalizerVersionForFixture) {
    throw new Error(
      `target normalizer version ${targetNormalizerVersion} does not match fixture's baked version ${DATASET_MANIFEST.normalizerVersionForFixture}`,
    );
  }
  // 対象デプロイが BATCH_MATCH_SIMILARITY_THRESHOLD を上書きしていると候補集合ごと
  // 変わり DB直結モードと同一計測にならないため、実行者に実効閾値を明示させ
  // manifest の記録値との一致を要求する。
  const targetThreshold = process.env.BENCHMARK_TARGET_SIMILARITY_THRESHOLD;
  if (!targetThreshold) {
    throw new Error(
      "set BENCHMARK_TARGET_SIMILARITY_THRESHOLD to the target deployment's effective batch-match similarity threshold",
    );
  }
  if (Number(targetThreshold) !== DATASET_MANIFEST.matchSimilarityThreshold) {
    throw new Error(
      `target similarity threshold ${targetThreshold} does not match the recorded measurement condition ${DATASET_MANIFEST.matchSimilarityThreshold}`,
    );
  }

  // production parser は 1 ジョブ最大 1,000 行なので上限以下へ分割投入し、各ジョブ結果を
  // グローバル row_index に付け替えてから集約する（オラクルはグローバル index キー）。
  const chunks = chunkInputs(inputs);
  const allResults: ApiBatchResultRow[] = [];
  for (const chunk of chunks) {
    const jobId = await submitJob(baseUrl, apiKey, chunk.items);
    const chunkResults = await pollResults(baseUrl, apiKey, jobId);
    allResults.push(...remapChunkResults(chunk.offset, chunkResults));
  }
  // 欠落・重複・未知 row_index の結果をそのまま集計すると、部分データでも exit 0 の
  // もっともらしいレポートが出てしまう。全投入行にちょうど 1 件の結果が揃っている
  // ことを集計前に検証する（fail-closed）。
  assertCompleteResults(allResults, inputs.length);
  const rows = mapApiResults(allResults, oracle);

  const summary = summarize(rows);
  const curve = coveragePrecisionCurve(rows);
  const breakdown = caseBreakdown(rows);

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    seed: SEED,
    mode: "api",
    matchSimilarityThreshold: DATASET_MANIFEST.matchSimilarityThreshold,
    summary,
    curve,
    caseBreakdown: breakdown,
    // 実測ブロックへ貼り込める形（DB直結モードと同一・共有ビルダ + normalizer 版）。
    webArtifact: {
      ...buildWebArtifact(summary, curve, breakdown),
      normalizerVersion: targetNormalizerVersion,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

// 直接実行時のみ起動する（テストからの import で API 実行が走らないようにする）。
if (process.argv[1]?.endsWith("run-benchmark.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
