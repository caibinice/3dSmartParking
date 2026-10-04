import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { type ParkingCatalog, type ParkingDatabaseSnapshot, type ParkingRoute } from '../core/parking-operations';
import { type AgentSnapshot, type SseFrame } from '../core/parking-agent';
import { readParkingStream, parkingHttpError } from '../core/parking-stream';

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
    if(!response.ok){if(response.status===401)this.logout();throw new Error(await parkingHttpError(response));}
    return await response.json().catch(()=>{throw new Error('停车服务未返回JSON，请检查接口路径');});
  }
  async login(username:string,password:string){const session=await this.request<ParkingSession>('/login','POST',{username,password});sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));sessionStorage.removeItem('parking-ignore-admin-token');return session;}
  verify(password:string){return this.login('admin',password).then(()=>{});}
  logout(){sessionStorage.removeItem(SESSION_KEY);sessionStorage.setItem('parking-ignore-admin-token','true');}
  catalog(){return this.request<ParkingCatalog>('/catalog');}
  snapshot(){return this.request<ParkingDatabaseSnapshot>('/snapshot');}
  route(target:string,from='entrance',signal?:AbortSignal){return this.request<ParkingRoute>('/route?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(target),'GET',undefined,signal);}
  feedback(type:string,target:string,result:string){return this.request('/feedback','POST',{runId:this.currentRun,type,target,result:result.slice(0,500)}).catch(()=>{});}
  async stream(message:string,model:string,context:AgentSnapshot,history:{role:string;content:string}[],signal:AbortSignal,onFrame:(frame:SseFrame)=>void){
    if(!this.authorized())throw new Error('请先选择访客模式或登录业务账号');this.currentRun=crypto.randomUUID();
    const input=RunAgentInputSchema.parse({protocolVersion:'1.0',threadId:this.threadId,runId:this.currentRun,messages:[...history.slice(-8).map(t=>({id:crypto.randomUUID(),role:t.role,content:t.content.slice(0,1500)})),{id:crypto.randomUUID(),role:'user',content:message}],tools:[],context:[],state:{sceneReady:context.sceneReady,selected:context.selected,lastActionResult:context.lastActionResult,model,destination:this.destination,preference:this.preference},forwardedProps:{}});
    const response=await fetch(API+'/ag-ui',{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.session()!.token}`},body:JSON.stringify(input)});
    if(response.status===401)this.logout();
    if(!response.ok)throw new Error(await parkingHttpError(response));
    if(!response.body)throw new Error('助手未返回流式响应，请重新提问');
    await readParkingStream(response.body,signal,onFrame);
  }
}
