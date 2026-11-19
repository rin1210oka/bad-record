export type CalendarMark={pending:number;saved:number};
const iso=(date:Date)=>date.toISOString().slice(0,10);
export function feedbackPeriod(period:'month'|'year'|'all',today:string){
  if(period==='all')return {from:'',to:''};
  const date=new Date(today+'T00:00:00Z');
  if(period==='year'){const year=date.getUTCFullYear()-(date.getUTCMonth()<3?1:0);return {from:year+'-04-01',to:(year+1)+'-03-31'};}
  const previous=new Date(date);previous.setUTCDate(1);previous.setUTCMonth(previous.getUTCMonth()-1);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),0)).getUTCDate();previous.setUTCDate(Math.min(date.getUTCDate(),lastDay));
  return {from:iso(previous),to:today};
}
export function shiftCalendarMonth(month:string,amount:number){const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+amount);return iso(date).slice(0,7);}
export function calendarCells(month:string):(string|null)[]{
  const first=new Date(month+'-01T00:00:00Z'),offset=first.getUTCDay(),days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return Array.from({length:Math.ceil((offset+days)/7)*7},(_,index)=>{const day=index-offset+1;return day<1||day>days?null:month+'-'+String(day).padStart(2,'0');});
}
export function calendarMarkers(pendingDates:string[],savedDates:string[]){
  const marks:Record<string,CalendarMark>={};
  for(const date of pendingDates){marks[date]??={pending:0,saved:0};marks[date].pending++;}
  for(const date of savedDates){marks[date]??={pending:0,saved:0};marks[date].saved++;}
  return marks;
}
