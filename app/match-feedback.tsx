import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {FeedbackContext,MatchFeedback} from '../lib/feedback-types';
import {clientRequest} from '../lib/client-backend';

type FeedbackResponse={feedback:MatchFeedback|null;context:FeedbackContext;archived:boolean;canCreate:boolean};
type JournalEntry={matchId:string;context:FeedbackContext;version:number;updatedAt:string;archived:boolean};
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
    event.preventDefault();if(!record||loading||busy)return;setBusy(true);setError('');
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
      <form onSubmit={save}><fieldset disabled={busy} className="form-body feedback-fields">
        <label>よかったこと<textarea rows={3} maxLength={2000} value={goodPoints} onChange={event=>setGoodPoints(event.target.value)} placeholder="できたプレーや、続けたいこと"/></label>
        <label>改善したいこと<textarea rows={3} maxLength={2000} value={improvements} onChange={event=>setImprovements(event.target.value)} placeholder="困った場面や、見直したいこと"/></label>
        <label>次に取り組むこと<textarea rows={3} maxLength={2000} value={nextAction} onChange={event=>setNextAction(event.target.value)} placeholder="次の練習や試合で意識すること"/></label>
      </fieldset>{error&&<p className="form-error" role="alert">{error}</p>}
        {deleteConfirm&&<div className="feedback-delete-confirm"><p>この振り返りを削除しますか？</p><button type="button" className="text-button" disabled={busy} onClick={()=>setDeleteConfirm(false)}>戻る</button><button type="button" className="text-button member-delete-button" disabled={busy} onClick={()=>void remove()}>削除を確定</button></div>}
        <div className="form-actions feedback-form-actions">{record.feedback&&!deleteConfirm&&<button type="button" className="text-button member-delete-button" disabled={busy} onClick={()=>setDeleteConfirm(true)}>振り返りを削除</button>}<button type="button" className="secondary" disabled={busy} onClick={close}>閉じる</button><button className="primary" type="submit" disabled={busy||![goodPoints,improvements,nextAction].some(value=>value.trim())}>{busy?'保存中…':'振り返りを保存'}</button></div>
      </form>
    </>:<>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary" type="button" onClick={()=>void load()}>再読み込み</button><button className="primary" type="button" onClick={onClose}>閉じる</button></div></>}
  </FeedbackDialog>;
}
export function FeedbackJournal({onSelect,availableMatches,viewerName}:{onSelect:(matchId:string)=>void;availableMatches:{matchId:string;context:FeedbackContext}[];viewerName:string}){
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
  },[retry]);
  const savedIds=new Set((entries||[]).map(entry=>entry.matchId));
  const pending=[...new Map(availableMatches.map(entry=>[entry.matchId,entry])).values()].filter(entry=>!savedIds.has(entry.matchId)).sort((a,b)=>b.context.date.localeCompare(a.context.date)||a.matchId.localeCompare(b.matchId));
  const saved=[...(entries||[])].sort((a,b)=>b.context.date.localeCompare(a.context.date)||a.matchId.localeCompare(b.matchId));
  return <section className="feedback-workspace" aria-label="自分のフィードバック">
    <div className="feedback-workspace-toolbar"><p className="feedback-private">本人だけに表示・チームの共有メモには入りません</p><button type="button" className="secondary" disabled={entries===null&&!error} onClick={()=>setRetry(value=>value+1)}>最新の状態に更新</button></div>
    {error?<div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={()=>setRetry(value=>value+1)}>再読み込み</button></div>:entries===null?<p className="feedback-loading" role="status">振り返りの記入状況を確認しています…</p>:<div className="feedback-workspace-grid">
      <section className="panel feedback-workspace-section" aria-labelledby="feedback-pending-heading"><div className="section-heading"><div><h2 id="feedback-pending-heading">未記入 <span className="count-pill">{pending.length}</span></h2><p>自分が出場した、これから振り返りを書ける試合。</p></div></div>
        {pending.length?<ul className="feedback-journal-list">{pending.map(entry=><li key={entry.matchId}><button type="button" className="feedback-journal-entry" onClick={()=>onSelect(entry.matchId)}><MatchContext context={entry.context}/><span className="feedback-journal-open">振り返りを書く ↗</span></button></li>)}</ul>:<div className="feedback-empty"><h3>{availableMatches.length?'未記入の試合はありません':'出場した試合がまだありません'}</h3><p>{availableMatches.length?'出場した試合の振り返りはすべて記入済みです。':'試合の出場選手に「'+viewerName+'」を選ぶと、ここに表示されます。'}</p></div>}
      </section>
      <section className="panel feedback-workspace-section" aria-labelledby="feedback-written-heading"><div className="section-heading"><div><h2 id="feedback-written-heading">記入済み <span className="count-pill">{saved.length}</span></h2><p>保存した振り返りを読み返す・編集する。</p></div></div>
        {saved.length?<ul className="feedback-journal-list">{saved.map(entry=><li key={entry.matchId}><button type="button" className="feedback-journal-entry" onClick={()=>onSelect(entry.matchId)}><MatchContext context={entry.context} archived={entry.archived}/><span className="feedback-journal-open">読み返す・編集する ↗</span></button></li>)}</ul>:<div className="feedback-empty"><h3>保存した振り返りはまだありません</h3><p>未記入の試合から振り返りを保存すると、ここに移動します。</p></div>}
      </section>
    </div>}
  </section>;
}
