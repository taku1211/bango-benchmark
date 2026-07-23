/**
 * 生成入力の衝突検出（DB 非依存・純関数・normalizer 非 import）。
 *
 * 摂動を加えた入力は行ごとに異なる真値（法人番号）を持つが、摂動の結果として
 * 照合キー化した文字列が別行と一致すると、その入力からは真値が一意に定まらない。
 * この非一意な行は精度計算の対象外（ambiguous）とする。判定は「生成入力を照合キー化
 * した文字列」の重複で行い、キー化関数 keyFn を注入することで DB直結モード
 * （buildMatchingKey）と API モード（正規化列を持たないため生入力の同値）へ同一ルールを
 * 適用する。normalizer は import せず、モード差はキー化関数の差として吸収する。
 */

export type InputCollisionItem = {
  /** 生成入力（正規化前の生入力）。 */
  input: string;
  /** この入力の真の法人番号。 */
  truth: string;
};

/**
 * 生成入力を keyFn で照合キー化し、同一キーが 2 つ以上の異なる真値に対応する行を
 * ambiguous として印付ける。返り値は items と同じ index 並びの boolean 配列。
 *
 * 空キー（法人格語のみ等で照合キーが空になる入力）はグルーピングから除外する
 * （run-benchmark-core が空キー入力をスキップするのと整合させ、空キー行が 1 つの
 * 巨大な ambiguous バケットに畳み込まれるのを防ぐ）。キーが同一でも真値が同一なら
 * 非一意ではない（同一法人の別表記）ため ambiguous としない。
 */
export function markInputCollisions(
  items: readonly InputCollisionItem[],
  keyFn: (input: string) => string,
): boolean[] {
  const truthsByKey = new Map<string, Set<string>>();
  const keys = items.map((item) => keyFn(item.input));
  for (let i = 0; i < items.length; i += 1) {
    const key = keys[i]!;
    if (key === "") {
      continue;
    }
    const truths = truthsByKey.get(key) ?? new Set<string>();
    truths.add(items[i]!.truth);
    truthsByKey.set(key, truths);
  }
  return items.map((_, i) => {
    const key = keys[i]!;
    if (key === "") {
      return false;
    }
    return (truthsByKey.get(key)?.size ?? 0) > 1;
  });
}

export type EffectiveAmbiguityRow = {
  /** この行の真の法人番号。 */
  truth: string;
  /** コーパス行の都道府県コード（ヒントの照合範囲）。null は不明。 */
  prefecture: string | null;
  /** この行の検索にヒントが付くか（付くと候補範囲が同一都道府県に絞られる）。 */
  hint: boolean;
  /** コーパス表示名の正規化キー（with-kind）。 */
  corpusNormalizedKey: string;
  /** コーパス表示名の no-kind キー（"" は無し）。 */
  corpusNoKindKey: string;
  /** 生成入力の照合キー（with-kind。"" は空キー入力）。 */
  inputKey: string;
  /** 生成入力の no-kind 照合キー（"" は空）。 */
  inputNoKindKey: string;
};

/**
 * ヒント適用後の実効 ambiguous 判定（DB 非依存・純関数・normalizer 非 import）。
 *
 * ambiguity は「その行の**提出された入力**（+ヒント）から真値が一意に定まらないこと」。
 * コーパス側の no-kind キー重複だけで判定すると、法人格違いの同名（株式会社さくら／
 * 有限会社さくら）は入力が法人格を保持していて一意化できる場合（(株)さくら 等）まで
 * ambiguous 扱いになり、法人格情報を正しく使う照合を精度失敗として誤計上してしまう。
 * 判定は入力起点で行う:
 *   0. 自行の完全正規化名（with-kind）がコーパス内で重複していれば、どんな入力でも
 *      両者を区別できないため ambiguous。
 *   1. 入力の with-kind キーがコーパスの正規化キーとちょうど 1 行一致するなら一意（非 ambiguous）。
 *   2. そうでなければ、入力の no-kind キーに一致するコーパス行が 2 行以上あれば ambiguous。
 *   3. 加えて、別の真値を持つ他行と生成入力の照合キーが衝突していれば ambiguous。
 * いずれの照合相手も、ヒント行では同一都道府県の行に限定する（ヒントが候補範囲を絞るため）。
 */
export function markEffectiveAmbiguity(
  rows: readonly EffectiveAmbiguityRow[],
): boolean[] {
  const corpusByNormalized = new Map<string, number[]>();
  const corpusByNoKind = new Map<string, number[]>();
  const byInput = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, i: number) => {
    if (key === "") {
      return;
    }
    const list = map.get(key) ?? [];
    list.push(i);
    map.set(key, list);
  };
  rows.forEach((row, i) => {
    push(corpusByNormalized, row.corpusNormalizedKey, i);
    push(corpusByNoKind, row.corpusNoKindKey, i);
    push(byInput, row.inputKey, i);
  });
  const inScope = (i: number, j: number): boolean => {
    if (!rows[i]!.hint) {
      return true;
    }
    // ヒント行の候補範囲は同一都道府県のみ。都道府県不明の相手は保守的に範囲内とする。
    const pi = rows[i]!.prefecture;
    const pj = rows[j]!.prefecture;
    return pi === null || pj === null || pi === pj;
  };
  return rows.map((row, i) => {
    // 0. 完全正規化名の重複は入力に依らず区別不能。
    if (row.corpusNormalizedKey !== "") {
      for (const j of corpusByNormalized.get(row.corpusNormalizedKey) ?? []) {
        if (j !== i && inScope(i, j)) {
          return true;
        }
      }
    }
    // 3. 生成入力どうしの衝突（別真値と同一入力キー）は入力から真値を選べない。
    if (row.inputKey !== "") {
      for (const j of byInput.get(row.inputKey) ?? []) {
        if (j !== i && rows[j]!.truth !== row.truth && inScope(i, j)) {
          return true;
        }
      }
    }
    // 1. 入力の with-kind キーがコーパス正規化キーとちょうど 1 行（=自行）一致するなら、
    //    法人格まで含めて一意に特定できる入力であり ambiguous ではない。
    if (row.inputKey !== "") {
      const fullMatches = (corpusByNormalized.get(row.inputKey) ?? []).filter(
        (j) => j === i || inScope(i, j),
      );
      if (fullMatches.length === 1 && fullMatches[0] === i) {
        return false;
      }
    }
    // 2. no-kind 空間で入力キーに一致するコーパス行が複数あれば、入力からは
    //    真値を選べない（法人格情報が入力に残っていない）。
    if (row.inputNoKindKey !== "") {
      let matches = 0;
      for (const j of corpusByNoKind.get(row.inputNoKindKey) ?? []) {
        if (j === i || inScope(i, j)) {
          matches += 1;
          if (matches > 1) {
            return true;
          }
        }
      }
    }
    return false;
  });
}
