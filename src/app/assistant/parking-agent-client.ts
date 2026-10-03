import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { ParkingAgUiBridge, type ParkingCatalog, type ParkingDatabaseSnapshot, type ParkingRoute } from '../core/parking-operations';
import { SseFramer, type AgentSnapshot, type SseFrame } from '../core/parking-agent';

const SESSION_KEY='parking-role-session', API='/smartCockpit/api/parking';
export interface ParkingSession {token:string;username:string;role:'visitor'|'security'|'operator'|'admin';expiresAt:number;}
export class ParkingAgentClient {
  readonly threadId=crypto.randomUUID();currentRun='';destination='outpatient';preference='standard';
  session():ParkingSession|null{
    try{const raw=sessionStorage.getItem(SESSION_KEY);if(raw){const value=JSON.parse(raw);if(typeof value.token==='string'&&value.expiresAt*1000>Date.now())return value;}
      if(sessionStorage.getItem('parking-ignore-admin-token'))return null;
      const token=sessionStorage.getItem('cockpit-action-token');if(token&&Number(token.split('.')[0])*1000>Date.now())return {token,username:'admin',role:'admin',expiresAt:Number(token.split('.')[0])};
    }catch{}return null;
  }
  authorized(){return !!this.session();}
  async request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
    const response=await fetch(API+path,{method,signal:signal??AbortSignal.timeout(method==='GET'?15000:100000),headers:{'Content-Type':'application/json',...(this.session()?{Authorization:`Bearer ${this.session()!.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json().catch(()=>{throw new Error('停车服务未返回JSON，请检查接口路径');});if(!response.ok){if(response.status===401)this.logout();throw new Error(value.message||value.detail||'停车业务请求失败（'+response.status+'）');}return value;
  }
  async login(username:string,password:string){const session=await this.request<ParkingSession>('/login','POST',{username,password});sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));sessionStorage.removeItem('parking-ignore-admin-token');return session;}
  verify(password:string){return this.login('admin',password).then(()=>{});}
  logout(){sessionStorage.removeItem(SESSION_KEY);sessionStorage.setItem('parking-ignore-admin-token','true');}
  catalog(){return this.request<ParkingCatalog>('/catalog');}
  snapshot(){return this.request<ParkingDatabaseSnapshot>('/snapshot');}
  route(target:string){return this.request<ParkingRoute>('/route?to='+encodeURIComponent(target));}
  feedback(type:string,target:string,result:string){return this.request('/feedback','POST',{runId:this.currentRun,type,target,result:result.slice(0,500)}).catch(()=>{});}
  async stream(message:string,model:string,context:AgentSnapshot,history:{role:string;content:string}[],signal:AbortSignal,onFrame:(frame:SseFrame)=>void){
    if(!this.authorized())throw new Error('请先选择访客模式或登录业务账号');this.currentRun=crypto.randomUUID();
    const input=RunAgentInputSchema.parse({protocolVersion:'1.0',threadId:this.threadId,runId:this.currentRun,messages:[...history.slice(-8).map(t=>({id:crypto.randomUUID(),role:t.role,content:t.content.slice(0,1500)})),{id:crypto.randomUUID(),role:'user',content:message}],tools:[],context:[],state:{sceneReady:context.sceneReady,selected:context.selected,lastActionResult:context.lastActionResult,model,destination:this.destination,preference:this.preference},forwardedProps:{}});
    const response=await fetch(API+'/ag-ui',{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.session()!.token}`},body:JSON.stringify(input)});
    if(response.status===401){this.logout();throw new Error('业务会话已过期，请重新登录');}if(!response.ok||!response.body)throw new Error('停车智能体流式连接未建立');
    const reader=response.body.getReader(),decoder=new TextDecoder(),framer=new SseFramer(),bridge=new ParkingAgUiBridge(onFrame);
    try{while(true){const {value,done}=await reader.read();for(const frame of framer.push(done?decoder.decode():decoder.decode(value,{stream:true}),done)){if(signal.aborted)return;bridge.accept(JSON.parse(frame.data));}if(done)break;}if(!bridge.complete&&!signal.aborted)throw new Error('智能体运行未完整结束，请重试');}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
}
