import FeedbackCalendar from './feedback-calendar';
import {feedbackPeriod,calendarMarkers} from '../lib/feedback-browse';
import {japanDate} from '../lib/member-cohort';
import MatchPeopleFilters,{type SearchPlayer} from './match-people-filters';
import {inDateRange,matchesPeople,type MatchPeople} from '../lib/match-search';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {FeedbackContext,MatchFeedback} from '../lib/feedback-types';
import {clientRequest} from '../lib/client-backend';

type FeedbackResponse={feedback:MatchFeedback|null;context:FeedbackContext;archived:boolean;canCreate:boolean};
type JournalEntry={matchId:string;context:FeedbackContext;version:number;updatedAt:string;archived:boolean;people?:MatchPeople|null;goodPoints?:string;improvements?:string;nextAction?:string};
async function request<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const value=await clientRequest<T>(url,method,body);signal?.throwIfAborted();return value;
}

function FeedbackDialog({title,close,busy=false,children}:{title:string;close:()=>void;busy?:boolean;children:React.ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null),heading=useId();
  useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="modal feedback-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)close();}}>
    <div className="modal-heading"><div><span className="eyebrow">MY MATCH JOURNAL</span><h2 id={heading}>{title}</h2></div><button className="icon-button" type="button" disabled={busy} onClick={close} aria-label="振り返りを閉じる">×</button></div>
    <p className="feedback-private">本人だけに表示・チームの共有メモには入りません</p>{children}
  </dialog>;
}
function MatchContext({context,archived=false}:{context:FeedbackContext;archived?:boolean}){
  return <div className="feedback-match-context"><div><time>{context.date.replaceAll('-','.')}</time><span>{context.category}</span><span>{context.discipline}</span>{archived&&<span>試合一覧から削除済み</span>}</div>{context.event&&<p>{context.event}</p>}<strong>{context.sideA.join('・')} <small>vs</small> {context.sideB.join('・')}</strong><p>{context.scores.map(score=>score.join('−')).join(' / ')}</p></div>;
}
export function MatchFeedbackModal({matchId,onClose,onSaved}:{matchId:string;onClose:()=>void;onSaved:(message:string)=>void}){
  const [record,setRecord]=useState<FeedbackResponse|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deleteConfirm,setDeleteConfirm]=useState(false);
  const [goodPoints,setGoodPoints]=useState(''),[improvements,setImprovements]=useState(''),[nextAction,setNextAction]=useState('');
  const counts=[goodPoints,improvements,nextAction].map(value=>Array.from(value).length);
  const overLimit=counts.some(count=>count>1000);
  const endpoint='/api/matches/'+encodeURIComponent(matchId)+'/feedback';
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{const data=await request<FeedbackResponse>(endpoint,'GET',undefined,signal);setRecord(data);setGoodPoints(data.feedback?.goodPoints||'');setImprovements(data.feedback?.improvements||'');setNextAction(data.feedback?.nextAction||'');}
    catch(failure){if(!signal?.aborted)setError((failure as Error).message);}
    finally{if(!signal?.aborted)setLoading(false);}
  },[endpoint]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const dirty=Boolean(record)&&(goodPoints!==(record?.feedback?.goodPoints||'')||improvements!==(record?.feedback?.improvements||'')||nextAction!==(record?.feedback?.nextAction||''));
  const close=()=>{if(busy)return;if(dirty&&!window.confirm('保存していない振り返りがあります。保存せずに閉じますか？'))return;onClose();};
  async function save(event:React.FormEvent){
    event.preventDefault();if(!record||loading||busy||overLimit)return;setBusy(true);setError('');
    try{await request<FeedbackResponse>(endpoint,'PUT',{version:record.feedback?.version??0,goodPoints,improvements,nextAction});onSaved('自分の振り返りを保存しました。');}
    catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }
  async function remove(){
    if(!record?.feedback||busy)return;setBusy(true);setError('');
    try{await request(endpoint,'DELETE',{version:record.feedback.version});onSaved('自分の振り返りを削除しました。');}
    catch(failure){setError((failure as Error).message);setDeleteConfirm(false);}finally{setBusy(false);}
  }
  return <FeedbackDialog title="自分の振り返り" close={close} busy={busy}>
    {loading?<p className="feedback-loading" role="status">自分の振り返りを読み込んでいます…</p>:record?<>
      <MatchContext context={record.context} archived={record.archived}/>
      {record.archived&&<p className="form-hint">試合一覧から削除された後も、保存した自分の振り返りは残ります。</p>}
      <p className="form-hint">各欄1,000字まで。書ける欄だけでも保存できます。</p>
      <form onSubmit={save}><fieldset disabled={busy} className="form-body feedback-fields">
        <label>よかったこと<textarea rows={3} aria-invalid={counts[0]>1000||undefined} value={goodPoints} onChange={event=>setGoodPoints(event.target.value)} placeholder="できたプレーや、続けたいこと"/><small className={counts[0]>1000?'feedback-character-count is-error':'feedback-character-count'}>{counts[0]} / 1,000字</small></label>
        <label>改善したいこと<textarea rows={3} aria-invalid={counts[1]>1000||undefined} value={improvements} onChange={event=>setImprovements(event.target.value)} placeholder="困った場面や、見直したいこと"/><small className={counts[1]>1000?'feedback-character-count is-error':'feedback-character-count'}>{counts[1]} / 1,000字</small></label>
        <label>次に取り組むこと<textarea rows={3} aria-invalid={counts[2]>1000||undefined} value={nextAction} onChange={event=>setNextAction(event.target.value)} placeholder="次の練習や試合で意識すること"/><small className={counts[2]>1000?'feedback-character-count is-error':'feedback-character-count'}>{counts[2]} / 1,000字</small></label>
      </fieldset>{overLimit&&<p className="form-error" role="alert">1,000字を超えた欄があります。文章は自動で削りません。各欄1,000字以内に調整してから保存してください。</p>}{error&&<p className="form-error" role="alert">{error}</p>}
        {deleteConfirm&&<div className="feedback-delete-confirm"><p>この振り返りを削除しますか？</p><button type="button" className="text-button" disabled={busy} onClick={()=>setDeleteConfirm(false)}>戻る</button><button type="button" className="text-button member-delete-button" disabled={busy} onClick={()=>void remove()}>削除を確定</button></div>}
        <div className="form-actions feedback-form-actions">{record.feedback&&!deleteConfirm&&<button type="button" className="text-button member-delete-button" disabled={busy} onClick={()=>setDeleteConfirm(true)}>振り返りを削除</button>}<button type="button" className="secondary" disabled={busy} onClick={close}>閉じる</button><button className="primary" type="submit" disabled={busy||overLimit||![goodPoints,improvements,nextAction].some(value=>value.trim())}>{busy?'保存中…':'振り返りを保存'}</button></div>
      </form>
    </>:<>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary" type="button" onClick={()=>void load()}>再読み込み</button><button className="primary" type="button" onClick={onClose}>閉じる</button></div></>}
  </FeedbackDialog>;
}
export function FeedbackJournal({onSelect,availableMatches,viewerName,members,memberId,revision=0}:{onSelect:(matchId:string)=>void;availableMatches:{matchId:string;context:FeedbackContext;people:MatchPeople}[];viewerName:string;members:SearchPlayer[];memberId:string;revision?:number}){
  const today=japanDate();
  const [calendarOpen,setCalendarOpen]=useState(false),[reading,setReading]=useState(false);
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[partnerId,setPartnerId]=useState(''),[opponent,setOpponent]=useState('');
  const [entries,setEntries]=useState<JournalEntry[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setError('');setEntries(null);
    async function load(){
      try{
        const saved=new Map<string,JournalEntry>();let more=false;
        do{
          const data:{feedback:JournalEntry[];hasMore?:boolean}=await request<{feedback:JournalEntry[];hasMore?:boolean}>(more?'/api/feedback?more=1':'/api/feedback','GET',undefined,controller.signal);
          for(const entry of data.feedback)saved.set(entry.matchId,entry);
          more=Boolean(data.hasMore);
        }while(more);
        if(!controller.signal.aborted)setEntries([...saved.values()]);
      }catch(failure){if(!controller.signal.aborted)setError((failure as Error).message);}
    }
    void load();return()=>controller.abort();
  },[retry,revision]);
  const savedIds=new Set((entries||[]).map(entry=>entry.matchId));
  const allPending=[...new Map(availableMatches.map(entry=>[entry.matchId,entry])).values()].filter(entry=>!savedIds.has(entry.matchId)).sort((a,b)=>b.context.date.localeCompare(a.context.date)||a.matchId.localeCompare(b.matchId));
  const allSaved=[...(entries||[])].sort((a,b)=>b.context.date.localeCompare(a.context.date)||a.matchId.localeCompare(b.matchId));
  const invalidDates=Boolean(from&&to&&from>to);
  const filtered=Boolean(from||to||partnerId||opponent);
  const accepts=(entry:{context:FeedbackContext;people?:MatchPeople|null})=>!invalidDates&&inDateRange(entry.context.date,from,to)&&matchesPeople(entry.people,partnerId,opponent);
  const pending=allPending.filter(accepts),saved=allSaved.filter(accepts);
  const markers=calendarMarkers(allPending.filter(entry=>matchesPeople(entry.people,partnerId,opponent)).map(entry=>entry.context.date),allSaved.filter(entry=>matchesPeople(entry.people,partnerId,opponent)).map(entry=>entry.context.date));
  const selectPeriod=(period:'month'|'year'|'all')=>{const range=feedbackPeriod(period,today);setFrom(range.from);setTo(range.to);setCalendarOpen(false);};
  return <section className="feedback-workspace" aria-label="自分のフィードバック">
    <div className="feedback-workspace-toolbar"><p className="feedback-private">本人だけに表示・チームの共有メモには入りません</p><button type="button" className="secondary" disabled={entries===null&&!error} onClick={()=>setRetry(value=>value+1)}>最新の状態に更新</button></div>
    <section className="panel feedback-search-panel" aria-label="フィードバックを絞り込み">
      <div className="feedback-period-buttons" aria-label="振り返りの表示期間">{([['month','直近1か月'],['year','今年度'],['all','すべての期間']] as const).map(([period,label])=>{const range=feedbackPeriod(period,today);return <button className="secondary" type="button" key={period} aria-pressed={range.from===from&&range.to===to} onClick={()=>selectPeriod(period)}>{label}</button>;})}<button className="secondary" type="button" aria-expanded={calendarOpen} onClick={()=>setCalendarOpen(value=>!value)}>日付から探す</button></div>
      {calendarOpen&&<FeedbackCalendar today={today} selectedDate={from===to?from:''} marks={markers} ready={entries!==null} onDate={date=>{setFrom(date);setTo(date);}}/>}
      {from&&from===to&&<p className="feedback-selected-date">選択した日付：{from.replaceAll('-','.')} <button className="text-button" type="button" onClick={()=>{setFrom('');setTo('');}}>日付指定を解除</button></p>}
      <div className="feedback-date-filters"><label>開始日<input type="date" aria-label="フィードバックの開始日" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>終了日<input type="date" aria-label="フィードバックの終了日" value={to} onChange={event=>setTo(event.target.value)}/></label></div>
      <MatchPeopleFilters people={[...availableMatches,...(entries||[])].map(entry=>entry.people)} members={members} memberId={memberId} partnerId={partnerId} opponent={opponent} onPartner={setPartnerId} onOpponent={setOpponent}/>
      {invalidDates&&<p className="form-error" role="alert">終了日は開始日以降を指定してください。</p>}
      {filtered&&<button type="button" className="text-button" onClick={()=>{setFrom('');setTo('');setPartnerId('');setOpponent('');}}>絞り込みを解除</button>}
      <p className="form-hint">同じ条件で未記入・記入済みの両方を絞り込みます。</p>
    </section>
    <div className="feedback-view-buttons" aria-label="振り返りの表示方法"><button type="button" className="secondary" aria-pressed={!reading} onClick={()=>setReading(false)}>試合から選ぶ</button><button type="button" className="secondary" aria-pressed={reading} onClick={()=>setReading(true)}>まとめて読む</button></div>
    {error?<div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={()=>setRetry(value=>value+1)}>再読み込み</button></div>:entries===null?<p className="feedback-loading" role="status">振り返りの記入状況を確認しています…</p>:reading?<section className="panel feedback-reading-panel" aria-label="自分の振り返りをまとめて読む"><div className="section-heading"><div><h2>振り返りをまとめて読む <span className="count-pill">{saved.length}</span></h2><p>選択した条件の記入済みの振り返りを、新しい試合から表示します。</p></div></div>{saved.length?<div className="feedback-reading-list">{saved.map(entry=><article className="feedback-reading-entry" key={entry.matchId}><MatchContext context={entry.context} archived={entry.archived}/><dl>{([['goodPoints','よかったこと'],['improvements','改善したいこと'],['nextAction','次に取り組むこと']] as const).map(([field,label])=>entry[field]?.trim()?<div key={field}><dt>{label}</dt><dd>{entry[field]}</dd></div>:null)}</dl><button type="button" className="text-button" onClick={()=>onSelect(entry.matchId)}>この振り返りを編集する ↗</button></article>)}</div>:<div className="feedback-empty"><h3>{filtered?'条件に合う振り返りはありません':'保存した振り返りはまだありません'}</h3><p>記入済みの振り返りを、この画面でまとめて読み返せます。</p></div>}</section>:<div className="feedback-workspace-grid">
      <section className="panel feedback-workspace-section" aria-labelledby="feedback-pending-heading"><div className="section-heading"><div><h2 id="feedback-pending-heading">未記入 <span className="count-pill">{pending.length}{filtered&&' / '+allPending.length}</span></h2><p>自分が出場した、これから振り返りを書ける試合。</p></div></div>
        {pending.length?<ul className="feedback-journal-list">{pending.map(entry=><li key={entry.matchId}><button type="button" className="feedback-journal-entry" onClick={()=>onSelect(entry.matchId)}><MatchContext context={entry.context}/><span className="feedback-journal-open">振り返りを書く ↗</span></button></li>)}</ul>:<div className="feedback-empty"><h3>{filtered?'条件に合う未記入の試合はありません':availableMatches.length?'未記入の試合はありません':'出場した試合がまだありません'}</h3><p>{filtered?'日付・ペア相手・対戦相手の条件を変えてください。':availableMatches.length?'出場した試合の振り返りはすべて記入済みです。':'試合の出場選手に「'+viewerName+'」を選ぶと、ここに表示されます。'}</p></div>}
      </section>
      <section className="panel feedback-workspace-section" aria-labelledby="feedback-written-heading"><div className="section-heading"><div><h2 id="feedback-written-heading">記入済み <span className="count-pill">{saved.length}{filtered&&' / '+allSaved.length}</span></h2><p>保存した振り返りを読み返す・編集する。</p></div></div>
        {saved.length?<ul className="feedback-journal-list">{saved.map(entry=><li key={entry.matchId}><button type="button" className="feedback-journal-entry" onClick={()=>onSelect(entry.matchId)}><MatchContext context={entry.context} archived={entry.archived}/><span className="feedback-journal-open">読み返す・編集する ↗</span></button></li>)}</ul>:<div className="feedback-empty"><h3>{filtered?'条件に合う振り返りはありません':'保存した振り返りはまだありません'}</h3><p>{filtered?'日付・ペア相手・対戦相手の条件を変えてください。':'未記入の試合から振り返りを保存すると、ここに移動します。'}</p></div>}
      </section>
    </div>}
  </section>;
}

export function FeedbackGoal({revision,onSelect}:{revision:number;onSelect:(id:string)=>void}){
 const [data,setData]=useState<{matchId:string;date:string;nextAction:string}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');setLoading(true);void request<{goal:typeof data}>('/api/feedback-goal','GET',undefined,controller.signal).then(result=>setData(result.goal)).catch(failure=>{if(!controller.signal.aborted)setError((failure as Error).message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[revision,retry]);
 return <section className="panel feedback-goal" aria-labelledby="feedback-goal-heading"><div className="feedback-goal-heading"><h2 id="feedback-goal-heading">次の試合で意識すること</h2><span>本人だけに表示</span></div>{loading?<p role="status">目標を読み込んでいます…</p>:error?<div><p role="alert">{error}</p><button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)}>再読み込み</button></div>:data?<><p className="feedback-goal-text">{data.nextAction}</p><div className="feedback-goal-footer"><span>{data.date.replaceAll('-','.')}の試合の振り返りより</span><button className="text-button" type="button" onClick={()=>onSelect(data.matchId)}>振り返りを開く ↗</button></div></>:<p>振り返りに「次に取り組むこと」を保存すると、ここで確認できます。</p>}</section>;
}
