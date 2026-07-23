/**
 * 合成ゆらぎ生成器（シード固定・正規化辞書非依存）。
 *
 * 名寄せ精度の中核ノウハウである正規化辞書を公開せずに再現可能なベンチマークを
 * 提供するため、ゆらぎ付与はハンドコードのテーブルで行い @houjin/normalizer に
 * 依存しない。第三者はこのモジュールとシードだけで同一データセットを再構築できる。
 *
 * 摂動ファミリーは設計書 §1-1 の一覧（法人格略記・前後株入替・法人格脱落・全半角・
 * スペース・長音/ハイフン・かな⇄カナ・異体字・略語・中黒/記号・タイポ）と複合適用を
 * 網羅する。吸収系（正規化が照合キーで畳み込む）と非吸収系（かな変換・略語展開・誤字・
 * 部分名）に分け、非吸収を一定比率混ぜることで、改善が正規化の折り畳み以外にも意味を
 * 持つことを示す。吸収可否は @houjin/normalizer の実装挙動を確認して分類し、各 applyX の
 * コメントに根拠を残す（本モジュールは normalizer を import しない＝OSS 境界を維持）。
 */

export type CaseType =
  | "identity"
  | "variant"
  | "spacing"
  | "shorthand"
  | "kind_swap"
  | "kind_drop"
  | "width"
  | "long_sound"
  | "kana"
  | "abbrev"
  | "typo"
  | "partial"
  | "composite";

// 吸収系（正規化パイプラインが照合キーで畳み込む摂動）。分類根拠は各 applyX の
// コメント参照（NFKC・shorthand・空白/記号除去・長音統一・異体字統一・法人格除去）。
export const ABSORBABLE_CASES: readonly CaseType[] = [
  "identity",
  "variant",
  "spacing",
  "shorthand",
  "kind_swap",
  "kind_drop",
  "width",
  "long_sound",
];

// 非吸収系（正規化が畳み込まない摂動）。かな⇄カナ変換・略語展開は normalizer が持たず、
// 誤字・部分名は原理的に一致しない。改善が折り畳み以外にも意味を持つことを示す。
export const NON_ABSORBABLE_CASES: readonly CaseType[] = [
  "kana",
  "abbrev",
  "typo",
  "partial",
];

export type GeneratedCase = {
  input: string;
  caseType: CaseType;
  absorbable: boolean;
  /** composite のとき実際に発火したファミリー（2件以上・重複なし）。 */
  firedFamilies?: readonly Exclude<CaseType, "composite">[];
};

export type GenerateDatasetOptions = {
  seed: number;
  /** 非吸収摂動（かな変換・略語・誤字・部分名）を目標とする比率（0..1）。 */
  nonAbsorbableRatio: number;
  /**
   * 複合摂動（2 ファミリー以上を重ねる）を目標とする比率（0..1）。既定 0。
   * 複合の吸収可否は wantNonAbsorbable の抽選で決め、absorbable === !wantNonAbsorbable の
   * 不変条件を保つ（吸収意図なら吸収系のみ／非吸収意図なら非吸収系を必ず 1 つ含める）。
   */
  compositeRatio?: number;
};

/** シード固定 PRNG（mulberry32）。同一シードで同一列を返す。 */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

// canonical -> 変体字（表示名を変体字入力へ揺らす。正規化が吸収する想定）。
// 正規化辞書とは独立にハンドコードする（辞書の非公開性を維持）。
const CANONICAL_TO_VARIANT: Record<string, readonly string[]> = {
  高: ["髙"],
  崎: ["﨑"],
  浜: ["濱", "濵"],
  辺: ["邊", "邉"],
};

// 法人格略記の候補。㈱・全角括弧つき・半角括弧つきを混ぜる。いずれも normalizer が
// NFKC（㈱・（株）→(株)）→ shorthand マップで株式会社へ戻すため吸収系。
const SHORTHAND_VARIANTS: Record<string, readonly string[]> = {
  株式会社: ["㈱", "(株)", "（株）"],
  有限会社: ["㈲", "(有)", "（有）"],
  合同会社: ["(同)", "（同）"],
};

// ASCII 英数字 → 全角。normalizer の NFKC が半角へ戻すため吸収系。
function toFullWidth(char: string): string {
  const code = char.charCodeAt(0);
  // 0x21..0x7e（!..~）を全角域 0xff01..0xff5e へシフトする。
  if (code >= 0x21 && code <= 0x7e) {
    return String.fromCharCode(code + 0xfee0);
  }
  return char;
}

// 長音・ハイフン系記号の候補。normalizer が /[-−ｰ－]/ を長音ーへ統一するため吸収系
// （ー自体も含め相互に畳み込まれる）。
const LONG_SOUND_VARIANTS: readonly string[] = ["ー", "−", "-", "ｰ", "－"];

// かな⇄カナ変換（さんぷる⇄サンプル）。NFKC はひらがな・カタカナを相互変換しないため
// 非吸収系。ひらがなブロック 0x3041..0x3096 とカタカナ 0x30a1..0x30f6 を相互シフトする。
function swapKana(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0x3041 && code <= 0x3096) {
    return String.fromCharCode(code + 0x60);
  }
  if (code >= 0x30a1 && code <= 0x30f6) {
    return String.fromCharCode(code - 0x60);
  }
  return char;
}

// 略語展開/短縮。normalizer は HD⇄ホールディングス等の辞書を持たないため非吸収系。
const ABBREV_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ホールディングス", "HD"],
  ["ホールディングス", "ＨＤ"],
];

function applyVariant(name: string, rng: () => number): string | null {
  const canonicals = Object.keys(CANONICAL_TO_VARIANT).filter((c) =>
    name.includes(c),
  );
  if (canonicals.length === 0) {
    return null;
  }
  const target = pick(rng, canonicals);
  const variant = pick(rng, CANONICAL_TO_VARIANT[target] as readonly string[]);
  return name.replace(target, variant);
}

function applySpacing(name: string, rng: () => number): string {
  const sep = pick(rng, ["　", " ", "・"]);
  // サロゲートペア（𠮷 等）を分断しないよう code point 単位で挿入位置を選ぶ。
  const chars = Array.from(name);
  const pos = 1 + Math.floor(rng() * Math.max(1, chars.length - 1));
  return [...chars.slice(0, pos), sep, ...chars.slice(pos)].join("");
}

function applyShorthand(name: string, rng: () => number): string | null {
  const fulls = Object.keys(SHORTHAND_VARIANTS).filter((f) => name.includes(f));
  if (fulls.length === 0) {
    return null;
  }
  const full = pick(rng, fulls);
  const short = pick(rng, SHORTHAND_VARIANTS[full] as readonly string[]);
  return name.replace(full, short);
}

// 吸収: 法人格の脱落。前株/後株いずれの法人格も落とす。normalizer の no-kind 照合キーが
// 法人格を除去するため、脱落しても no-kind キーで一致する（吸収系）。
// 生成器が法人格として認識する語彙。normalizer は複合法人格（農業協同組合等）も
// 除去するため、ここが狭いと partial/kind_drop の「コア名」判定が正規化実装と
// ずれて吸収可否の偶然一致を生む。ハンドコード表で辞書 import はしない。
const KIND_TOKENS: readonly string[] = [
  "株式会社",
  "有限会社",
  "合同会社",
  "農業協同組合",
  "特定目的会社",
  "信用金庫",
];

function applyKindDrop(name: string): string | null {
  for (const kind of KIND_TOKENS) {
    if (name.startsWith(kind)) {
      return name.slice(kind.length);
    }
    if (name.endsWith(kind)) {
      return name.slice(0, name.length - kind.length);
    }
  }
  return null;
}

// 吸収: ASCII 英数字を全角へ揺らす。normalizer の NFKC が半角へ戻すため吸収系。
function applyWidth(name: string): string | null {
  let changed = false;
  const out = Array.from(name, (char) => {
    const wide = toFullWidth(char);
    if (wide !== char) {
      changed = true;
    }
    return wide;
  }).join("");
  return changed ? out : null;
}

// 吸収: 既存の長音・ハイフン記号を別の同義記号へ差し替える。normalizer が長音ーへ
// 統一するため吸収系。
function applyLongSound(name: string, rng: () => number): string | null {
  const positions: number[] = [];
  for (let i = 0; i < name.length; i += 1) {
    if (LONG_SOUND_VARIANTS.includes(name[i] as string)) {
      positions.push(i);
    }
  }
  if (positions.length === 0) {
    return null;
  }
  const pos = pick(rng, positions);
  const current = name[pos] as string;
  const alternatives = LONG_SOUND_VARIANTS.filter((v) => v !== current);
  const replacement = pick(rng, alternatives);
  return name.slice(0, pos) + replacement + name.slice(pos + 1);
}

// 非吸収: カナ→かな変換。normalizer はかな変換辞書を持たないため非吸収系。
// 片方向に限定する: 双方向だと複合適用で 2 回発火した際に往復して元へ戻り、
// 「発火したのに実質 no-op」という吸収可否の誤分類を生むため。
function applyKana(name: string): string | null {
  let changed = false;
  const out = Array.from(name, (char) => {
    const swapped = swapKana(char);
    if (swapped !== char && /[\u30a1-\u30f6]/.test(char)) {
      changed = true;
      return swapped;
    }
    return char;
  }).join("");
  return changed ? out : null;
}

// 非吸収: 略語展開/短縮（ホールディングス⇄HD）。normalizer が対応辞書を持たないため
// 非吸収系。
function applyAbbrev(name: string, rng: () => number): string | null {
  const applicable = ABBREV_PAIRS.filter(([full]) => name.includes(full));
  if (applicable.length === 0) {
    return null;
  }
  const [full, short] = pick(rng, applicable);
  return name.replace(full, short);
}

// 前株/後株の入替（法人格を反対側へ移動）。
function applyKindSwap(name: string): string | null {
  const kind = "株式会社";
  if (name.startsWith(kind)) {
    return `${name.slice(kind.length)}${kind}`;
  }
  if (name.endsWith(kind)) {
    return `${kind}${name.slice(0, name.length - kind.length)}`;
  }
  return null;
}

// 非吸収: 軽微な誤字（1文字置換・脱落・隣接転置）。設計の誤字クラスは転置を含むため
// 3 種を等確率で出す。サロゲートペアを分断しないよう code point 単位で操作する。
function applyTypo(name: string, rng: () => number): string | null {
  const chars = Array.from(name);
  if (chars.length < 3) {
    return null;
  }
  const mode = Math.floor(rng() * 3);
  if (mode === 0) {
    const pos = Math.floor(rng() * chars.length);
    return [...chars.slice(0, pos), ...chars.slice(pos + 1)].join("");
  }
  if (mode === 1) {
    const pos = Math.floor(rng() * chars.length);
    const replacement = pick(rng, ["ノ", "工", "口", "力", "夕"]);
    return [...chars.slice(0, pos), replacement, ...chars.slice(pos + 1)].join("");
  }
  // 隣接転置。同一文字どうしの入替は no-op になるため、その場合は脱落へ倒す。
  const pos = Math.floor(rng() * (chars.length - 1));
  if (chars[pos] === chars[pos + 1]) {
    return [...chars.slice(0, pos), ...chars.slice(pos + 1)].join("");
  }
  const swapped = [...chars];
  [swapped[pos], swapped[pos + 1]] = [swapped[pos + 1]!, swapped[pos]!];
  return swapped.join("");
}

// 非吸収: 部分名。法人格を除いたコア名の一部だけを切り出す。法人格ごと切ると
// no-kind 照合キーでは丸ごと吸収され kind_drop と区別がつかなくなるため、
// 必ずコア名自体を欠けさせて非吸収（キー不一致）を保証する。
function applyPartial(name: string, rng: () => number): string | null {
  const core = Array.from(applyKindDrop(name) ?? name);
  if (core.length < 4) {
    return null;
  }
  const keep = Math.max(
    2,
    Math.min(core.length - 1, Math.floor(core.length * (0.5 + rng() * 0.3))),
  );
  return (rng() < 0.5 ? core.slice(0, keep) : core.slice(core.length - keep)).join("");
}

// 単独ファミリーの適用（composite はここでは扱わず applyComposite で合成する）。
function applySingle(
  caseType: Exclude<CaseType, "composite">,
  name: string,
  rng: () => number,
): string | null {
  switch (caseType) {
    case "identity":
      return name;
    case "variant":
      return applyVariant(name, rng);
    case "spacing":
      return applySpacing(name, rng);
    case "shorthand":
      return applyShorthand(name, rng);
    case "kind_swap":
      return applyKindSwap(name);
    case "kind_drop":
      return applyKindDrop(name);
    case "width":
      return applyWidth(name);
    case "long_sound":
      return applyLongSound(name, rng);
    case "kana":
      return applyKana(name);
    case "abbrev":
      return applyAbbrev(name, rng);
    case "typo":
      return applyTypo(name, rng);
    case "partial":
      return applyPartial(name, rng);
  }
}

// 複合適用: 2 件以上のファミリーを順に重ねる。実際に発火したファミリー（適用して文字列が
// 変化したもの）だけを fired に記録する。吸収可否は「発火した成分に非吸収系が含まれないか」
// で決める（単独パスの identity フォールバックと同じ意味論: 非吸収が 1 つも発火しなければ
// 吸収扱い）。選択したファミリーに非吸収系があっても、対象文字を欠いて no-op すれば吸収の
// ままになる点が重要。一切発火しなければ input=null を返す。
// 複合適用の順序。後段の摂動が前段の発火痕跡を消すと「発火したのに実質 no-op」の
// 誤分類を生むため、(1) partial を最初に適用して以後の文字摂動が残る領域を確定し、
// (2) 法人格トークン系（略記・入替・脱落）を最後に適用して「（株 ）」「（・有）」の
// ようにトークン内部へ文字が入り normalizer の略記展開が破れるのを防ぐ。
const COMPOSITE_ORDER: Partial<Record<CaseType, number>> = {
  partial: 0,
  shorthand: 2,
  kind_swap: 2,
  kind_drop: 2,
};

function applyComposite(
  families: readonly Exclude<CaseType, "composite">[],
  name: string,
  rng: () => number,
): { input: string; fired: Exclude<CaseType, "composite">[] } | null {
  let current = name;
  const fired: Exclude<CaseType, "composite">[] = [];
  // 適用途中の文字列をすべて記録し、後段の摂動が過去の状態へ戻した（打ち消した）
  // 複合を不成立として棄却する。fired は append-only のため、打ち消し複合を通すと
  // 実質単一摂動の行が複合として誤計上される。
  const seen = new Set<string>([name]);
  // 同一ファミリーの重複適用を禁止する。転置（typo）のような対合的摂動は 2 回目の
  // 適用で元へ戻り得て、「発火したのに実質 no-op」という吸収可否の誤分類を生むため。
  const distinct = [...new Set(families)];
  // kind_swap → kind_drop は入替の痕跡が脱落で消え、kind_drop 単独と同値の入力を
  // 「複合」として計上してしまうため相互排他にする（脱落を優先して残す）。
  const exclusive = distinct.includes("kind_drop")
    ? distinct.filter((f) => f !== "kind_swap")
    : distinct;
  const ordered = exclusive.sort(
    (a, b) => (COMPOSITE_ORDER[a] ?? 1) - (COMPOSITE_ORDER[b] ?? 1),
  );
  for (const family of ordered) {
    const next = applySingle(family, current, rng);
    if (next !== null && next.trim() !== "" && next !== current) {
      if (seen.has(next)) {
        // 過去の状態へ戻る適用は打ち消し。複合として不成立（再抽選へ）。
        return null;
      }
      seen.add(next);
      current = next;
      fired.push(family);
    }
  }
  return fired.length > 0 ? { input: current, fired } : null;
}

// 複合摂動で重ねるファミリー数（2〜3）。組合せが過大にならないよう小さく保つ。
function pickCompositeFamilies(
  wantNonAbsorbable: boolean,
  rng: () => number,
): Exclude<CaseType, "composite">[] {
  // 吸収系プールから重ねるファミリー（identity は情報を持たないため除外）。
  const absorbablePool = ABSORBABLE_CASES.filter(
    (c) => c !== "identity",
  ) as Exclude<CaseType, "composite">[];
  const count = 2 + Math.floor(rng() * 2);
  if (!wantNonAbsorbable) {
    // 吸収意図: 吸収系のみを重ねる（全成分が吸収 ⇒ 複合も吸収）。
    return Array.from({ length: count }, () => pick(rng, absorbablePool));
  }
  // 非吸収意図: 非吸収系を必ず 1 つ含める（AND で複合も非吸収）。残りは全プールから。
  const nonAbsorbable = pick(
    rng,
    NON_ABSORBABLE_CASES as readonly Exclude<CaseType, "composite">[],
  );
  const rest = Array.from({ length: count - 1 }, () =>
    pick(rng, [...absorbablePool, ...NON_ABSORBABLE_CASES] as Exclude<
      CaseType,
      "composite"
    >[]),
  );
  return [nonAbsorbable, ...rest];
}

/**
 * 1 件の表示名から摂動入力を 1 件生成する。
 *
 * 吸収可否は wantNonAbsorbable の抽選で決まり、absorbable === !wantNonAbsorbable を常に
 * 満たす（複合ケースも成分の吸収可否 AND がこの不変条件に一致するよう選ぶ）。摂動が
 * 適用不能な名称（対象文字を含まない等）は identity にフォールバックし、ケース分布の
 * ログはそのまま残す（吸収扱い）。
 */
// 複合の再抽選上限。決定論を保ちつつ、非互換ペア（partial が法人格を先に除去して
// kind_drop が no-op 化する等）や打ち消しで発火数が 1 に落ちた選択を捨て直す。
const COMPOSITE_RETRY_LIMIT = 5;

/**
 * 単独ファミリーの層化適用。抽選したファミリーが対象文字を欠いて no-op した場合、
 * identity へ落とさずプール内の残りファミリーを決定論の順で試す。宣言済みファミリーの
 * 実測行が入力材料の偏りで丸ごと消える（=公開内訳から黙って消える）のを防ぐ。
 */
function applyStratified(
  pool: readonly CaseType[],
  name: string,
  rng: () => number,
): { input: string; caseType: Exclude<CaseType, "composite"> } | null {
  const start = Math.floor(rng() * pool.length);
  for (let i = 0; i < pool.length; i += 1) {
    const caseType = pool[(start + i) % pool.length] as Exclude<
      CaseType,
      "composite"
    >;
    const input = applySingle(caseType, name, rng);
    if (input !== null && input.trim() !== "" && input !== name) {
      return { input, caseType };
    }
  }
  return null;
}

export function generateCase(
  name: string,
  rng: () => number,
  nonAbsorbableRatio: number,
  compositeRatio = 0,
): GeneratedCase {
  const wantNonAbsorbable = rng() < nonAbsorbableRatio;
  const wantComposite = rng() < compositeRatio;

  if (wantComposite) {
    // 複合は「2 ファミリー以上が実際に発火」した場合のみ採用する（定義どおりの複合）。
    // 発火 1 件以下の選択は上限つきで再抽選し、成立しなければ単独パスへ落とす。
    for (let attempt = 0; attempt < COMPOSITE_RETRY_LIMIT; attempt += 1) {
      const families = pickCompositeFamilies(wantNonAbsorbable, rng);
      const composed = applyComposite(families, name, rng);
      if (composed === null || composed.input === name) {
        continue;
      }
      const distinctFired = [...new Set(composed.fired)];
      if (distinctFired.length < 2) {
        continue;
      }
      // 吸収可否は「実際に発火した成分」で判定する。選んだ非吸収系が対象文字を欠いて
      // no-op した場合、非吸収は発火しておらず吸収扱いとする（正規化が畳み込むため）。
      const firedNonAbsorbable = distinctFired.some((f) =>
        (NON_ABSORBABLE_CASES as readonly CaseType[]).includes(f),
      );
      return {
        input: composed.input,
        caseType: "composite",
        absorbable: !firedNonAbsorbable,
        firedFamilies: distinctFired,
      };
    }
    // 複合が成立しなければ単独パスへフォールバックする（下の層化適用に合流）。
  }

  const pool = wantNonAbsorbable ? NON_ABSORBABLE_CASES : ABSORBABLE_CASES;
  const applied = applyStratified(pool, name, rng);
  if (applied === null) {
    return { input: name, caseType: "identity", absorbable: true };
  }
  return {
    input: applied.input,
    caseType: applied.caseType,
    absorbable: !wantNonAbsorbable,
  };
}

/**
 * 表示名の列からシード固定で摂動入力列を生成する。
 * 同一シード・同一入力なら完全に同じ列を返す（再現性）。
 */
export function generateDataset(
  names: readonly string[],
  options: GenerateDatasetOptions,
): GeneratedCase[] {
  const rng = createPrng(options.seed);
  const compositeRatio = options.compositeRatio ?? 0;
  return names.map((name) =>
    generateCase(name, rng, options.nonAbsorbableRatio, compositeRatio),
  );
}
