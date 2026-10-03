import { SseFramer, type AgentSnapshot, type SseFrame } from '../core/parking-agent';

const TOKEN_KEY = 'cockpit-action-token';
// Same-origin production; localhost's dev proxy reaches the same existing cockpit API.
const API = '/smartCockpit/api';
export class ParkingAgentClient {
  authorized(): boolean {
    try {
      const token = sessionStorage.getItem(TOKEN_KEY);
      return !!token && Number(token.split('.')[0]) * 1000 > Date.now();
    } catch { return false; }
  }
  async verify(password: string): Promise<void> {
    const response = await fetch(`${API}/action-auth/verify`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const body = await response.json();
    if (!response.ok || typeof body.token !== 'string') throw new Error(body.message || '操作密码验证失败');
    sessionStorage.setItem(TOKEN_KEY, body.token);
  }
  async stream(message: string, model: string, context: AgentSnapshot,
    history: { role: string; content: string }[], signal: AbortSignal, onFrame: (frame: SseFrame) => void): Promise<void> {
    if (!this.authorized()) throw new Error('请先验证座舱操作密码');
    const response = await fetch(`${API}/parking-agent/stream`, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY)}` },
      body: JSON.stringify({ message, model, context, history: history.slice(-8).map(t => ({ ...t, content: t.content.slice(0, 1500) })) }) });
    if (response.status === 401) { sessionStorage.removeItem(TOKEN_KEY); throw new Error('操作验证已过期，请重新输入密码'); }
    if (!response.ok) throw new Error('座舱助手服务暂未连接，请稍后重试');
    if (!response.body) throw new Error('当前浏览器未提供流式响应');
    const reader = response.body.getReader(), decoder = new TextDecoder(), framer = new SseFramer();
    try {
      while (true) {
        const { value, done } = await reader.read();
        for (const frame of framer.push(done ? decoder.decode() : decoder.decode(value, { stream: true }), done)) {
          if (signal.aborted) return;
          onFrame(frame);
        }
        if (done) break;
      }
    } finally { reader.releaseLock(); }
  }
}
