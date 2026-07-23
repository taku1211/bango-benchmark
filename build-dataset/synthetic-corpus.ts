/**
 * 合成コーパスの表示名定義（捏造名・捏造13桁番号）。
 *
 * NTA 実データを永続化せずオラクルを厳密にするため、名寄せの難所（異体字・空白・
 * 法人格・前後株・同名多数）を意図的に含む捏造データを持つ。number は 13 桁の
 * 連番ベースの捏造値（実在番号と衝突しない範囲）。
 *
 * 規模: 代表 23 ケース（異体字・略記・同名多数「さくら」等）を核に、法人格 × 業種 ×
 * 地名の決定論的な組合せで約 2,000 行へ拡張する。シード固定 PRNG（生成器と同型の
 * mulberry32）を使い、同一シードで完全に同じ列を再生成する（第三者再現の核）。名前・
 * 13 桁番号とも捏造で、実在衝突を避けるパターン（先頭固定 9・連番）を用いる。ambiguous
 * ケース（no-kind キー衝突）は代表 23 の「さくら」に加え、生成分にも一定比率で混ぜる。
 *
 * name_normalized / name_no_kind は build-fixture が @houjin/normalizer で導出して
 * SQL に焼き込むため、ここでは表示名のみを定義する（手書きの正規化ずれを避ける。
 * 焼き込み列は build-fixture 側の責務で、本モジュールは normalizer を import しない）。
 */

export type SyntheticCorp = {
  corporateNumber: string;
  name: string;
  prefectureCode: string;
};

// 13 桁の捏造番号を連番で振る（先頭は検査用数字を模した固定 9）。
function num(seq: number): string {
  return `9${String(seq).padStart(12, "0")}`;
}

/** シード固定 PRNG（mulberry32）。生成器 perturbation-gen と同アルゴリズムで決定論的。 */
function createPrng(seed: number): () => number {
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

// 代表 23 ケース: 異体字（高/髙・崎/﨑・浜/濱・辺/邊）・略記対象・前後株・同名多数を含む。
// build-fixture が正規化列を焼き込むため、ここは表示名と都道府県コードのみ。
const REPRESENTATIVE: ReadonlyArray<readonly [string, string]> = [
  ["株式会社高崎製作所", "10"],
  ["有限会社浜辺商店", "01"],
  ["合同会社山田工業", "13"],
  ["田中株式会社", "27"],
  // 実在企業と紛らわしい名称は使わない（実名+捏造番号の組を返すと非衝突の主張に反する）。
  ["蝦夷灘電計株式会社", "01"],
  ["株式会社辺境フーズ", "40"],
  ["崎山運輸株式会社", "14"],
  ["株式会社濱口水産", "12"],
  ["邊見建設株式会社", "11"],
  ["株式会社高橋商会", "13"],
  ["有限会社佐藤製菓", "23"],
  ["株式会社鈴木ホールディングス", "13"],
  ["合同会社サンライズ物流", "27"],
  ["株式会社みどり緑化", "26"],
  ["株式会社スマートワークス", "13"],
  ["日本橋興業株式会社", "13"],
  ["株式会社青空リゾート", "47"],
  ["有限会社大和精機", "29"],
  ["株式会社北斗システムズ", "01"],
  ["中央電子工業株式会社", "13"],
  // 同名多数（ambiguous 検証用）: 表示名は異なるが no-kind キーが衝突する組。
  ["株式会社さくら", "13"],
  ["有限会社さくら", "27"],
  ["さくら株式会社", "40"],
];

// 生成コーパスの目標総数（代表 23 を含む）。CI 実行時間と代表性のトレードオフで約 2,000。
export const TARGET_CORPUS_SIZE = 2000;

// 生成の決定論性を固定するシード（生成器 SEED とは別系統・コーパス生成専用）。
const CORPUS_SEED = 26_020_704;

// no-kind キー衝突（ambiguous）を意図的に作る生成分の比率。代表 23 の「さくら」に加え、
// 生成分でも同一コア名を別法人格で複数回出して ambiguous を一定量含める。
const AMBIGUOUS_RATIO = 0.08;

// 前株法人格（コア名の前に付く）。build-fixture の正規化がこれらを畳み込む前提。
const KIND_PREFIX: readonly string[] = ["株式会社", "有限会社", "合同会社"];
// 後株法人格（コア名の後に付く）。前後株の揺れを網羅するため両系統を持つ。
const KIND_SUFFIX: readonly string[] = ["株式会社", "工業株式会社"];

// コア名の構成要素（捏造）。異体字を含む姓・地名・業種語の組合せで実在衝突を避ける。
const SURNAMES: readonly string[] = [
  "高崎",
  "浜田",
  "辺見",
  "崎田",
  "濱中",
  "邊川",
  "青木",
  "緑川",
  "白石",
  "黒岩",
  "紅林",
  "藤原",
  "桐生",
  "楠木",
  "榊原",
];
const PLACES: readonly string[] = [
  "北都",
  "南洋",
  "東雲",
  "西陣",
  "中央",
  "内陸",
  "臨海",
  "高原",
  "湖畔",
  "峡谷",
];
const INDUSTRIES: readonly string[] = [
  "製作所",
  "運輸",
  "水産",
  "建設",
  "商会",
  "製菓",
  "物流",
  "緑化",
  "興業",
  "精機",
  "電子",
  "食品",
  "農産",
  "資材",
  "設備",
];

// コア名を一意化する連番トークン（漢数字風の捏造サフィックス）。組合せ空間が小さいと
// 意図せぬ no-kind 衝突で ambiguous が過半を占めてしまうため、生成分は index 由来の
// トークンでコアを一意化し、衝突は AMBIGUOUS_RATIO の意図的な再利用だけに限定する。
const UNIQ_TOKENS: readonly string[] = [
  "甲",
  "乙",
  "丙",
  "丁",
  "戊",
  "己",
  "庚",
  "辛",
  "壬",
  "癸",
];

// かな変換・長音・略語・全半角ファミリーの発火材料。カタカナ語（長音含む）・
// ホールディングス・ASCII英数を含む名を一定比率で混ぜ、宣言済みの全摂動ファミリーが
// 実測行を持てるようにする（材料が無いファミリーは no-op して計測から消えるため）。
const KATAKANA_TOKENS: readonly string[] = [
  "サンライズ",
  "システムズ",
  "フーズ",
  "テクノロジーズ",
  "ソリューションズ",
  "エンジニアリング",
  "ロジスティクス",
  "ホールディングス",
];

const ASCII_TOKENS: readonly string[] = [
  "ABC",
  "NEO",
  "DX21",
  "K2",
  "AXIS",
];

/** index からトークン列（重複しない捏造サフィックス）を組む。 */
function uniqToken(index: number): string {
  let n = index;
  let token = "";
  do {
    token = `${UNIQ_TOKENS[n % UNIQ_TOKENS.length]}${token}`;
    n = Math.floor(n / UNIQ_TOKENS.length);
  } while (n > 0);
  return token;
}

/**
 * 一意なコア名（法人格を除いた表示名の核）を組む。index 由来のトークンでコアを
 * 一意化するため、生成分どうしは no-kind キーが衝突しない（衝突は意図的な再利用のみ）。
 */
function buildCore(rng: () => number, index: number): string {
  const suffix = uniqToken(index);
  const shape = rng();
  if (shape < 0.25) {
    return `${pick(rng, SURNAMES)}${pick(rng, INDUSTRIES)}${suffix}`;
  }
  if (shape < 0.5) {
    return `${pick(rng, PLACES)}${pick(rng, INDUSTRIES)}${suffix}`;
  }
  if (shape < 0.68) {
    return `${pick(rng, SURNAMES)}${pick(rng, PLACES)}${pick(rng, INDUSTRIES)}${suffix}`;
  }
  if (shape < 0.88) {
    // カタカナ語（長音・ホールディングス材料）を含むコア。
    return `${pick(rng, SURNAMES)}${pick(rng, KATAKANA_TOKENS)}${suffix}`;
  }
  // ASCII 英数（全半角ゆらぎ材料）を含むコア。
  return `${pick(rng, PLACES)}${pick(rng, ASCII_TOKENS)}${suffix}`;
}

/** コア名へ前株/後株の法人格を付けて表示名にする。 */
function attachKind(core: string, rng: () => number): string {
  if (rng() < 0.6) {
    return `${pick(rng, KIND_PREFIX)}${core}`;
  }
  return `${core}${pick(rng, KIND_SUFFIX)}`;
}

/**
 * 意図的 ambiguous 用: first と同一の no-kind キーを持つ別表示名を組む（前株↔後株を反転）。
 *
 * no-kind キーは「法人格のみ」を除去するため、複合語尾（工業株式会社）の「工業」は
 * コア側に残る。単純 core で反転すると first=コア+工業株式会社（no-kind=コア工業）と
 * 相手=株式会社+コア（no-kind=コア）でキーが一致せず、意図した ambiguous ペアが
 * 成立しない。first から法人格のみを除いた実効コアで反転し、反転側は複合語尾を
 * 使わない（プレーンな法人格のみ）ことでキー一致を保証する。
 */
function attachOtherKind(core: string, first: string, rng: () => number): string {
  if (first.startsWith(core) && !first.endsWith(core)) {
    // first が後株（core+語尾）。実効コア = first から末尾の法人格のみを除いた残り
    //（工業株式会社なら「工業」が残る）。
    const effectiveCore = first.endsWith("株式会社")
      ? first.slice(0, first.length - "株式会社".length)
      : core;
    return `${pick(rng, KIND_PREFIX)}${effectiveCore}`;
  }
  // first が前株（法人格+core）。実効コア = core。反転側はプレーンな後株のみ。
  return `${core}株式会社`;
}

/** 都道府県コード（01..47 の捏造割当）。 */
function prefecture(rng: () => number): string {
  return String(1 + Math.floor(rng() * 47)).padStart(2, "0");
}

/**
 * 代表ケースを核に、決定論的な組合せで targetSize 件へ拡張した表示名列を返す。
 * 同一シードで完全に同じ列を返す（テストで固定）。生成分の一部は同一コア名を別法人格で
 * 複数出し、no-kind キー衝突（ambiguous）を一定比率含める。
 */
function buildDisplayNames(
  seed: number,
  targetSize: number,
): Array<readonly [string, string]> {
  const rng = createPrng(seed);
  const names: Array<readonly [string, string]> = [...REPRESENTATIVE];
  // index はコア名の一意化トークンに使う（生成分どうしの偶発衝突を避ける）。
  let index = 0;
  while (names.length < targetSize) {
    const core = buildCore(rng, index);
    index += 1;
    const first = attachKind(core, rng);
    names.push([first, prefecture(rng)]);
    // 一定比率で同一コア名（＝同一 no-kind キー）を別系統の法人格でもう 1 件出し、意図的な
    // ambiguous（no-kind 衝突）を作る。表示名は一致させない（前株↔後株を反転）。衝突源は
    // この再利用だけに限定する。
    if (rng() < AMBIGUOUS_RATIO && names.length < targetSize) {
      names.push([attachOtherKind(core, first, rng), prefecture(rng)]);
    }
  }
  return names.slice(0, targetSize);
}

/**
 * シード固定で合成コーパスを組む（決定論的）。同一シード・同一 targetSize なら完全に
 * 同じ列を返す。既定は本番用の CORPUS_SEED / TARGET_CORPUS_SIZE。
 */
export function buildSyntheticCorps(
  seed: number = CORPUS_SEED,
  targetSize: number = TARGET_CORPUS_SIZE,
): SyntheticCorp[] {
  return buildDisplayNames(seed, targetSize).map(
    ([name, prefectureCode], i) => ({
      corporateNumber: num(i + 1),
      name,
      prefectureCode,
    }),
  );
}

export const SYNTHETIC_CORPS: readonly SyntheticCorp[] = buildSyntheticCorps();
