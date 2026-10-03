import { EventSchema } from '@ag-ui/core/schemas';
import type { Event } from '@ag-ui/core';
import type { AgentActionType, SseFrame } from './parking-agent';

export interface ParkingPoi { id: string; label: string; kind: string; zone: string | null; x: number; z: number; accessible: boolean; charging: boolean; closed: boolean; }
export interface ParkingRoute { from: string; to: string; label: string; meters: number; version: number; points: [number, number][]; steps: string[]; }
export interface ParkingCatalog { role: string; username: string; tools: Record<string, string[]>; graph: { version: number; nodes: ParkingPoi[]; edges: { from: string; to: string; closed: boolean }[] }; tours: Record<string,string[]>; dataset: { startDate: string; endDate: string; rows: Record<string,number>; sourceUrl: string; feePolicy: string }; vision: boolean; }
export interface ParkingDatabaseSnapshot { source: 'database-synthetic'; sampledAt: string; zones: {id:'A'|'B'|'C'; name:string; capacity:number; occupied:number}[]; events: {time:string;plate:string;zone:'A'|'B'|'C';action:'入场'|'离场'}[]; alerts: {id:number;zone:'A'|'B'|'C';title:string;level:'高'|'中'|'低';status:string}[]; }
export function validRoute(input: unknown): input is ParkingRoute {
  const r = input as ParkingRoute;
  return !!r && typeof r.to === 'string' && typeof r.label === 'string' && r.label.length < 100 && Number.isFinite(r.meters) && r.meters >= 0 && r.meters < 20000
    && Array.isArray(r.points) && r.points.length > 0 && r.points.length <= 40 && r.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 40));
}
/** Standard event validation; application effects stay behind the local tool whitelist. */
export class ParkingAgUiBridge {
  private started=false; private finished=false; private messages=new Map<string,string>();
  private calls=new Map<string,{type:string;args:string;ended:boolean}>();
  constructor(private emit:(frame:SseFrame)=>void){}
  get complete(){return this.finished;}
  accept(value:unknown): Event {
    const event=EventSchema.parse(value);const send=(name:string,data:unknown)=>this.emit({event:name,data:typeof data==='string'?data:JSON.stringify(data)});
    if(event.type==='RUN_STARTED'){if(this.started)throw new Error('重复的智能体运行事件');this.started=true;}
    else if(!this.started)throw new Error('缺少智能体运行开始事件');
    if(this.finished)throw new Error('已结束运行中收到额外事件');
    if(event.type==='CUSTOM'&&event.name.startsWith('parking.'))send(event.name.slice(8),event.value);
    if(event.type==='STATE_SNAPSHOT')send('state',event.snapshot);
    if(event.type==='TOOL_CALL_START'){
      if(this.calls.has(event.toolCallId)||this.calls.size>=4)throw new Error('工具调用数量或标识无效');
      this.calls.set(event.toolCallId,{type:event.toolCallName,args:'',ended:false});
    }
    if(event.type==='TOOL_CALL_ARGS'){
      const call=this.calls.get(event.toolCallId);if(!call||call.ended||call.args.length+event.delta.length>1000)throw new Error('工具参数状态无效');call.args+=event.delta;
    }
    if(event.type==='TOOL_CALL_END'){
      const call=this.calls.get(event.toolCallId);if(!call||call.ended)throw new Error('工具结束状态无效');call.ended=true;
      const args=JSON.parse(call.args);if(!args||Object.keys(args).length!==1||typeof args.target!=='string')throw new Error('工具参数未通过校验');
      send('action',{id:event.toolCallId,type:call.type as AgentActionType,target:args.target});
    }
    if(event.type==='TEXT_MESSAGE_START')this.messages.set(event.messageId,'');
    if(event.type==='TEXT_MESSAGE_CONTENT'){
      const old=this.messages.get(event.messageId);if(old===undefined||old.length+event.delta.length>10000)throw new Error('回答消息范围无效');
      const text=old+event.delta;this.messages.set(event.messageId,text);send('answer',{text});
    }
    if(event.type==='RUN_ERROR'){this.finished=true;throw new Error(event.message);}
    if(event.type==='RUN_FINISHED'){this.finished=true;send('done','[DONE]');}
    return event;
  }
}
