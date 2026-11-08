/**
 * 国土数値情報「駅別乗降客数データ」S12（CC BY 4.0、国土交通省）をダウンロードし、
 * data/s12/ に GeoJSON（UTF-8）を展開する。
 *
 * 取得元: https://nlftp.mlit.go.jp/ksj/gml/data/S12/S12-25/S12-25_GML.zip（約7MB）
 * 展開するのは UTF-8 版の GeoJSON のみ（data/s12/S12-25_NumberOfPassengers.geojson）。
 * ダウンロードしたファイルは信頼できないデータとして扱い、JSON として読むだけで実行はしない。
 * 取得済みなら（空でなければ）スキップする。取り直したい場合は data/s12/ を削除してから実行する。
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const URL_ZIP = 'https://nlftp.mlit.go.jp/ksj/gml/data/S12/S12-25/S12-25_GML.zip';
const ENTRY = 'S12-25_GML/UTF-8/S12-25_NumberOfPassengers.geojson';
const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'data', 's12');
const OUT_FILE = join(OUT_DIR, 'S12-25_NumberOfPassengers.geojson');
const RETRIES = 3;

async function download(): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(URL_ZIP);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      lastError = new Error(`HTTP ${res.status} ${URL_ZIP}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastError;
}

async function main() {
  if (existsSync(OUT_FILE) && statSync(OUT_FILE).size > 0) {
    console.log(`取得済みのためスキップします: ${OUT_FILE}`);
    return;
  }
  console.log(`S12 駅別乗降客数データを取得します -> ${OUT_DIR}`);
  const zip = await download();
  console.log(`  ZIP: ${(zip.length / 1024 / 1024).toFixed(1)} MB`);
  const files = unzipSync(zip, { filter: (f) => f.name === ENTRY });
  const data = files[ENTRY];
  if (!data) throw new Error(`ZIP内に ${ENTRY} が見つかりません`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, data);
  console.log(`完了: ${OUT_FILE}（${(data.length / 1024 / 1024).toFixed(1)} MB）`);
  console.log('続けて npm run build:network で乗降客数入りの public/data/network.json を生成できます。');
}

main().catch((err) => {
  console.error('取得に失敗しました:', err);
  process.exit(1);
});
