/// <reference lib="webworker" />
import { getNetworkIndex } from '../lib/networkIndex.ts';
import { searchRoute } from '../lib/raptor.ts';
import type { AnswerMode, Itinerary, Network } from '../lib/types.ts';

/**
 * routing.worker: UIスレッドから Network を一度だけ受け取り（init）、
 * 以後は探索リクエスト（search）を受けて searchRoute を実行し結果を返す。
 * 時刻の概念は廃止（駅間所要秒ベース）のため、search メッセージに departSec は含まない。
 *
 * メッセージプロトコル:
 * - 受信 { type: 'init', network: Network }
 * - 受信 { type: 'search', requestId: number, from: number, to: number, mode: AnswerMode, excludeShinkansen?: boolean }
 * - 送信 { type: 'result', requestId: number, itinerary: Itinerary | null }
 * - 送信 { type: 'error', requestId?: number, message: string }
 */

export interface WorkerInitMessage {
  type: 'init';
  network: Network;
}

export interface WorkerSearchMessage {
  type: 'search';
  requestId: number;
  from: number;
  to: number;
  mode: AnswerMode;
  /** true のとき新幹線（lineType===1）を探索から除外する（「日本全国」以外のエリア用）。 */
  excludeShinkansen?: boolean;
}

export type WorkerRequestMessage = WorkerInitMessage | WorkerSearchMessage;

export interface WorkerResultMessage {
  type: 'result';
  requestId: number;
  itinerary: Itinerary | null;
}

export interface WorkerErrorMessage {
  type: 'error';
  requestId?: number;
  message: string;
}

export type WorkerResponseMessage = WorkerResultMessage | WorkerErrorMessage;

let network: Network | null = null;

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const data = event.data;

  if (data.type === 'init') {
    network = data.network;
    // 探索リクエストの初回レイテンシを避けるため、init時点でインデックスを先行構築しておく。
    getNetworkIndex(network);
    return;
  }

  if (data.type === 'search') {
    if (!network) {
      const errorMsg: WorkerErrorMessage = {
        type: 'error',
        requestId: data.requestId,
        message: 'network が初期化されていません',
      };
      self.postMessage(errorMsg);
      return;
    }
    try {
      const itinerary = searchRoute(network, data.from, data.to, data.mode, {
        excludeShinkansen: data.excludeShinkansen === true,
      });
      const resultMsg: WorkerResultMessage = {
        type: 'result',
        requestId: data.requestId,
        itinerary,
      };
      self.postMessage(resultMsg);
    } catch (err) {
      const errorMsg: WorkerErrorMessage = {
        type: 'error',
        requestId: data.requestId,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(errorMsg);
    }
  }
};
