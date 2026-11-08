/**
 * network.json 生成 CLI。
 *
 * 通常時: data/mt3d/（npm run fetch:mt3d で取得）の Mini Tokyo 3D データから生成する。
 * --src <dir>: MT3D の data ディレクトリを別の場所から読む（既定は data/mt3d/）。
 * --fixture: tests/fixtures/miniMt3d.ts のミニ入力でビルドする（動作確認・CI用）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildMt3dNetwork, type Mt3dInput, type Mt3dTrain } from './buildMt3dNetwork.ts';
import { miniMt3dInput } from '../tests/fixtures/miniMt3d.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_PATH = join(ROOT, 'public', 'data', 'network.json');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadInput(dir: string): Mt3dInput {
  const need = ['railways.json', 'stations.json', 'station-groups.json', 'train-types.json'];
  for (const f of need) {
    if (!existsSync(join(dir, f))) {
      console.error(`${join(dir, f)} が見つかりません。npm run fetch:mt3d でMT3Dデータを取得してください。`);
      process.exit(1);
    }
  }
  const ttDir = join(dir, 'train-timetables');
  if (!existsSync(ttDir)) {
    console.error(`${ttDir} が見つかりません。npm run fetch:mt3d でMT3Dデータを取得してください。`);
    process.exit(1);
  }
  const trains: Mt3dTrain[] = [];
  for (const f of readdirSync(ttDir).filter((x) => x.endsWith('.json')).sort()) {
    for (const t of readJson<Mt3dTrain[]>(join(ttDir, f))) trains.push(t);
  }
  return {
    railways: readJson(join(dir, 'railways.json')),
    stations: readJson(join(dir, 'stations.json')),
    stationGroups: readJson(join(dir, 'station-groups.json')),
    trainTypes: readJson(join(dir, 'train-types.json')),
    overrides: readJson(join(ROOT, 'data', 'transfer-group-overrides.json')),
    trains,
  };
}

function main() {
  const args = process.argv.slice(2);
  const useFixture = args.includes('--fixture');
  const srcIdx = args.indexOf('--src');
  const srcDir = srcIdx >= 0 && args[srcIdx + 1] ? resolve(args[srcIdx + 1]) : join(ROOT, 'data', 'mt3d');

  let input: Mt3dInput;
  if (useFixture) {
    console.log('--fixture フラグが指定されたため、tests/fixtures のミニMT3D入力を使用します。');
    input = miniMt3dInput();
  } else {
    input = loadInput(srcDir);
  }

  const { network, log } = buildMt3dNetwork(input);

  mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
  const json = JSON.stringify(network);
  writeFileSync(OUTPUT_PATH, json);

  console.log(`network.json を生成しました: ${OUTPUT_PATH}（${(json.length / 1024).toFixed(0)} KB）`);
  console.log(`  駅レコード数: ${network.stations.length}`);
  console.log(`  路線数: ${network.lines.length}`);
  console.log(`  パターン数: ${network.patterns.length}`);
  console.log('');
  console.log('ビルドログ:');
  for (const line of log) console.log(`  - ${line}`);
}

main();
