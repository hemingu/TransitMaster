import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { buildNetwork, type GtfsFeed } from './buildNetwork.ts';
import { miniGtfsFeeds } from '../tests/fixtures/miniGtfs.ts';

const ROOT = resolve(import.meta.dirname, '..');
const GTFS_DIR = join(ROOT, 'data', 'gtfs');
const OUTPUT_PATH = join(ROOT, 'public', 'data', 'network.json');

function loadZipFeeds(): GtfsFeed[] {
  if (!existsSync(GTFS_DIR)) return [];
  const zipFiles = readdirSync(GTFS_DIR).filter((f) => f.toLowerCase().endsWith('.zip'));
  const feeds: GtfsFeed[] = [];
  for (const zipFile of zipFiles) {
    const feedName = zipFile.replace(/\.zip$/i, '');
    const buf = readFileSync(join(GTFS_DIR, zipFile));
    const unzipped = unzipSync(new Uint8Array(buf));
    const files = new Map<string, string>();
    for (const [name, data] of Object.entries(unzipped)) {
      // zip内がサブディレクトリを含む場合にも対応してベース名で登録
      const baseName = name.split('/').pop() ?? name;
      files.set(baseName, Buffer.from(data).toString('utf-8'));
    }
    feeds.push({ name: feedName, files });
  }
  return feeds;
}

function main() {
  const useFixture = process.argv.includes('--fixture');

  let feeds: GtfsFeed[];
  if (useFixture) {
    console.log('--fixture フラグが指定されたため、tests/fixtures のミニGTFSフィードを使用します。');
    feeds = miniGtfsFeeds();
  } else {
    feeds = loadZipFeeds();
    if (feeds.length === 0) {
      console.log(
        `data/gtfs に zip ファイルが見つかりませんでした（${GTFS_DIR}）。tests/fixtures のミニフィードで生成します。`
      );
      feeds = miniGtfsFeeds();
    }
  }

  const { network, transferGroupLog } = buildNetwork(feeds);

  mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(network));

  console.log(`network.json を生成しました: ${OUTPUT_PATH}`);
  console.log(`  駅数: ${network.stations.length}`);
  console.log(`  路線数: ${network.lines.length}`);
  console.log(`  フィード数: ${network.feeds.length}`);
  console.log('');
  console.log('乗換グループ一覧（2駅以上）:');
  if (transferGroupLog.length === 0) {
    console.log('  (なし)');
  } else {
    for (const line of transferGroupLog) {
      console.log(`  - ${line}`);
    }
  }
}

main();
