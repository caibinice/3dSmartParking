import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readParkingStream, parkingConnectionMessage, parkingHttpError } from './parking-stream';
const wire=(events:unknown[])=>new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
const start={type:'RUN_STARTED',threadId:'t',runId:'r'},end={type:'RUN_FINISHED',threadId:'t',runId:'r'};

test('RUN_FINISHED stops reading before a later network error, heartbeat or hanging EOF',async()=>{
  const events:any[]=[];let reads=0,cancelled=false;
  const body={getReader:()=>({read:async()=>{reads++;if(reads===1)return{value:wire([start,{type:'TEXT_MESSAGE_START',messageId:'m',role:'assistant'},{type:'TEXT_MESSAGE_CONTENT',messageId:'m',delta:'推荐 A 区'},end,{type:'CUSTOM',name:'parking.heartbeat',value:{}}]),done:false};throw new TypeError('network error');},cancel:async()=>{cancelled=true;},releaseLock:()=>{}})} as unknown as ReadableStream<Uint8Array>;
  await readParkingStream(body,new AbortController().signal,f=>events.push(f));
  assert.equal(reads,1);assert.equal(cancelled,true);assert.equal(events.at(-1).event,'done');
});
test('premature EOF and broken transport do not masquerade as successful completion',async()=>{
  let text='';const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(wire([start,{type:'TEXT_MESSAGE_START',messageId:'m',role:'assistant'},{type:'TEXT_MESSAGE_CONTENT',messageId:'m',delta:'部分回答'}]));c.close();}});
  await assert.rejects(()=>readParkingStream(body,new AbortController().signal,f=>{if(f.event==='answer')text=JSON.parse(f.data).text;}),/提前结束/);
  assert.equal(text,'部分回答');
});
test('cancelled streams execute no further effects and server RUN_ERROR is preserved',async()=>{
  const controller=new AbortController();let calls=0;controller.abort();
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(wire([start,end]));}});
  await readParkingStream(body,controller.signal,()=>calls++);assert.equal(calls,0);
  const failed=new ReadableStream<Uint8Array>({start(c){c.enqueue(wire([start,{type:'RUN_ERROR',message:'道路暂时关闭',code:'PARKING_ROUTE_ERROR'}]));c.close();}});
  await assert.rejects(()=>readParkingStream(failed,new AbortController().signal,()=>{}),/道路暂时关闭/);
});
test('network, timeout, user cancellation and HTTP rate limits have distinct messages',async()=>{
  assert.match(parkingConnectionMessage(new TypeError('network error')),/网络连接中断/);
  assert.match(parkingConnectionMessage(new Error('x'),true,true),/110 秒/);
  assert.match(parkingConnectionMessage(new Error('x'),false,true),/已停止/);
  assert.match(await parkingHttpError(new Response('<html>limit</html>',{status:429})),/HTTP 429/);
  assert.match(await parkingHttpError(new Response('bad gateway',{status:502})),/网关/);
});
