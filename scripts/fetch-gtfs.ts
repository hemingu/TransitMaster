/**
 * ODPT（公共交通オープンデータセンター）の CKAN データカタログ（https://ckan.odpt.org）
 * から鉄道 GTFS データセットを検索・取得するスクリプト。
 *
 * 【重要な調査結果】
 * CKAN の標準 REST API（/api/3/action/package_search 等）は robots.txt で
 * `Disallow: /api/` が指定されており、実際に nginx 側で `/api/3/action/*` への
 * リクエストはすべて `/dataset` （検索結果 HTML ページ）へ 301 リダイレクトされる。
 * つまり API 経由でのデータ取得は事実上ブロックされており、公開されている
 * データセット検索・詳細の HTML ページをスクレイピングする以外に方法がない。
 * （2026-07-06 時点で curl / WebFetch 双方で確認済み）
 *
 * 検索結果 HTML から確認できた鉄道 GTFS の見つけ方:
 *   - 一覧: https://ckan.odpt.org/dataset/?res_format=GTFS%2FGTFS-JP&tags=鉄道-railway
 *     （res_format は "GTFS/GTFS-JP"、タグは "鉄道-railway"）
 *   - 上記で 10 件ヒット（京都市営地下鉄・京王電鉄・東武鉄道・函館市電・
 *     横浜市営地下鉄・相鉄(MIR)・都営地下鉄・多摩モノレール・りんかい線(TWR)・
 *     東京メトロ）。これはあくまで CKAN 上にメタデータが登録されている事業者の
 *     一覧であり、関東以外は京都市営地下鉄・函館市電のみで、他の関西・中部・
 *     九州等の主要私鉄は現状カタログ未掲載（2026-07-06 時点）。
 *   - 各データセット詳細ページ（/dataset/<id>）内の resource 一覧から
 *     詳細ページ（/dataset/<id>/resource/<uuid>）へ辿り、実際のダウンロード
 *     URL・ライセンス種別を取得する。複数バージョン（日付違い）が登録されている
 *     データセットは一覧の先頭（＝最新日付）を採用する。
 *
 * 認証方式（実データで確認したパターン）:
 *   - api-public.odpt.org 配下: トークン不要（例: 都営地下鉄、函館市電）。
 *     実際に無トークンで zip ダウンロードに成功し、fare_attributes.txt /
 *     fare_rules.txt を含む運賃データも取得できることを確認した。
 *   - api.odpt.org 配下: `?acl:consumerKey=<トークン>` （複数パラメータ時は
 *     `&acl:consumerKey=`）が必要。「公共交通オープンデータ基本ライセンス」。
 *     東京メトロ・東武鉄道(通常版)・りんかい線・多摩モノレール・
 *     横浜市営地下鉄・京都市営地下鉄など。
 *   - api-challenge.odpt.org 配下: 同じく `?acl:consumerKey=<トークン>` が
 *     必要だが「公共交通オープンデータチャレンジ限定ライセンス」という別枠の
 *     チャレンジ専用トークンが要る（例: 京王電鉄、東武鉄道のチャレンジ版）。
 *     本スクリプトでは通常の ODPT_TOKEN と同じ環境変数を試すが、チャレンジ
 *     専用トークンが別途必要な場合はダウンロードが 401/403 になり得る。
 *
 * サブコマンド:
 *   npm run fetch:gtfs -- --list   : トークン不要。データセット一覧を取得して
 *                                    表示 & data/gtfs/manifest.json に保存。
 *   npm run fetch:gtfs             : manifest.json の各リソースを
 *                                    data/gtfs/*.zip にダウンロード。
 *                                    ODPT_TOKEN 未設定ならトークン必須の
 *                                    リソースはスキップして警告する。
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const ROOT = resolve(import.meta.dirname, '..');
const GTFS_DIR = join(ROOT, 'data', 'gtfs');
const MANIFEST_PATH = join(GTFS_DIR, 'manifest.json');

const CKAN_BASE = 'https://ckan.odpt.org';
// CKAN の REST API (/api/3/action/*) は robots.txt で禁止されており、実際に
// nginx が /dataset へ 301 リダイレクトしてしまうため使用不可。
// 検索結果 HTML ページ（res_format=GTFS/GTFS-JP かつ tags=鉄道-railway）を
// スクレイピングする。
const SEARCH_PATH = '/dataset/';
const SEARCH_QUERY = 'res_format=GTFS%2FGTFS-JP&tags=%E9%89%84%E9%81%93-railway';

const FETCH_TIMEOUT_MS = 20000;
// レート配慮のため直列ダウンロード・失敗時のリトライは1回のみ（fetchTextWithRetry /
// downloadArrayBufferWithRetry 内にハードコード）。

interface ManifestResource {
  /** データセットID（CKAN の dataset slug） */
  datasetId: string;
  /** 事業者・データセット名（日本語 / 英語混在の表示名） */
  title: string;
  /** CKAN 上のデータセットページ URL */
  datasetUrl: string;
  /** 実際のダウンロード URL（トークンプレースホルダは除去済み、素の URL） */
  resourceUrl: string;
  /** トークンなしでアクセス可能か（api-public.odpt.org 判定） */
  requiresToken: boolean;
  /** ライセンス表示名 */
  license: string | null;
  /** ダウンロード先ファイル名（data/gtfs/<fileName>） */
  fileName: string;
  /** ダウンロード後に判明する情報 */
  downloaded?: boolean;
  downloadedAt?: string;
  fareAvailable?: boolean;
  error?: string;
}

interface Manifest {
  generatedAt: string;
  source: string;
  note: string;
  resources: ManifestResource[];
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithRetry(url: string): Promise<string> {
  try {
    return await fetchText(url);
  } catch (err) {
    console.warn(`  取得失敗、リトライします: ${url} (${(err as Error).message})`);
    return await fetchText(url);
  }
}

/** 検索結果 HTML から /dataset/<id> のスラッグ一覧を抽出する（重複除去） */
function extractDatasetIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /<h2 class="dataset-heading">\s*<a href="\/dataset\/([a-zA-Z0-9_-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

/** 検索結果 HTML から「N 件のデータセットが見つかりました」の N を抽出する */
function extractResultCount(html: string): number | null {
  const m = html.match(/([0-9,]+)\s*件のデータセットが見つかりました/);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

/** データセット詳細ページ HTML からタイトルを抽出する */
function extractDatasetTitle(html: string): string {
  const m = html.match(/<h1 class="heading">([^<]+)<\/h1>/);
  return m ? m[1].trim() : '(不明)';
}

/** データセット詳細ページ HTML から resource 詳細ページへの相対パス一覧を抽出する（先頭＝最新） */
function extractResourcePaths(html: string, datasetId: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(`<a class="heading" href="(/dataset/${datasetId}/resource/[a-f0-9\\-]+)"`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

interface ResourceDetail {
  url: string;
  license: string | null;
}

/** resource 詳細ページ HTML から実ダウンロード URL とライセンスを抽出する */
function extractResourceDetail(html: string): ResourceDetail | null {
  const urlMatch = html.match(/class="resource-url-analytics" href="([^"]+)"/);
  if (!urlMatch) return null;
  // HTML エンティティ &amp; をデコード
  const url = urlMatch[1].replace(/&amp;/g, '&');
  const licenseMatch = html.match(/rel="dc:rights">([^<]+)<\/a>/);
  return { url, license: licenseMatch ? licenseMatch[1].trim() : null };
}

/** URL からトークンプレースホルダを除去し、素の URL（クエリのトークン部分抜き）にする */
function stripTokenPlaceholder(url: string): { bare: string; requiresToken: boolean } {
  const requiresToken = /acl:consumerKey=/.test(url);
  // プレースホルダ（[アクセストークン/...] や [Access_Token_for_Challenge2026] 等）を除去
  const bare = url
    .replace(/[?&]acl:consumerKey=\[[^\]]*\]/, '')
    .replace(/[?&]acl:consumerKey=$/, '');
  return { bare, requiresToken };
}

function fileNameFromUrl(datasetId: string, url: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').pop() || `${datasetId}.zip`;
    return base.toLowerCase().endsWith('.zip') ? base : `${datasetId}.zip`;
  } catch {
    return `${datasetId}.zip`;
  }
}

async function buildManifest(): Promise<Manifest> {
  console.log('CKAN データカタログから鉄道 GTFS データセットを検索します...');
  console.log(`  検索条件: res_format=GTFS/GTFS-JP, tags=鉄道-railway`);

  const searchUrl = `${CKAN_BASE}${SEARCH_PATH}?${SEARCH_QUERY}`;
  const html = await fetchTextWithRetry(searchUrl);
  const total = extractResultCount(html);
  const datasetIds = extractDatasetIds(html);

  console.log(`  検索結果: ${total ?? '?'} 件中 ${datasetIds.length} 件のデータセットIDを抽出`);

  const resources: ManifestResource[] = [];

  for (const datasetId of datasetIds) {
    const datasetUrl = `${CKAN_BASE}/dataset/${datasetId}`;
    console.log(`  - ${datasetId} を調査中...`);
    let datasetHtml: string;
    try {
      datasetHtml = await fetchTextWithRetry(datasetUrl);
    } catch (err) {
      console.warn(`    データセットページ取得失敗: ${(err as Error).message}`);
      continue;
    }
    const title = extractDatasetTitle(datasetHtml);
    const resourcePaths = extractResourcePaths(datasetHtml, datasetId);
    if (resourcePaths.length === 0) {
      console.warn(`    resource が見つかりませんでした: ${datasetId}`);
      continue;
    }
    // 先頭（一覧の最初）＝最新バージョンを採用
    const resourcePath = resourcePaths[0];
    const resourceUrl = `${CKAN_BASE}${resourcePath}`;
    let detail: ResourceDetail | null;
    try {
      const resourceHtml = await fetchTextWithRetry(resourceUrl);
      detail = extractResourceDetail(resourceHtml);
    } catch (err) {
      console.warn(`    resource 詳細取得失敗: ${(err as Error).message}`);
      continue;
    }
    if (!detail) {
      console.warn(`    ダウンロード URL が見つかりませんでした: ${datasetId}`);
      continue;
    }
    const { bare, requiresToken } = stripTokenPlaceholder(detail.url);
    resources.push({
      datasetId,
      title,
      datasetUrl,
      resourceUrl: bare,
      requiresToken,
      license: detail.license,
      fileName: fileNameFromUrl(datasetId, bare),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: searchUrl,
    note:
      'CKAN REST API (/api/3/action/*) は robots.txt で禁止され実際に /dataset へ301される' +
      'ため、検索結果HTMLページのスクレイピングで取得。resourceUrl はトークンプレースホルダ除去済み。' +
      'requiresToken=true の場合、ダウンロード時に ODPT_TOKEN を ?acl:consumerKey= または ' +
      '&acl:consumerKey= として付与する。',
    resources,
  };
}

function printManifestSummary(manifest: Manifest): void {
  console.log('');
  console.log(`鉄道 GTFS データセット一覧（${manifest.resources.length} 件）:`);
  console.log('');
  for (const r of manifest.resources) {
    console.log(`  [${r.requiresToken ? '要トークン' : 'トークン不要'}] ${r.title}`);
    console.log(`    datasetId : ${r.datasetId}`);
    console.log(`    license   : ${r.license ?? '(不明)'}`);
    console.log(`    resource  : ${r.resourceUrl}`);
    console.log('');
  }
  const tokenFree = manifest.resources.filter((r) => !r.requiresToken).length;
  console.log(`  トークン不要: ${tokenFree} 件 / 要トークン: ${manifest.resources.length - tokenFree} 件`);
}

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      `manifest が見つかりません（${MANIFEST_PATH}）。先に \`npm run fetch:gtfs -- --list\` を実行してください。`
    );
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
}

function buildAuthorizedUrl(bareUrl: string, token: string): string {
  const separator = bareUrl.includes('?') ? '&' : '?';
  return `${bareUrl}${separator}acl:consumerKey=${encodeURIComponent(token)}`;
}

async function downloadArrayBufferWithRetry(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 3);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (err) {
    console.warn(`    ダウンロード失敗、リトライします (${(err as Error).message})`);
    clearTimeout(timer);
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS * 3);
    try {
      const res2 = await fetch(url, { signal: controller2.signal });
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      return await res2.arrayBuffer();
    } finally {
      clearTimeout(timer2);
    }
  } finally {
    clearTimeout(timer);
  }
}

function checkFareAvailable(zipBuf: ArrayBuffer): boolean {
  try {
    const unzipped = unzipSync(new Uint8Array(zipBuf));
    return Object.keys(unzipped).some((name) => name.split('/').pop() === 'fare_attributes.txt');
  } catch {
    return false;
  }
}

async function downloadAll(manifest: Manifest): Promise<void> {
  const token = process.env.ODPT_TOKEN;
  if (!token) {
    console.warn(
      'ODPT_TOKEN が未設定です。トークン不要のリソースのみダウンロードし、要トークンのものはスキップします。'
    );
  }

  mkdirSync(GTFS_DIR, { recursive: true });

  for (const r of manifest.resources) {
    if (r.requiresToken && !token) {
      console.log(`スキップ（要トークン、ODPT_TOKEN未設定）: ${r.title}`);
      r.downloaded = false;
      r.error = 'ODPT_TOKEN not set';
      continue;
    }
    const url = r.requiresToken ? buildAuthorizedUrl(r.resourceUrl, token!) : r.resourceUrl;
    console.log(`ダウンロード中: ${r.title} (${r.fileName})`);
    try {
      const buf = await downloadArrayBufferWithRetry(url);
      const outPath = join(GTFS_DIR, r.fileName);
      writeFileSync(outPath, Buffer.from(buf));
      const fareAvailable = checkFareAvailable(buf);
      r.downloaded = true;
      r.downloadedAt = new Date().toISOString();
      r.fareAvailable = fareAvailable;
      delete r.error;
      console.log(`  完了: ${outPath}（運賃データ: ${fareAvailable ? 'あり' : 'なし'}）`);
    } catch (err) {
      r.downloaded = false;
      r.error = (err as Error).message;
      console.error(`  失敗: ${r.title} (${(err as Error).message})`);
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('');
  console.log(`manifest.json を更新しました: ${MANIFEST_PATH}`);
}

async function main() {
  const isList = process.argv.includes('--list');

  if (isList) {
    const manifest = await buildManifest();
    mkdirSync(GTFS_DIR, { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    printManifestSummary(manifest);
    console.log(`manifest.json を保存しました: ${MANIFEST_PATH}`);
    return;
  }

  const manifest = loadManifest();
  await downloadAll(manifest);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exitCode = 1;
});
