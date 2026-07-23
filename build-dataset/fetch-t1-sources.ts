/**
 * T1 実在ペア（公的リスト由来）調達スケルトン。
 *
 * v1 スコープでは雛形と手順のみを提供し、ネットワーク取得は実装しない
 * （ネットワーク依存は PR/CI を不安定化させるため後続トラックへ切り出す）。
 * 実際の調達手順は同ディレクトリの README を参照する。
 *
 * T1 の目的: 「同一法人の別ソース表記 → 法人番号」の実在ペアを集め、合成ゆらぎ
 * （T2）では再現しきれない自然な表記ゆれ（別ソース由来の全角半角・法人格位置・略記）
 * を評価に含める。正解ラベルは各ソースが持つ法人番号列をそのまま使う。
 *
 * 設計方針:
 * - 取得したソースは URL と取得日を manifest に記録する（再現性の主張に必須）。
 * - 出力は T2 と同じ per-row 入力（表示名 + 真の法人番号）に正規化し、
 *   run-benchmark（API経由）/ run-benchmark-db（DB直結）へ渡せる形にする。
 * - 正規化辞書（@houjin/normalizer）には依存しない（公開生成物の OSS 境界を維持）。
 */

export type T1SourceKind = "edinet-code-list" | "gbizinfo" | "gov-procurement";

export type T1Source = {
  kind: T1SourceKind;
  /** 取得元 URL。取得日とともに manifest に焼き込む。 */
  url: string;
  /** 取得日（YYYY-MM-DD）。データは日々変わるため再現性の主張に必須。 */
  fetchedAt: string;
};

/** T1 の 1 レコード = 別ソース表記とその法人番号（オラクル）。 */
export type T1Pair = {
  /** 別ソースでの名称表記（自然な表記ゆれを含む）。 */
  displayName: string;
  /** 正解の法人番号（ソースの法人番号列由来）。 */
  corporateNumber: string;
  source: T1SourceKind;
};

/**
 * T1 ソースを取得する（未実装スケルトン）。
 *
 * v1 では実行しない。実装時はここで公的 CSV を取得し、法人番号列の存在を確認して
 * from(表記) / to(法人番号) を抽出する。取得元・取得日は manifest に記録する。
 * 手順は README（build-dataset/README.md）の「T1 実在ペア調達」を参照。
 */
export async function fetchT1Sources(_sources: readonly T1Source[]): Promise<
  T1Pair[]
> {
  throw new Error(
    "T1 acquisition is not implemented in v1. See build-dataset/README.md for the procedure; T1 fetch is a follow-up track (network-dependent).",
  );
}
