import {test} from 'node:test';import assert from 'node:assert/strict';
import {ParkingAgUiBridge,validRoute} from './parking-operations';
import {dailyOccupancy,occupancyLine,reportCsv} from './parking-charts';

test('AG-UI validates lifecycle, unicode chunks and one controlled tool call',()=>{
 const frames:any[]=[];const bridge=new ParkingAgUiBridge(f=>frames.push(f));
 bridge.accept({type:'RUN_STARTED',threadId:'t',runId:'r',protocolVersion:'1.0'});
 bridge.accept({type:'TOOL_CALL_START',toolCallId:'action-0',toolCallName:'scene.poi'});
 bridge.accept({type:'TOOL_CALL_ARGS',toolCallId:'action-0',delta:'{"target":'});
 bridge.accept({type:'TOOL_CALL_ARGS',toolCallId:'action-0',delta:'"outpatient"}'});
 bridge.accept({type:'TOOL_CALL_END',toolCallId:'action-0'});
 bridge.accept({type:'TEXT_MESSAGE_START',messageId:'m',role:'assistant'});
 bridge.accept({type:'TEXT_MESSAGE_CONTENT',messageId:'m',delta:'门诊'});
 bridge.accept({type:'TEXT_MESSAGE_CONTENT',messageId:'m',delta:'路线'});
 bridge.accept({type:'TEXT_MESSAGE_END',messageId:'m'});
 bridge.accept({type:'RUN_FINISHED',threadId:'t',runId:'r'});
 assert.equal(bridge.complete,true);assert.equal(frames.find(f=>f.event==='action').data,'{"id":"action-0","type":"scene.poi","target":"outpatient"}');
 assert.equal(JSON.parse(frames.filter(f=>f.event==='answer').at(-1).data).text,'门诊路线');
 assert.throws(()=>bridge.accept({type:'CUSTOM',name:'parking.route',value:{}}),/结束/);
});
test('malformed or out-of-order AG-UI events and expanded tool arguments are rejected',()=>{
 const create=()=>{const b=new ParkingAgUiBridge(()=>{});b.accept({type:'RUN_STARTED',threadId:'t',runId:'r'});return b;};
 assert.throws(()=>new ParkingAgUiBridge(()=>{}).accept({type:'TEXT_MESSAGE_END',messageId:'m'}),/开始/);
 assert.throws(()=>create().accept({type:'INVENTED'}));
 const b=create();b.accept({type:'TOOL_CALL_START',toolCallId:'x',toolCallName:'scene.poi'});
 assert.throws(()=>b.accept({type:'TOOL_CALL_START',toolCallId:'x',toolCallName:'scene.poi'}),/标识/);
 b.accept({type:'TOOL_CALL_ARGS',toolCallId:'x',delta:'{"target":"A","code":"alert(1)"}'});
 assert.throws(()=>b.accept({type:'TOOL_CALL_END',toolCallId:'x'}),/参数/);
});
test('routes are finite bounded model paths, never arbitrary coordinates',()=>{
 const path={from:'entrance',to:'outpatient',label:'门诊',meters:123,version:1,points:[[0,-9],[0,4]],steps:['入口','门诊']};
 assert.ok(validRoute(path));assert.equal(validRoute({...path,points:[[Infinity,0]]}),false);assert.equal(validRoute({...path,points:[[90,0]]}),false);assert.equal(validRoute({...path,meters:-1}),false);
});
test('daily chart uses capacity-weighted occupancy and CSV includes every day',()=>{
 const occupancy=[{day:'2026-01-01',zone_id:'A',capacity:120,average_occupied:60},{day:'2026-01-01',zone_id:'B',capacity:80,average_occupied:80}];
 assert.equal(dailyOccupancy(occupancy)[0].rate,70);assert.ok(occupancyLine(occupancy).includes('27'));
 const many=Array.from({length:365},(_,i)=>({day:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),capacity:100,average_occupied:50}));
 const csv=reportCsv({occupancy:many,dailyLedger:[],source:'database-synthetic'});assert.equal(csv.trim().split('\n').length,366);assert.ok(csv.includes('database-synthetic'));
});
