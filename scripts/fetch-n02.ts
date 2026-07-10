/**
 * 国土数値情報 N02（鉄道）2025年版の GML/GeoJSON 一式（zip、約15MB）を取得し、
 * 新幹線補完に必要な2ファイルだけを data/n02/ に展開・保存するスクリプト。
 *
 * 取得元: https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip
 *
 * 既に data/n02/ に両ファイルが存在する場合はスキップする（--force で再取得）。
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const ROOT = resolve(import.meta.dirname, '..');
const N02_DIR = join(ROOT, 'data', 'n02');
const ZIP_URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip';

// zip内の目的の2ファイルへの相対パス（UTF-8ディレクトリ配下）
const TARGET_FILES = ['N02-25_Station.geojson', 'N02-25_RailroadSection.geojson'];
const ZIP_ENTRY_DIR = 'N02-25_GML/UTF-8/';

const FETCH_TIMEOUT_MS = 60000;

async function downloadArrayBuffer(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const force = process.argv.includes('--force');

  mkdirSync(N02_DIR, { recursive: true });

  const outputPaths = TARGET_FILES.map((f) => join(N02_DIR, f));
  if (!force && outputPaths.every((p) => existsSync(p))) {
    console.log('data/n02/ に既にN02ファイルが存在するためスキップします（--force で再取得）。');
    return;
  }

  console.log(`N02-25_GML.zip をダウンロード中... (${ZIP_URL})`);
  const buf = await downloadArrayBuffer(ZIP_URL);
  console.log(`ダウンロード完了（${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）。展開します...`);

  const unzipped = unzipSync(new Uint8Array(buf));

  let savedCount = 0;
  for (const targetFile of TARGET_FILES) {
    const entryKey = Object.keys(unzipped).find(
      (name) => name === `${ZIP_ENTRY_DIR}${targetFile}` || name.endsWith(`/${targetFile}`) || name === targetFile
    );
    if (!entryKey) {
      console.error(`zip内に ${targetFile} が見つかりませんでした（zip構造が変更された可能性があります）。`);
      continue;
    }
    const data = unzipped[entryKey];
    writeFileSync(join(N02_DIR, targetFile), Buffer.from(data));
    console.log(`  保存: data/n02/${targetFile}`);
    savedCount++;
  }

  if (savedCount === TARGET_FILES.length) {
    console.log('N02データの取得が完了しました。');
  } else {
    console.error('一部のファイルが取得できませんでした。zip構造を確認してください。');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('N02データの取得に失敗しました:', err);
  process.exit(1);
});
