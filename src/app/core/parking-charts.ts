export function dailyOccupancy(rows:Record<string,any>[]){
  const days=new Map<string,{occupied:number;capacity:number}>();
  for(const row of rows){const old=days.get(row['day'])??{occupied:0,capacity:0};old.occupied+=Number(row['average_occupied']);old.capacity+=Number(row['capacity']);days.set(row['day'],old);}
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,value])=>({day,rate:value.capacity?value.occupied/value.capacity*100:0}));
}
export function occupancyLine(rows:Record<string,any>[],width=300,height=90){const values=dailyOccupancy(rows);return values.map((v,i)=>`${(i/Math.max(1,values.length-1)*width).toFixed(2)},${(height-Math.max(0,Math.min(100,v.rate))/100*height).toFixed(2)}`).join(' ');}
export function reportCsv(value:Record<string,any>){
  const ledger=new Map((value['dailyLedger']??[]).map((r:any)=>[r.day,r]));
  const text=['date,average_occupancy_percent,settled_stays,paid_cents,source'];
  for(const day of dailyOccupancy(value['occupancy']??[])){const row:any=ledger.get(day.day)??{};text.push([day.day,day.rate.toFixed(2),Number(row.settled_stays??0),Number(row.paid_cents??0),'database-synthetic'].join(','));}
  return '\ufeff'+text.join('\r\n');
}
