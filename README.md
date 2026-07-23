# bango-benchmark

バンゴーAPI（[bango-api.jp](https://bango-api.jp)）の名寄せ精度を、**カバレッジ（confident 率）× confident 精度**の 2 軸で、再現可能な方法論つきで公開するベンチマークです。

公開ページ [https://bango-api.jp/benchmark](https://bango-api.jp/benchmark) に掲載している数値の**方法論・データセット・計測コードがすべてこのリポジトリにあります**。第三者がコード + シード + manifest だけで同一のデータセットを再構築し、API 経由で同一計測を再現できることを目的としています。

- **カバレッジ（coverage）**: 全評価行のうち、システムが `confident`（自動確定）と判定した割合。「拾える率」。
- **confident 精度（confidentPrecision）**: `confident` と判定した行のうち、真の法人番号に確定できた割合。「拾ったものが正しい率」。

この 2 軸はトレードオフの関係にあり、片方だけを高く見せることに意味はないため常に併記します。

> **データはすべて捏造**です。実在の法人番号・企業名は含みません。国税庁データも含みません（合成コーパス T2 のみ）。

---

## 最新結果

`results/2026-07-20-synthetic-v1.json`（合成コーパス 2,000 行・DB 直結モードでの実測。production と同一の候補検索・判定式を注入した非公開ハーネスによる計測で、API 経由モードは同一データセット・同一集計を共有する）の実測値です。

### 計測条件

| 項目 | 値 |
| --- | --- |
| データセット | 合成コーパス（synthetic-t2）2,000 行 |
| seed | `20260704` |
| fixtureHash | `038f671410a7a7e5` |
| datasetHash | `5580c66f60478ac2` |
| normalizerVersion | `2` |
| matchSimilarityThreshold | `0.5` |

### ヘッドライン指標

| 指標 | 値 | 定義 |
| --- | --- | --- |
| coverage（カバレッジ） | **68.15%** | confident 件数 / 全評価行 2,000 |
| confidentPrecision（confident 精度） | **100%** | confident 正解 / confident 全行（分母 1,363） |
| reviewRescueRate（review 救済率） | **100%** | review 行のうち真値が候補 5 件内にある割合 |
| falseNegativeRate（偽陰性率） | **20.15%** | 真値が DB にあるのに unmatched になった割合 |
| ambiguousConfidentViolations | **0** | 同名多数（review 正解）を誤って confident 化した件数 |

> **精度 100% は「合成縮小セット上で confident と判定した行に限った値」です。** 単独では過大な印象を与えるため、必ずカバレッジと併読してください。カバレッジ 68.15% は掲げている **目標 70% に未達**で、下記のケース別内訳が示すとおり、正規化で吸収できない非吸収系（かな⇄カナ・略語・誤字・部分名）は**設計上あえて confident にしていません**。

confident 精度の分母は「**confident と判定した全行（1,363 行）**」です。非 ambiguous 行数（2,000 − 37 = 1,963）でも全評価行 2,000 でもありません。ambiguous（同名多数で真値が一意に定まらない）行が confident 化された場合は**失敗として分子に数えず**精度を押し下げます。今回は `ambiguousConfidentViolations = 0` のため、結果的に 1,363 行すべてが非 ambiguous でした。

`falseNegativeRate`（20.15%）は `unmatchedRate` と一致します。v1 の合成コーパスは全行の真値が DB 内に存在し、DB 不在で分母から除外される行が無いためで、コピー誤りではありません（DB 不在ケースは T1 後続トラック）。

### 都道府県ヒント有無別

一定比率の行に都道府県ヒントを付与して候補範囲を絞った場合の効き目を分けて示します。

| 区分 | 件数 | coverage | confidentPrecision |
| --- | --- | --- | --- |
| ヒントあり | 993 | 73.11% | 100% |
| ヒントなし | 1,007 | 63.26% | 100% |

### ケース別内訳（摂動ファミリー別）

吸収系（正規化が照合キーで畳み込む摂動）は高カバレッジ、非吸収系はほぼ 0 カバレッジ・0 精度になります。**後者は正規化辞書が原理的に畳み込まないため confident にしない設計**であり、この分布が「精度 100% はカバレッジを犠牲にした値」であることを示します。

| ケース | 吸収可否 | 件数 | coverage | confidentPrecision |
| --- | --- | --- | --- | --- |
| variant（異体字） | 吸収 | 120 | 97.50% | 100% |
| spacing（スペース挿入） | 吸収 | 651 | 92.63% | 100% |
| shorthand（法人格略記） | 吸収 | 163 | 91.41% | 100% |
| kind_swap（前株⇄後株） | 吸収 | 112 | 93.75% | 100% |
| kind_drop（法人格脱落） | 吸収 | 216 | 88.89% | 100% |
| width（全半角） | 吸収 | 17 | 94.12% | 100% |
| long_sound（長音/ハイフン） | 吸収 | 35 | 94.29% | 100% |
| kana（かな⇄カナ） | 非吸収 | 20 | 0% | – |
| abbrev（略語） | 非吸収 | 7 | 0% | – |
| typo（誤字） | 非吸収 | 325 | 0.62% | 100% |
| partial（部分名） | 非吸収 | 112 | 0% | – |
| composite（複合・吸収成分のみ） | 吸収 | 155 | 94.19% | 100% |
| composite（複合・非吸収含む） | 非吸収 | 67 | 0% | – |

`–` は confident 行が 0 のため confident 精度が定義されないことを示します（元の計測 JSON では `0` として格納されています）。

---

## 方法論

### T2 合成ゆらぎ（`build-dataset/perturbation-gen.ts`）

正解の表示名に、実務で発生する表記ゆれ（摂動）をシード固定で加えて入力を生成します。摂動ファミリーは以下で、単独適用と複合適用（2〜3 ファミリーを重ねる）の両方を含みます。

- **吸収系**（正規化パイプラインが照合キーで畳み込む）: `identity` / `variant`（異体字 高→髙）/ `spacing`（全半角スペース・中黒挿入）/ `shorthand`（株式会社→㈱・(株)）/ `kind_swap`（前株⇄後株）/ `kind_drop`（法人格脱落）/ `width`（英数字全角化）/ `long_sound`（長音・ハイフン記号統一）
- **非吸収系**（正規化が畳み込まない）: `kana`（かな⇄カナ）/ `abbrev`（ホールディングス⇄HD）/ `typo`（1 文字置換・脱落・隣接転置）/ `partial`（コア名の部分切り出し）

非吸収系を一定比率（`nonAbsorbableRatio = 0.25`）で混ぜることで、精度の改善が「正規化の折り畳み」以外にも意味を持つことを検証できます。**同一シード・同一入力なら完全に同じ入力列を返します**（`createPrng` は mulberry32・決定論）。ゆらぎ付与は正規化の逆操作であり正規化辞書に依存しません（下記「公開境界」参照）。

### ambiguity（曖昧行）の扱い

ambiguity は「その行の**提出された入力**（＋ヒント）から真値が一意に定まらないこと」で判定します（`run/input-collision.ts` の `markEffectiveAmbiguity`）。コーパス側の重複だけで判定すると、法人格違いの同名（株式会社さくら／有限会社さくら）が、入力に法人格が残って一意化できる場合（`(株)さくら`）まで誤って ambiguous 扱いになり、法人格情報を正しく使う照合を精度失敗として誤計上してしまいます。そこで**入力の法人格を保持したまま照合キー化し、都道府県ヒント適用後の実効的な候補範囲**で非一意性を判定します。この判定は正規化列を焼き込んだ collision-metadata（コミット済み）から復元するため、**公開再現パスは正規化辞書を import しません**。

### 指標の分母設計

- **率系**（coverage / reviewRate / unmatchedRate / falseNegativeRate）は**全評価行 N を分母**にします。ambiguous 行を落とすと「review に正しく落とせた」ことが率へ反映されず指標が歪むためです。
- **confident 精度は confident 全行を分母**にし、実効 ambiguous 行の confident 化は**失敗として計上**します（除外しません）。同名企業を自動確定してしまうリグレッションを、精度指標が隠さないためです。

---

## 再現手順

### 1. データセットの再構築

第三者はこのリポジトリのコード + シード + `build-dataset/dataset-manifest.ts` だけで T2 データセットを再構築できます。`generateDataset` には manifest に記録された**全パラメータ**（`seed` / `nonAbsorbableRatio` / `compositeRatio` / `hintRatio` / `hintSeed`）を漏れなく渡してください。1 つでも欠けると再構築列が実測と異なるデータセットになります（例: `compositeRatio` を省略すると複合ケースを含まない別データセットになります）。

合成コーパス fixture（`fixtures/synthetic-corporations.sql`）と衝突メタデータ（`build-dataset/collision-metadata.json`）は正規化辞書に依存する派生物のため、**モノレポ側の非公開ビルド工程で事前計算されコミット済み**です。公開リポジトリの利用者はこのコミット済み生成物をそのまま使います（詳細は `build-dataset/README.md`）。

### 2. API 経由での計測

計測対象は、**合成コーパス fixture を seed した検証用 API インスタンス**に限ります（例: staging に migration + fixture を投入）。合成コーパスは捏造名・捏造番号のため、実データのみの本番 API へ投げると全行 unmatched になり計測として無意味です。この誤用は実行時ガードで遮断されます。

```bash
BENCHMARK_TARGET_KIND=fixture-seeded \
BENCHMARK_TARGET_NORMALIZER_VERSION=2 \
BENCHMARK_TARGET_SIMILARITY_THRESHOLD=0.5 \
BENCHMARK_API_BASE_URL=https://<fixtureをseed済みの検証API> \
BENCHMARK_API_KEY=<your-api-key> \
npm run benchmark:api
```

`npm run benchmark:api` は `tsx run/run-benchmark.ts fixtures/synthetic-corporations.sql` を実行します。

必須の環境変数:

| 環境変数 | 説明 |
| --- | --- |
| `BENCHMARK_TARGET_KIND` | `fixture-seeded` 固定。対象 API が合成コーパスを提供している明示。未設定なら起動前に fail |
| `BENCHMARK_TARGET_NORMALIZER_VERSION` | 対象デプロイの normalizer 版。manifest の `normalizerVersionForFixture`（= `2`）と一致必須 |
| `BENCHMARK_TARGET_SIMILARITY_THRESHOLD` | 対象デプロイの実効類似度閾値。manifest の `matchSimilarityThreshold`（= `0.5`）と一致必須 |
| `BENCHMARK_API_BASE_URL` | fixture を seed 済みの検証 API のベース URL |
| `BENCHMARK_API_KEY` | API キー |
| `BENCHMARK_POLL_TIMEOUT_MS` | （任意）ポーリング打ち切りまでのミリ秒。既定 120,000。ジョブが進捗を報告している間は打ち切らない |

**プラン注意**: バッチ照合は **Growth 以上**が前提です（Starter/Free は 403）。ただし本実行は 2,000 行を一括投入し、これは Growth の月間バッチ行クォータ（2,000 行）を 1 回で使い切ります（同月内の再実行不可）。再現実行には **Pro 以上のキーを推奨**します。

---

## 公開境界（正直な開示）

- **正規化辞書（`@houjin/normalizer`）は非公開**です。名称の正規化・照合キー生成は名寄せ精度の中核ノウハウのため、公開しません。
- **正規化に依存する派生物**（fixture SQL の焼き込み列 `name_normalized` / `name_no_kind`・`collision-metadata.json`・`fixtureHash` / `datasetHash`）は、**非公開ビルド工程で事前計算してコミット済み**です。公開リポジトリのコードはこれらの生成物を読むだけで、正規化辞書を import しません。
- **吸収可否分類（どの摂動が正規化で畳み込まれるか）が正規化実装と一致するかの突合テストは、非公開側 CI で実施**します。公開側の摂動生成器は正規化辞書を import せずハンドコードのテーブルで再現します。

この境界により、第三者は正規化辞書なしで（コード + シード + コミット済み生成物で）同一計測を再現できます。

---

## 既知の限界

- **合成コーパス（T2）のみ**です。実在ペア（T1）は `build-dataset/fetch-t1-sources.ts` にスケルトンと手順のみで、実取得は後続トラックです。
- **実 DB を用いた月次計測は別掲**とし、後続で追加します。
- **カバレッジ 68.15% は目標 70% に未達**です。この事実を隠さず公開しています。
- 上記のとおり、非吸収系の摂動は設計上 confident にしないため、精度 100% は**合成縮小セット上・confident 行限定**の値です。

---

## ディレクトリ構成

| パス | 内容 |
| --- | --- |
| `build-dataset/` | データセット構築（摂動生成器・合成コーパス・manifest・collision-metadata・fixtureHash・T1 スケルトン） |
| `run/` | API 計測ハーネス（実行エントリ・バッチ投入・設定・collision-metadata reader） |
| `report/aggregate.ts` | 集計層（ヘッドライン指標・カバレッジ-精度カーブ・ケース別内訳） |
| `compare-to-baseline.ts` | CI リグレッションゲート（baseline との confident 精度差分判定） |
| `baseline.json` | 精度 baseline（回帰検出の基準値） |
| `fixtures/synthetic-corporations.sql` | 合成コーパス fixture（コミット済み生成物） |
| `results/` | 計測結果 JSON |
| `__tests__/` | vitest テスト |

---

## テスト・型検査

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

---

## ライセンス

[MIT](./LICENSE)
