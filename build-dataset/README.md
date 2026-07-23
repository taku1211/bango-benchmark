# build-dataset — 名寄せベンチマークのデータセット構築

名寄せ公開ベンチマークの入力データセットを構築するモジュール群。データ層は設計書
（`docs/nayose-benchmark-design.md` §1）の T1/T2/T3 に対応する。

- **T2 合成ゆらぎ**（`perturbation-gen.ts`）: v1 で実装済み。シード固定・正規化辞書非依存。
- **合成コーパス**（`synthetic-corpus.ts` / `build-fixture.ts`）: CI ゲート用の捏造コーパス。
- **T1 実在ペア**（`fetch-t1-sources.ts`）: v1 は**スケルトン + 手順のみ**。実取得は後続トラック。
- **manifest**（`dataset-manifest.ts`）: 版・シード・件数・ソースを記録し第三者再構築を可能にする。

## T2 合成ゆらぎ（実装済み）

`perturbation-gen.ts` の
`generateDataset(names, { seed, nonAbsorbableRatio, compositeRatio })` が表示名の列から
シード固定で摂動入力を生成する。同一シード・同一入力なら完全に同じ列を返す。
**再構築時は manifest（`dataset-manifest.ts`）に記録された全パラメータ
（seed / nonAbsorbableRatio / compositeRatio / hintRatio / hintSeed）を漏れなく使うこと。**
compositeRatio を省略すると既定 0 になり複合ケースを含まない別データセットになる。
都道府県ヒントの行割当は `run/benchmark-config.ts` の `hasPrefectureHint`
（hintRatio / hintSeed）で決まり、計測条件の一部である。
正規化辞書（`@houjin/normalizer`）には依存しない（ゆらぎ付与は正規化の逆操作で辞書不要。
正規化辞書は名寄せ精度の中核ノウハウのため非公開を維持する）。

## 合成コーパス fixture・衝突メタデータの再生成（非公開ビルド工程）

fixture SQL（`../fixtures/synthetic-corporations.sql`）の焼き込み列
`name_normalized` / `name_no_kind` と `collision-metadata.json`・`fixtureHash` /
`datasetHash` は `@houjin/normalizer`（正規化辞書）に依存する派生物である。
これらを生成する `build-fixture.ts` は**モノレポ側にのみ存在し、正規化辞書を必要とする
非公開ビルド工程**であり、この公開リポジトリには含まれない。

- **公開リポジトリの利用者**: 再生成はできない・不要。コミット済みの生成物
  （`../fixtures/synthetic-corporations.sql`・`collision-metadata.json`）をそのまま使う。
  ルート `README.md` の再現手順に従えば、正規化辞書なしで同一計測を再現できる。
- **モノレポ側の保守者**: `synthetic-corpus.ts` の表示名を編集したら、モノレポの
  `build-fixture.ts`（`@houjin/normalizer` を import し、`name_normalized` /
  `name_no_kind` を production 照合と一致させる）で fixture SQL と衝突メタデータを
  再生成し、この公開リポジトリへ生成物を再コミットする。fixture を変更すると baseline も
  無効化されるため、DB 実走で baseline（`../baseline.json`）を再生成する。

## API 経由モードの対象（fixture を seed した検証インスタンス）

合成コーパスは捏造名・捏造番号のため実データのみの本番 API には存在しない。API 経由の
再現は、**上記 fixture SQL を seed した検証用 API インスタンス**（例: staging に
migration + fixture 投入）へ向けて行う。実行時は
`BENCHMARK_TARGET_KIND=fixture-seeded` と、対象デプロイの normalizer 版
`BENCHMARK_TARGET_NORMALIZER_VERSION`（manifest の `normalizerVersionForFixture` と
一致必須）の明示が必要（未設定なら起動前に fail）。2,000 行の一括投入は Growth の
月間バッチ行クォータをちょうど使い切るため、再現実行には Pro 以上のキーを推奨する。
実データベースでの第三者再現は T1 実在ペアコーパスの後続トラックで解禁される。
API 経由計測の実行方法と必須 env はルート `README.md` の再現手順を参照
（公開リポジトリでは `npm run benchmark:api`）。

## T1 実在ペア調達（v1 は手順のみ・後続トラック）

`fetch-t1-sources.ts` はスケルトンで、v1 ではネットワーク取得を実装しない
（ネットワーク依存は PR/CI を不安定化させるため後続 Issue へ切り出す）。実取得時の手順:

1. **ソース取得**: 名称 + 法人番号を併記する公開データを取得する。候補（設計書 §1-1）:
   - EDINET コードリスト CSV（提出者法人番号列を含む。列の存在は取り込み時に要確認）
   - gBizINFO データダウンロード（法人番号キーの名称・所在地）
   - 補助金採択者リスト・政府調達（入札結果）CSV など、名称 + 法人番号併記の官公庁公開リスト
2. **取得元の記録**: 各ソースの URL と取得日（YYYY-MM-DD）を manifest に焼き込む。
   データは日々変わるため、この記録がないと再現性の主張が成立しない。
3. **ペア抽出**: 法人番号列の存在を確認し、`{ displayName, corporateNumber, source }` に正規化する。
   T1 の要点は「同一法人の**別ソース表記**」が自然な表記ゆれ（全角半角・法人格位置・略記）を
   含むこと。
4. **オラクル整合**: 同名多数（都道府県ヒントなしで一意に定まらない）ケースは ambiguous として
   精度分母から分離する（T2 と同じ扱い。設計書 §1-3）。
5. **計測**: 出力を run-benchmark（API経由・第三者再現）/ run-benchmark-db（DB直結・CI）へ渡す。

## 第三者による再構築

第三者はこのリポジトリのコード + シード + `dataset-manifest.ts` だけで T2 データセットを
再構築し、API経由モード（`../run/run-benchmark.ts` = `npm run benchmark:api`。バッチ照合は
Growth 以上が前提だが、2,000 行を 1 回で使い切るため再現実行は Pro 以上を推奨）で
同一計測を再現できる。
