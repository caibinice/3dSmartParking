import { ParkingAgUiBridge } from './parking-operations';
import { SseFramer, type SseFrame } from './parking-agent';

/** A successful RUN_FINISHED is the boundary, not the proxy's later TCP close. */
export async function readParkingStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, emit: (frame: SseFrame) => void) {
  const reader = body.getReader(), decoder = new TextDecoder(), framer = new SseFramer(), bridge = new ParkingAgUiBridge(emit);
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      for (const frame of framer.push(done ? decoder.decode() : decoder.decode(value, { stream: true }), done)) {
        if (signal.aborted) return;
        bridge.accept(JSON.parse(frame.data));
        if (bridge.complete) return; // Do not wait for EOF or accept a late heartbeat.
      }
      if (done) break;
    }
    if (!signal.aborted && !bridge.complete) throw new Error('助手连接提前结束，已显示的结果已保留；请重新提问。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function parkingConnectionMessage(error: unknown, timedOut = false, cancelled = false): string {
  if (timedOut) return '本次等待超过 110 秒，已停止后续场景操作。已显示的结果已保留，请稍后重试。';
  if (cancelled) return '本次请求已停止，后续场景操作已取消。';
  if (error instanceof TypeError || error instanceof Error && /network error|failed to fetch|load failed|networkerror/i.test(error.message))
    return '与助手的网络连接中断，已显示的结果已保留。请检查网络后重新提问；本次不会自动重复执行场景动作。';
  return error instanceof Error ? error.message : '助手连接中断，请重新提问。';
}

export async function parkingHttpError(response: Response): Promise<string> {
  const messages: Record<number, string> = {
    401: '业务会话已过期，请重新登录', 403: '当前账号没有所请求的业务权限',
    429: '请求较多，请稍候再试', 502: '助手服务网关暂时未完成响应，请稍后重试',
    503: '助手服务暂时繁忙，请稍后重试', 504: '网关等待助手响应超时，请稍后重试'
  };
  if (messages[response.status]) return `${messages[response.status]}（HTTP ${response.status}）`;
  const value = await response.json().catch(() => null);
  const detail = value && (value.message || value.detail);
  return typeof detail === 'string' ? detail.slice(0, 300) : `助手请求未完成（HTTP ${response.status}）`;
}
