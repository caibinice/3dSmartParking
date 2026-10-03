import {test} from 'node:test';import assert from 'node:assert/strict';

class FakeRecognition{
 static instances:FakeRecognition[]=[];lang='';continuous=false;interimResults=false;onresult:any;onend:any;onerror:any;aborted=false;
 constructor(){FakeRecognition.instances.push(this);}start(){}stop(){}abort(){this.aborted=true;this.onend?.();}
 result(text:string,final=true){this.onresult?.({resultIndex:0,results:[{isFinal:final,0:{transcript:text}}]});}
}
const states:any[]=[];const commands:string[]=[];const spoken:any[]=[];
(globalThis as any).window={SpeechRecognition:FakeRecognition,speechSynthesis:{}};
(globalThis as any).document={hidden:false};
(globalThis as any).speechSynthesis={cancel(){},getVoices(){return[];},speak(u:any){spoken.push(u);}};
(globalThis as any).SpeechSynthesisUtterance=class{lang='';rate=1;voice:any;onend:any;onerror:any;constructor(public text:string){}};
const {ParkingVoice}=await import('../assistant/parking-voice');

test('continuous voice listens during request/TTS and explicit wake interrupts without echo commands',()=>{
 states.length=0;commands.length=0;const voice=new ParkingVoice(s=>states.push(s),q=>commands.push(q),()=>{});
 voice.start(true,true);const r=FakeRecognition.instances.at(-1)!;assert.equal(r.continuous,true);assert.equal(r.interimResults,true);
 voice.pauseForRequest();assert.equal(r.aborted,false);r.result('查看停车报表');assert.deepEqual(commands,['查看停车报表']);
 voice.speak('这是门诊停车区，可以查看停车报表。');r.result('这是门诊停车区');r.result('无关背景话语');assert.equal(commands.length,1);
 r.result('停车助手，定位急诊停车区',false);assert.equal(states.at(-1).speaking,false);
 r.result('停车助手，定位急诊停车区');assert.equal(commands.at(-1),'定位急诊停车区');
 voice.dispose();assert.equal(r.aborted,true);assert.equal(states.at(-1).armed,false);assert.equal(states.at(-1).conversation,false);
});
test('wake mode pauses while processing, once mode releases microphone after final text',()=>{
 const voice=new ParkingVoice(()=>{},q=>commands.push(q),()=>{});voice.start(true);const wake=FakeRecognition.instances.at(-1)!;
 wake.result('无关背景话语');assert.equal(wake.aborted,false);wake.result('停车助手，查看停车报表');assert.equal(wake.aborted,true);
 voice.start(false);const once=FakeRecognition.instances.at(-1)!;once.result('返回全景');assert.equal(once.aborted,true);voice.dispose();
});
