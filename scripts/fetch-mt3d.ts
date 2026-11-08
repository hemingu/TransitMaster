/**
 * Mini Tokyo 3D (https://github.com/nagix/mini-tokyo-3d, MIT License) のデータを
 * 固定コミットから data/mt3d/ にダウンロードする。
 *
 * 取得対象: railways.json / stations.json / station-groups.json / train-types.json /
 *           train-timetables/*.json（約105MB）
 * 既に取得済みの（空でない）ファイルはスキップするので、中断しても再実行で続きから取得できる。
 * 強制的に取り直したい場合は data/mt3d/ を削除してから実行する。
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 再現性のため固定するコミット。 */
const COMMIT = 'fa7833f18a288aeca171b68892bb7f67e229e4ca';
const REPO = 'nagix/mini-tokyo-3d';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/data`;
const API_BASE = `https://api.github.com/repos/${REPO}/contents/data`;

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'data', 'mt3d');
const TOP_FILES = ['railways.json', 'stations.json', 'station-groups.json', 'train-types.json'];
const CONCURRENCY = 8;
const RETRIES = 3;

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastError;
}

/** train-timetables ディレクトリのファイル名一覧を GitHub API（固定コミット）から取得する。 */
async function listTimetableFiles(): Promise<string[]> {
  const res = await fetchWithRetry(`${API_BASE}/train-timetables?ref=${COMMIT}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'transitmaster-fetch-mt3d' },
  });
  const entries = (await res.json()) as { name: string; type: string }[];
  return entries.filter((e) => e.type === 'file' && e.name.endsWith('.json')).map((e) => e.name);
}

async function download(relPath: string): Promise<'downloaded' | 'skipped'> {
  const dest = join(OUT_DIR, relPath);
  if (existsSync(dest) && statSync(dest).size > 0) return 'skipped';
  const res = await fetchWithRetry(`${RAW_BASE}/${relPath}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return 'downloaded';
}

async function main() {
  console.log(`Mini Tokyo 3D @ ${COMMIT.slice(0, 7)} のデータを取得します -> ${OUT_DIR}`);
  const timetables = await listTimetableFiles();
  console.log(`列車時刻表ファイル: ${timetables.length} 件`);
  const queue = [...TOP_FILES, ...timetables.map((n) => `train-timetables/${n}`)];

  let done = 0;
  let downloaded = 0;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      if ((await download(next)) === 'downloaded') downloaded++;
      done++;
      if (done % 20 === 0) console.log(`  ${done} 件処理`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`完了: ${done} 件（新規ダウンロード ${downloaded} 件）`);
  console.log('続けて npm run build:network で public/data/network.json を生成できます。');
}

main().catch((err) => {
  console.error('取得に失敗しました:', err);
  process.exit(1);
});
