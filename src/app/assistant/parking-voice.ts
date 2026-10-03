import { wakeCommand } from '../core/parking-agent';

interface RecognitionResult { isFinal: boolean; [index: number]: { transcript: string }; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionConstructor = new () => Recognition;
export interface VoiceState { armed: boolean; listening: boolean; speaking: boolean; hint: string; conversation?:boolean; }

/** User-armed browser voice, no mock ASR and no always-on microphone by default. */
export class ParkingVoice {
  private recognition?: Recognition;
  private readonly constructorApi = (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition;
  readonly supported = !!this.constructorApi;
  readonly ttsSupported = 'speechSynthesis' in window;
  private state: VoiceState = { armed: false, listening: false, speaking: false, hint: '' };
  private mode: 'once' | 'wake' | 'conversation' | null = null;
  private spokenText='';
  private waiting = false;
  private suspended = false;
  private restarts = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private speechTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private speechGeneration = 0;
  constructor(private onState: (state: VoiceState) => void, private onCommand: (text: string) => void, private onWake: () => void) {}
  private update(patch: Partial<VoiceState>) { this.state = { ...this.state, ...patch }; this.onState({ ...this.state }); }
  start(wake: boolean, conversation=false) {
    this.stop(); this.cancelSpeech();
    if (!this.constructorApi) { this.update({ hint: '当前浏览器没有语音识别API，可用文字与按钮；回答仍可播报。' }); return; }
    this.mode = conversation ? 'conversation' : wake ? 'wake' : 'once'; this.suspended = false; this.waiting = false; this.restarts = 0;
    this.update({ armed: wake, conversation, hint: conversation?'连续对话已开启；播报中说“停车助手”可打断，离开页面自动关闭。':wake ? '监听已开启：说“你好停车助手”，再说请求' : '请说一句业务请求…' });
    this.listen();
  }
  private listen() {
    if (this.destroyed || this.suspended || !this.mode || document.hidden || !this.constructorApi) return;
    const recognition = this.recognition = new this.constructorApi();
    recognition.lang = 'zh-CN'; recognition.continuous = this.mode !== 'once'; recognition.interimResults = this.mode==='conversation';
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim(); if (!text) continue;
        const parsed = wakeCommand(text);
        if(this.mode==='conversation'&&this.state.speaking){
          const normalize=(value:string)=>value.replace(/[\s，。！？,.!?]/g,'');
          if(this.spokenText&&normalize(this.spokenText).includes(normalize(text)))continue;
          if(!parsed.woke && !text.includes('停止播报'))continue;
          this.cancelSpeech();this.onWake();this.waiting=true;
          if(text.includes('停止播报')&&!parsed.woke){this.update({hint:'播报已停止，可以继续说话。'});continue;}
        }
        if(!result.isFinal)continue;
        this.restarts = 0;
        if (this.mode === 'once') { this.stop(); this.onWake(); this.onCommand(text); return; }
        if (parsed.woke) { this.waiting = true; this.onWake(); this.update({ hint: '已唤醒，请说业务请求…' }); }
        const command = parsed.woke ? parsed.command : this.waiting || this.mode==='conversation' ? text : '';
        if (command) { this.waiting = false; if(this.mode!=='conversation')this.pause(); this.onCommand(command); return; }
      }
    };
    recognition.onerror = event => {
      if (event.error === 'aborted' && (this.suspended || !this.mode)) return;
      const hint = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? '麦克风权限未开启，请在浏览器站点设置中开启后重试。'
        : event.error === 'no-speech' ? '暂未听到声音，请再次点击语音按钮。'
        : '浏览器语音识别服务连接中断，可继续输入文字。';
      this.stop(); this.update({ hint });
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = undefined; this.update({ listening: false });
      if ((this.mode === 'wake'||this.mode==='conversation') && !this.suspended && ++this.restarts <= 3 && !document.hidden)
        this.restartTimer = setTimeout(() => this.listen(), 500);
      else if (!this.suspended && this.mode) { this.stop(); this.update({ hint: '监听已结束，点击语音唤醒重新开启。' }); }
    };
    try { recognition.start(); this.update({ listening: true }); }
    catch { this.stop(); this.update({ hint: '语音识别尚未就绪，请重试或输入文字。' }); }
  }
  pause() {
    this.suspended = true; clearTimeout(this.restartTimer);
    const recognition = this.recognition; this.recognition = undefined;
    recognition?.abort(); this.update({ listening: false });
  }
  pauseForRequest(){if(this.mode!=='conversation')this.pause();}
  resume() { if ((this.mode === 'wake'||this.mode==='conversation') && !this.destroyed && !document.hidden && !this.recognition) { this.suspended = false; this.listen(); } }
  stop() { this.mode = null; this.waiting = false; this.pause(); this.update({ armed: false, conversation:false, hint: '语音监听已关闭' }); }
  speak(text: string) {
    if (!this.ttsSupported || !text.trim() || this.destroyed) return;
    this.cancelSpeech(); if(this.mode!=='conversation')this.pause();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\[\d+\]/g, '').slice(0, 1500));
    utterance.lang = 'zh-CN'; utterance.rate = 1;
    this.spokenText=utterance.text;
    utterance.voice = speechSynthesis.getVoices().find(v => /^zh/i.test(v.lang)) ?? null;
    const generation = this.speechGeneration;
    const finish = () => { if (generation !== this.speechGeneration) return; clearTimeout(this.speechTimer); this.spokenText='';this.update({ speaking: false }); this.resume(); };
    utterance.onend = finish; utterance.onerror = finish;
    this.update({ speaking: true }); speechSynthesis.speak(utterance);
    this.speechTimer = setTimeout(() => { this.cancelSpeech(); this.resume(); }, 90000);
  }
  cancelSpeech() { this.speechGeneration++; this.spokenText='';clearTimeout(this.speechTimer); if (this.ttsSupported) speechSynthesis.cancel(); this.update({ speaking: false }); }
  dispose() { this.destroyed = true; this.stop(); this.cancelSpeech(); }
}
