import { Component, ElementRef, ViewChild, HostListener, OnDestroy, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ParkingAgentClient } from './parking-agent-client';
import { ParkingVoice, type VoiceState } from './parking-voice';
import { parseAgentAction, parseAgentReport, type AgentAction, type AgentSnapshot, type AgentReport, type ReportZone, type SseFrame } from '../core/parking-agent';
import type { Alarm, ParkingEvent } from '../core/parking-data';

interface ChatItem { role: 'user' | 'assistant'; text: string; provider?: string; actions: string[]; references: string[]; report?: AgentReport; }
export interface TourState { active: boolean; paused: boolean; index: number; title: string; narration: string; }
@Component({
  selector: 'app-parking-assistant', imports: [FormsModule],
  templateUrl: './parking-assistant.component.html', styleUrl: './parking-assistant.component.scss'
})
export class ParkingAssistantComponent implements OnDestroy {
  readonly context = input.required<() => AgentSnapshot>();
  readonly execute = input.required<(action: AgentAction) => string>();
  readonly mobile = input(false);
  readonly tour = input<TourState>({ active: false, paused: false, index: 0, title: '', narration: '' });
  readonly opened = output<void>();
  @ViewChild('messages') messages?: ElementRef<HTMLElement>;
  readonly visible = signal(false);
  readonly busy = signal(false);
  readonly authenticating = signal(false);
  readonly authorized = signal(false);
  readonly notice = signal('');
  readonly phase = signal('');
  readonly voiceState = signal<VoiceState>({ armed: false, listening: false, speaking: false, hint: '' });
  readonly items = signal<ChatItem[]>([]);
  readonly client = new ParkingAgentClient();
  readonly voice = new ParkingVoice(state => this.voiceState.set(state), text => { this.draft = text; void this.send(); }, () => this.show());
  draft = ''; password = ''; model = 'deepseek-v4-flash'; autoSpeak = true;
  private abort?: AbortController;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private current = -1;
  private actionIds = new Set<string>();
  private expectedActions = new Map<string, string>();
  private disposed = false;
  constructor() { this.authorized.set(this.client.authorized()); }
  show() { this.visible.set(true); this.authorized.set(this.client.authorized()); this.opened.emit(); }
  hide() { this.visible.set(false); if (this.busy()) this.cancel(); }
  toggle() { if (this.visible()) this.hide(); else this.show(); }
  async verify() {
    if (this.authenticating() || !this.password) return;
    this.authenticating.set(true); this.notice.set('');
    try { await this.client.verify(this.password); this.authorized.set(true); }
    catch (error) { this.notice.set(error instanceof Error ? error.message : '操作验证失败'); }
    finally { this.password = ''; this.authenticating.set(false); }
  }
  async send(text = this.draft) {
    if (this.busy() || !text.trim() || this.disposed) return;
    this.show();
    if (!this.client.authorized()) { this.authorized.set(false); this.notice.set('请先验证智能座舱操作密码；业务请求已保留在输入框。'); this.voice.stop(); return; }
    const question = text.trim().slice(0, 2000);
    const history = this.items().filter(t => t.text.trim()).map(t => ({ role: t.role, content: t.text }));
    this.items.update(items => [...items.slice(-14), { role: 'user', text: question, actions: [], references: [] }, { role: 'assistant', text: '', actions: [], references: [] }]);
    this.current = this.items().length - 1; this.draft = ''; this.notice.set(''); this.phase.set('正在连接企业智能座舱…');
    this.busy.set(true); this.actionIds.clear(); this.expectedActions.clear(); this.voice.cancelSpeech(); this.voice.pause();
    const controller = this.abort = new AbortController();
    this.expiryTimer = setTimeout(() => controller.abort(), 110000);
    try {
      await this.client.stream(question, this.model, this.context()(), history, controller.signal, frame => this.onFrame(frame));
      const item = this.items()[this.current];
      if (!controller.signal.aborted && !item.text.trim()) this.updateCurrent({ text: '服务已结束响应，没有生成有效回答，请重试。' });
      if (!controller.signal.aborted && this.autoSpeak && item.text.trim() && !this.tour().active) this.voice.speak(item.text);
    } catch (error) {
      this.updateCurrent({ text: controller.signal.aborted ? '本次请求已停止，后续场景操作已取消。'
        : error instanceof Error ? error.message : '助手连接中断，请重试。' });
      this.authorized.set(this.client.authorized());
    } finally {
      clearTimeout(this.expiryTimer); this.busy.set(false); this.phase.set(''); this.abort = undefined;
      if (!this.voiceState().speaking) this.voice.resume();
    }
  }
  private onFrame(frame: SseFrame) {
    if (this.abort?.signal.aborted || this.disposed) return;
    if (frame.event === 'heartbeat' || frame.event === 'done') return;
    if (frame.event === 'error') { this.updateCurrent({ text: frame.data }); return; }
    let value: any;
    try { value = JSON.parse(frame.data); } catch { this.notice.set('收到未识别的助手事件，已跳过。'); return; }
    if (frame.event === 'meta') this.phase.set(String(value.phase || '正在分析业务请求…'));
    if (frame.event === 'plan') {
      this.updateCurrent({ provider: String(value.provider || '') });
      if (Array.isArray(value.actions) && value.actions.length <= 4) {
        const actions = value.actions.map((a: unknown, i: number) => parseAgentAction({ ...(a as object), id: `action-${i}` }));
        if (actions.every((a: AgentAction | null) => !!a)) actions.forEach((a: AgentAction) => this.expectedActions.set(a.id, `${a.type}:${a.target}`));
      }
      this.phase.set('正在执行受控场景工具…');
    }
    if (frame.event === 'action') {
      const action = parseAgentAction(value);
      if (!action || this.actionIds.has(action.id) || this.actionIds.size >= 4 || this.expectedActions.get(action.id) !== `${action.type}:${action.target}`) {
        this.notice.set('未通过校验的场景指令已跳过。'); return;
      }
      this.actionIds.add(action.id);
      const result = this.execute()(action);
      this.items.update(items => items.map((item, i) => i === this.current ? { ...item, actions: [...item.actions, result] } : item));
    }
    if (frame.event === 'report') { const report = parseAgentReport(value); if (report) this.updateCurrent({ report }); else this.notice.set('报表格式校验未通过。'); }
    if (frame.event === 'references' && Array.isArray(value)) this.updateCurrent({ references: value.slice(0, 4).map(r => String(r.title).slice(0, 200)) });
    if (frame.event === 'answer' && typeof value.text === 'string') this.updateCurrent({ text: value.text.slice(0, 6000) });
    this.scroll();
  }
  private updateCurrent(patch: Partial<ChatItem>) { this.items.update(items => items.map((item, i) => i === this.current ? { ...item, ...patch } : item)); this.scroll(); }
  private scroll() { requestAnimationFrame(() => {
    const list = this.messages?.nativeElement;if(!list)return;
    if(this.items()[this.current]?.report){
      const cards=list.querySelectorAll<HTMLElement>('.report-card'),card=cards.item(cards.length-1);
      if(card){list.scrollTop+=card.getBoundingClientRect().top-list.getBoundingClientRect().top-8;return;}
    }
    list.scrollTop=list.scrollHeight;
  }); }
  cancel() { this.abort?.abort(); this.voice.cancelSpeech(); }
  clear() { if (this.busy()) this.cancel(); this.items.set([]); this.notice.set(''); this.current = -1; }
  pushToTalk() { this.show(); if (!this.authorized()) { this.notice.set('验证操作密码后可使用语音请求。'); return; } if (this.voiceState().listening) this.voice.stop(); else this.voice.start(false); }
  toggleWake() { if (this.voiceState().armed) this.voice.stop(); else if (!this.client.authorized()) { this.show(); this.notice.set('验证操作密码后可开启语音唤醒。'); } else this.voice.start(true); }
  stopSpeaking() { this.voice.cancelSpeech(); this.voice.resume(); }
  speak(text: string) { this.voice.speak(text); }
  narrate(text: string) { if (this.autoSpeak) this.voice.speak(text); }
  tourControl(type: 'tour.pause' | 'tour.resume' | 'tour.stop') { this.notice.set(this.execute()({ id: 'user-tour-control', type, target: 'campus' })); }
  focus(id: string) { this.notice.set(this.execute()({ id: 'user-report-focus', type: 'scene.focus', target: id })); }
  refreshReport(kind: string) { void this.send(kind === 'events' ? '查看出入记录' : kind === 'alerts' ? '查看运行告警' : kind === 'recommendation' ? '推荐停车区' : '查看停车报表'); }
  occupancy(report: AgentReport) { return report.data as { zones: ReportZone[]; capacity: number; occupied: number; free: number; rate: number }; }
  recommendation(report: AgentReport) { return report.data as ReportZone; }
  records(report: AgentReport) { return report.data as Omit<ParkingEvent, 'id'>[]; }
  alarms(report: AgentReport) { return report.data as Alarm[]; }
  time(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour12: false }); }
  provider(value?: string) { return !value ? '正在规划' : value === 'deterministic-command' ? '场景快捷指令' : value.startsWith('local-guide') ? '本地知识指南' : 'DeepSeek · Thinking max'; }
  @HostListener('document:visibilitychange') onVisibility() { if (document.hidden) { this.voice.stop(); this.voice.cancelSpeech(); this.cancel(); if (this.tour().active && !this.tour().paused) this.tourControl('tour.pause'); } }
  @HostListener('document:keydown.escape') onEscape() { this.hide(); this.voice.stop(); this.voice.cancelSpeech(); }
  ngOnDestroy() { this.disposed = true; this.cancel(); clearTimeout(this.expiryTimer); this.voice.dispose(); }
}
