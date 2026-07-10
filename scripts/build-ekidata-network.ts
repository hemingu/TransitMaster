/**
 * network.json 生成 CLI。
 *
 * 通常時: data/ekidata/ から駅データ.jp無料版CSV（company*.csv/line*.csv/station*.csv/join*.csv）
 * をプレフィックスで探して読み込み、data/n02/ に N02（国土数値情報 鉄道）GeoJSONがあれば
 * 新幹線補完データとして併せて読み込む。
 *
 * --fixture: tests/fixtures/miniEkidata.ts のミニ入力でビルドする（動作確認・CI用）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildEkidataNetwork,
  type EkidataInput,
  type N02Input,
  type N02FeatureCollection,
} from './buildEkidataNetwork.ts';
import { parseCsv } from './csv.ts';
import { miniEkidataInput, miniN02 } from '../tests/fixtures/miniEkidata.ts';

const ROOT = resolve(import.meta.dirname, '..');
const EKIDATA_DIR = join(ROOT, 'data', 'ekidata');
const N02_DIR = join(ROOT, 'data', 'n02');
const OUTPUT_PATH = join(ROOT, 'public', 'data', 'network.json');

/** data/ekidata/ 内でプレフィックスに一致する最初のCSVファイルを探して読む（UTF-8）。 */
function findAndReadCsv(prefix: string): Record<string, string>[] | null {
  if (!existsSync(EKIDATA_DIR)) return null;
  const file = readdirSync(EKIDATA_DIR).find(
    (f) => f.toLowerCase().startsWith(prefix.toLowerCase()) && f.toLowerCase().endsWith('.csv')
  );
  if (!file) return null;
  const text = readFileSync(join(EKIDATA_DIR, file), 'utf-8');
  return parseCsv(text);
}

function loadEkidataInput(): EkidataInput | null {
  const companies = findAndReadCsv('company');
  const lines = findAndReadCsv('line');
  const stations = findAndReadCsv('station');
  const joins = findAndReadCsv('join');
  if (!companies || !lines || !stations || !joins) {
    return null;
  }
  return { companies, lines, stations, joins };
}

function loadN02Input(): N02Input | null {
  const stationPath = join(N02_DIR, 'N02-25_Station.geojson');
  const sectionPath = join(N02_DIR, 'N02-25_RailroadSection.geojson');
  if (!existsSync(stationPath) || !existsSync(sectionPath)) {
    console.warn(
      `N02データが見つかりません（${N02_DIR}）。新幹線補完なしでビルドします（npm run fetch:n02 で取得できます）。`
    );
    return null;
  }
  const stations = JSON.parse(readFileSync(stationPath, 'utf-8')) as N02FeatureCollection;
  const sections = JSON.parse(readFileSync(sectionPath, 'utf-8')) as N02FeatureCollection;
  return { stations, sections };
}

function main() {
  const useFixture = process.argv.includes('--fixture');

  let input: EkidataInput;
  let n02: N02Input | null;

  if (useFixture) {
    console.log('--fixture フラグが指定されたため、tests/fixtures のミニ駅データ.jp入力を使用します。');
    input = miniEkidataInput();
    n02 = miniN02();
  } else {
    const loaded = loadEkidataInput();
    if (!loaded) {
      console.error(
        `data/ekidata/ に駅データ.jpのCSV（company*.csv, line*.csv, station*.csv, join*.csv）が見つかりませんでした（${EKIDATA_DIR}）。\n` +
          '駅データ.jp（https://ekidata.jp/）から無料版CSVをダウンロードして data/ekidata/ に配置してください。'
      );
      process.exit(1);
    }
    input = loaded;
    n02 = loadN02Input();
  }

  const { network, log } = buildEkidataNetwork(input, n02);

  mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(network));

  console.log(`network.json を生成しました: ${OUTPUT_PATH}`);
  console.log(`  駅数: ${network.stations.length}`);
  console.log(`  路線数: ${network.lines.length}`);
  console.log('');
  console.log('ビルドログ:');
  if (log.length === 0) {
    console.log('  (なし)');
  } else {
    for (const line of log) {
      console.log(`  - ${line}`);
    }
  }
}

main();
