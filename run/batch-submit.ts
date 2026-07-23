/**
 * API経由モードのバッチ投入ヘルパ（DB 非依存・純関数）。
 *
 * production の batch parser（apps/api request-parser）は 1 ジョブあたり最大 1,000 行の
 * companies を受け付け、各行は `{ name, prefecture_code? }`（または `{ company_name }` /
 * 素の文字列）で名前と都道府県ヒントを渡す。`inputName` はキーとして受け付けられない。
 * この境界を純関数に閉じ込め、投入 payload 形状とチャンク分割・グローバル row_index の
 * 対応をユニットテストで固定する。
 */

/** production request-parser の MAX_BATCH_ROWS と同値（apps/api request-parser を参照）。 */
export const MAX_BATCH_ROWS = 1000;

/** 投入 1 行分（名前と任意の都道府県ヒント）。 */
export type BatchInput = {
  name: string;
  /** 都道府県ヒント（2 桁）。undefined ならヒントなしで投入する。 */
  prefectureCode?: string;
};

export type BatchChunk = {
  /** グローバル row_index を復元するためのオフセット（先頭チャンクは 0）。 */
  offset: number;
  /** このチャンクに含める入力（最大 MAX_BATCH_ROWS 件）。 */
  items: BatchInput[];
};

/**
 * 投入する companies payload を組む。parser が受け付けるフィールド名 `name` /
 * `prefecture_code` を使う（`inputName` は受け付けられない）。ヒントなしの行は
 * prefecture_code キー自体を省く（parser は未指定を許容する）。
 */
export function buildSubmitBody(inputs: readonly BatchInput[]): {
  companies: Array<{ name: string; prefecture_code?: string }>;
} {
  return {
    companies: inputs.map((input) =>
      input.prefectureCode === undefined
        ? { name: input.name }
        : { name: input.name, prefecture_code: input.prefectureCode },
    ),
  };
}

/**
 * 入力列を 1 ジョブ上限（MAX_BATCH_ROWS）以下のチャンクへ分割する。
 * 各チャンクは元列でのオフセットを保持し、後段でグローバル row_index を復元できる。
 */
export function chunkInputs(
  inputs: readonly BatchInput[],
  size = MAX_BATCH_ROWS,
): BatchChunk[] {
  if (size < 1) {
    throw new Error("chunk size must be >= 1");
  }
  const chunks: BatchChunk[] = [];
  for (let offset = 0; offset < inputs.length; offset += size) {
    chunks.push({ offset, items: inputs.slice(offset, offset + size) });
  }
  return chunks;
}

/**
 * ジョブ内 1 始まり row_index をグローバル 1 始まり row_index へ変換する。
 * グローバル index = チャンクオフセット + ジョブ内 row_index。
 * （各ジョブの row_index は 1 から振り直されるため、オフセットで束ねる。）
 */
export function toGlobalRowIndex(offset: number, jobRowIndex: number): number {
  return offset + jobRowIndex;
}

/**
 * 1 チャンク分のジョブ結果（ジョブ内 1 始まり row_index）を、オラクル突合用の
 * グローバル row_index へ付け替える純関数。集約結果を後段でそのまま mapApiResults に
 * 渡せるようにする。
 */
export function remapChunkResults<T extends { row_index: number }>(
  offset: number,
  results: readonly T[],
): T[] {
  return results.map((result) => ({
    ...result,
    row_index: toGlobalRowIndex(offset, result.row_index),
  }));
}
