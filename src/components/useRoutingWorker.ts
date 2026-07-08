import { useEffect, useRef } from 'react';
import type { AnswerMode, Itinerary, Network } from '../lib/types.ts';
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
} from '../worker/routing.worker.ts';

/**
 * routing.worker.ts をラップし、network を一度だけ渡した上で
 * searchRoute リクエストを Promise ベースで呼び出せるようにするフック。
 */
export function useRoutingWorker(network: Network | null) {
  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  const pending = useRef(new Map<number, (itinerary: Itinerary | null) => void>());

  useEffect(() => {
    if (!network) return;

    const worker = new Worker(new URL('../worker/routing.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const data = event.data;
      if (data.type === 'result') {
        const resolve = pending.current.get(data.requestId);
        if (resolve) {
          resolve(data.itinerary);
          pending.current.delete(data.requestId);
        }
      } else if (data.type === 'error') {
        if (data.requestId !== undefined) {
          const resolve = pending.current.get(data.requestId);
          if (resolve) {
            resolve(null);
            pending.current.delete(data.requestId);
          }
        }
        // eslint-disable-next-line no-console
        console.error('routing worker error:', data.message);
      }
    };

    const initMsg: WorkerRequestMessage = { type: 'init', network };
    worker.postMessage(initMsg);

    const pendingMap = pending.current;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingMap.clear();
    };
  }, [network]);

  const search = (
    from: number,
    to: number,
    departSec: number,
    mode: AnswerMode
  ): Promise<Itinerary | null> => {
    return new Promise((resolve) => {
      const worker = workerRef.current;
      if (!worker) {
        resolve(null);
        return;
      }
      const requestId = nextRequestId.current++;
      pending.current.set(requestId, resolve);
      const msg: WorkerRequestMessage = {
        type: 'search',
        requestId,
        from,
        to,
        departSec,
        mode,
      };
      worker.postMessage(msg);
    });
  };

  return { search };
}
