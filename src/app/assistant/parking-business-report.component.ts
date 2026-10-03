import { Component,input,output } from '@angular/core';
import type { AgentReport } from '../core/parking-agent';
import { occupancyLine,reportCsv } from '../core/parking-charts';
import {validRoute,type ParkingRoute} from '../core/parking-operations';

@Component({selector:'app-parking-business-report',template:`
@if(report().kind==='recommendation'){
 <div class="recommendation-list">@for(c of object()['candidates'];track c.id){<section><div><b>{{c.label}}</b><strong>{{c.free}} <small>空位</small></strong></div><p>步行约 {{c.meters}} 米（模型估计） · 模拟预留 {{c.reserved}} 位</p><p>{{c.reason}}</p><div class="actions"><button (click)="focus.emit(c.id)">定位车区</button><button (click)="showRoute(c.route)">显示道路路径</button></div></section>}@empty{<p>当前条件下暂无可推荐分区，请切换目的地或泊位偏好。</p>}<small>{{object()['policy']}}</small></div>
}
@if(['daily','weekly','monthly','yearly'].includes(report().kind)){
 <div class="business-kpis"><div><small>模拟已收金额</small><strong>¥{{money(object()['ledger'].paid_cents)}}</strong></div><div><small>已结算停车记录</small><strong>{{number(object()['ledger'].settled_stays)}}</strong></div></div>
 <p class="range">{{object()['from']}} 至 {{object()['to']}} · {{object()['zone']==='all'?'全部分区':object()['zone']+'区'}}</p>
 <figure><figcaption>日平均占用率 <span>0–100%</span></figcaption><svg viewBox="0 0 300 100" role="img" aria-label="按数据库汇总的日平均占用率"><path d="M0 0H300M0 45H300M0 90H300" stroke="#2c4b63" fill="none"/><polyline [attr.points]="line()" stroke="#79ddcf" stroke-width="2" fill="none"/></svg></figure>
 <button (click)="download()">导出每日汇总 CSV</button><details><summary>查看分区统计</summary><table><thead><tr><th>日期/分区</th><th>平均占用</th><th>入场</th></tr></thead><tbody>@for(row of object()['occupancy'].slice(0,18);track $index){<tr><td>{{row.day}} {{row.zone_id}}</td><td>{{row.average_occupied}}/{{row.capacity}}</td><td>{{row.arrivals}}</td></tr>}</tbody></table><small>显示前18行，完整每日汇总见导出文件。</small></details><small class="policy">金额来自模拟收费流水，不由车辆占用推算。{{object()['feePolicy']}}</small>
}
@if(report().kind==='workorders'||report().kind==='audit'){
 <div class="business-list">@for(row of array();track $index){<article><b>{{row['title']||row['action']}}</b><p>{{row['status']||row['actor']}} · {{row['note']||row['detail']}}</p><small>{{row['updated_at']||row['occurred_at']}}</small></article>}@empty{<p>当前没有记录。</p>}</div>
}
`,styles:[`:host{display:block;font-size:12px;color:#adc7d8}.business-kpis{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.business-kpis small{display:block;color:#7ea6ba;font-size:11px}.business-kpis strong{display:block;font-size:23px;font-weight:500;font-variant-numeric:tabular-nums;color:#9eede0;overflow-wrap:anywhere}.range{font-size:10px;color:#8eb3c7}figure{margin:16px 0}figcaption{font-size:11px;display:flex;justify-content:space-between}figcaption span{color:#7ea6ba}svg{width:100%;max-height:115px}button{font:inherit;min-height:40px;border:1px solid #3b708b;border-radius:6px;background:#122d42;color:#c0d9e9;padding:6px 10px;cursor:pointer}button:hover{border-color:#79ddcf}.actions{display:flex;gap:8px;flex-wrap:wrap}button:focus-visible{outline:2px solid #79ddcf;outline-offset:2px}summary{cursor:pointer;padding:13px 0}table{width:100%;border-collapse:collapse;font-size:10px}th,td{text-align:left;border-bottom:1px solid #284a62;padding:7px 3px}small.policy{display:block;color:#7c9db6;line-height:1.8;margin-top:12px}.recommendation-list section{border-bottom:1px solid #284a62;padding:12px 0}.recommendation-list section>div:first-child{display:flex;justify-content:space-between;align-items:center}.recommendation-list strong{color:#79ddcf;font-size:23px;font-variant-numeric:tabular-nums}.recommendation-list p{font-size:11px;line-height:1.7}.recommendation-list small{font-size:10px;color:#7ea6ba}.business-list article{padding:9px 0;border-bottom:1px solid #284a62}.business-list p{line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}`]})
export class ParkingBusinessReportComponent{
 readonly report=input.required<AgentReport>();readonly focus=output<string>();readonly routeReady=output<ParkingRoute>();
 object(){return this.report().data as Record<string,any>;}array(){return this.report().data as Record<string,any>[];}
 line(){return occupancyLine(this.object()['occupancy']??[]);}number(value:unknown){return Number(value).toLocaleString('zh-CN');}money(value:unknown){return (Number(value)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});}
 showRoute(value:unknown){if(validRoute(value))this.routeReady.emit(value);}
 download(){const blob=new Blob([reportCsv(this.object())],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`parking-${this.object()['from']}-${this.object()['to']}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
