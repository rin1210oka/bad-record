import {useState} from 'react';
import {calendarCells,shiftCalendarMonth,type CalendarMark} from '../lib/feedback-browse';
export default function FeedbackCalendar({today,selectedDate,marks,onDate,ready}:{today:string;selectedDate:string;marks:Record<string,CalendarMark>;onDate:(date:string)=>void;ready:boolean}){
 const [month,setMonth]=useState((selectedDate||today).slice(0,7));
 return <section className="feedback-calendar" aria-label="振り返りの日付カレンダー">
   <div className="feedback-calendar-heading"><button type="button" aria-label="前の月" onClick={()=>setMonth(value=>shiftCalendarMonth(value,-1))}>‹</button><strong aria-live="polite">{Number(month.slice(0,4))}年{Number(month.slice(5))}月</strong><button type="button" aria-label="次の月" onClick={()=>setMonth(value=>shiftCalendarMonth(value,1))}>›</button></div>
   <div className="feedback-calendar-grid">{['日','月','火','水','木','金','土'].map(day=><span className="feedback-calendar-weekday" key={day}>{day}</span>)}{calendarCells(month).map((date,index)=>date?<button type="button" key={date} aria-pressed={selectedDate===date} aria-current={date===today?'date':undefined} aria-label={date+(ready?' 未記入'+(marks[date]?.pending||0)+'試合 記入済み'+(marks[date]?.saved||0)+'試合':' 記入状況を確認中')} className={selectedDate===date?'is-selected':''} onClick={()=>onDate(date)}><span>{Number(date.slice(8))}</span><small>{ready&&marks[date]?.pending>0&&<span className="calendar-pending">○{marks[date].pending}</span>}{ready&&marks[date]?.saved>0&&<span className="calendar-saved">✓{marks[date].saved}</span>}</small></button>:<span key={'blank-'+index}/>)}</div>
   <p className="feedback-calendar-legend">○ 未記入　✓ 記入済み{!ready&&'（確認中）'}</p>
   <button className="text-button" type="button" onClick={()=>setMonth(today.slice(0,7))}>今月へ</button>
 </section>;
}
