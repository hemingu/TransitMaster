# 人力路線検索マスター

ランダムに与えられる2駅間について、実際の鉄道路線図を思い浮かべながら「経路（利用する路線と乗換駅）」を自分の頭で答えるブラウザゲームです。完全静的な SPA として実装されており、GitHub Pages 上でそのまま動作します。

## ゲーム概要

- 出題: ランダムな2駅間が示されるので、乗換駅と利用路線を答える。
- エリア: 東京23区内 / 東京都内 / 名古屋市内 / 大阪市内 / 日本全国 の5種類から選択可能。
- 模範解答モード: 以下の3モードで「模範解答」となる経路が変わる。
  - 最短時間（time）
  - 最小乗換回数（transfers）
  - 最安運賃（fare）
- 経路探索はブラウザ内で完結する（サーバー通信なし）。

## セットアップ（ミニデータですぐ遊べる）

実データ（ODPT の GTFS）を使わなくても、リポジトリに同梱のフィクスチャ（ミニGTFS）ですぐに動作確認できます。

```bash
npm install
npm run build:network -- --fixture   # tests/fixtures のミニGTFSから public/data/network.json を生成
npm run dev
```

`http://localhost:5173`（Vite のデフォルトポート）でゲームが起動します。

## 実データ（ODPT GTFS）を使う手順

本番相当のデータで遊ぶには、ODPT（公共交通オープンデータセンター）が提供する GTFS を取得します。

1. **ODPT 開発者登録**（無料）
   [developer.odpt.org](https://developer.odpt.org/) でユーザー登録し、アクセストークンを発行します。承認には最大2営業日程度かかる場合があります。
2. **トークンを環境変数に設定**
   ```bash
   export ODPT_TOKEN=xxxxxxxxxxxxxxxx
   ```
3. **鉄道 GTFS データセットの一覧を取得**（トークン不要）
   ```bash
   npm run fetch:gtfs -- --list
   ```
   ODPT の CKAN データカタログ（https://ckan.odpt.org）から鉄道 GTFS を検索し、`data/gtfs/manifest.json` に一覧を保存します。
4. **GTFS zip をダウンロード**
   ```bash
   npm run fetch:gtfs
   ```
   manifest.json の各リソースを `data/gtfs/*.zip` にダウンロードします。`ODPT_TOKEN` が必要なリソースは、未設定の場合スキップして警告を出します（トークン不要で取得できる公開データのみダウンロードされます）。
5. **network.json を再生成**
   ```bash
   npm run build:network
   ```
   `data/gtfs/*.zip` が存在する場合は自動的にそれらを読み込みます（`--fixture` を付けなければ実データが優先されます）。
6. `npm run dev` または `npm run build` で反映を確認します。

### ODPT データ取得についての補足（調査結果）

`scripts/fetch-gtfs.ts` を実装するにあたり実際に ODPT の CKAN カタログを調査した結果、以下がわかっています。

- CKAN の REST API（`/api/3/action/package_search` 等）は `robots.txt` で `Disallow: /api/` が指定されており、実際にリクエストすると nginx がデータセット一覧ページへ 301 リダイレクトしてしまうため **API 経由では取得できません**。そのため `fetch-gtfs.ts` は公開されているデータセット検索・詳細の HTML ページをスクレイピングして情報を取得しています。
- 検索条件 `res_format=GTFS/GTFS-JP` かつ タグ `鉄道-railway` で **鉄道 GTFS データセットが10件** ヒットします（2026年7月時点）。関東の事業者（東京メトロ・都営地下鉄・東武鉄道・京王電鉄・りんかい線・多摩都市モノレール・つくばエクスプレス・横浜市営地下鉄）が中心で、関東以外は京都市営地下鉄・函館市電の2件のみです。関西・中部・九州の主要私鉄の多くは現状カタログに未掲載です。
- 認証方式は事業者によって3パターンあります。
  - `api-public.odpt.org` 配下: **トークン不要**（都営地下鉄・函館市電）。
  - `api.odpt.org` 配下: 通常のアクセストークンが `?acl:consumerKey=<トークン>` として必要（基本ライセンス）。
  - `api-challenge.odpt.org` 配下: 「公共交通オープンデータチャレンジ限定ライセンス」の別枠トークンが必要（京王電鉄・東武鉄道など）。通常の `ODPT_TOKEN` では 401/403 になる可能性があります。
  - トークン不要の2件（都営地下鉄・函館市電）は実際にダウンロードして疎通確認済みで、いずれも `fare_attributes.txt` / `fare_rules.txt` を含んでおり運賃データも利用できます。

## アーキテクチャ概説

1. **GTFS → network.json（ビルド時）**
   `data/gtfs/*.zip`（GTFS フィード）を `scripts/build-network.ts` が読み込み、駅・路線・時刻表・乗換グループ・運賃情報を統合した `public/data/network.json` を生成します（`scripts/buildNetwork.ts` が実処理、`scripts/gtfsCsv.ts` が GTFS CSV パーサ）。
2. **経路探索（ブラウザ内 RAPTOR）**
   `src/lib/raptor.ts` が RAPTOR アルゴリズムで最短時間・最小乗換・最安運賃の経路を計算します。UI をブロックしないよう `src/worker/routing.worker.ts`（Web Worker）上で実行し、`src/components/useRoutingWorker.ts` から呼び出します。
3. **エリア判定**
   `src/lib/area.ts` が `src/data/areas.json`（GeoJSON 由来のポリゴン）を使い、point-in-polygon 判定で駅がどのエリアに属するかを判定します。ポリゴンは `scripts/build-areas.ts` により外部の GeoJSON から生成されます。
4. **出題・採点**
   `src/lib/question.ts` が出題（駅ペア選択・難易度に応じた乗換回数レンジ）、`src/lib/validate.ts` が回答の採点、`src/lib/game.ts` がゲーム進行を担当します。

## データ出典・クレジット

- **GTFS 交通データ**: 本アプリは [公共交通オープンデータセンター（ODPT）](https://www.odpt.org/) が公開する GTFS データを利用しています。データの正式なクレジット表記・詳細な利用条件は [developer.odpt.org の利用規約ページ](https://developer.odpt.org/terms) に従ってください（当該ページは JavaScript が必要な SPA のため、実データを配布・公開する際は必ず開発者サイトにログインして最新の利用条件・クレジット表記文言を確認してください）。一般に ODPT データを利用する場合は「本アプリは公共交通オープンデータセンターが公開するデータを利用しています」旨の表記と、データ提供事業者名の明記が求められます。
- **区市町村・都道府県境界データ**: [niiyz/JapanCityGeoJson](https://github.com/niiyz/JapanCityGeoJson)（市区町村ポリゴン）、[dataofjapan/land](https://github.com/dataofjapan/land)（都道府県ポリゴン）を使用しています。
- デプロイ時（GitHub Actions）はトークン未取得の間、`tests/fixtures` のフィクスチャ（架空のミニGTFS）でビルドしています。実データに切り替える手順は上記「実データ（ODPT GTFS）を使う手順」を参照してください。

## テスト・ビルドコマンド一覧

| コマンド | 内容 |
| --- | --- |
| `npm install` | 依存関係のインストール |
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 型チェック＋本番ビルド（`dist/`） |
| `npm run preview` | ビルド成果物のプレビュー |
| `npm test` | Vitest によるユニットテスト実行 |
| `npm run lint` | Oxlint による静的解析 |
| `npm run build:network -- --fixture` | フィクスチャ（ミニGTFS）から `public/data/network.json` を生成 |
| `npm run build:network` | `data/gtfs/*.zip`（実データ）から `public/data/network.json` を生成 |
| `npm run fetch:gtfs -- --list` | ODPT CKAN カタログから鉄道 GTFS データセット一覧を取得（トークン不要） |
| `npm run fetch:gtfs` | manifest.json の各リソースを `data/gtfs/*.zip` にダウンロード（`ODPT_TOKEN` 使用） |

## デプロイ

`main` ブランチへの push で GitHub Actions（`.github/workflows/deploy.yml`）が自動的に以下を実行し、GitHub Pages にデプロイします。

1. `npm ci`
2. `npm test`（失敗時はデプロイしない）
3. `npm run build:network -- --fixture`（現状はフィクスチャデータ。実データに切り替える場合は上記手順を参照し、ワークフロー内のコメントに従って `fetch:gtfs` 呼び出しに置き換えてください）
4. `npm run build`
5. GitHub Pages へアップロード・デプロイ
