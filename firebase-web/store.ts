import {matchPeople} from '../lib/match-search';
import {collection,doc,getDoc,getDocs,setDoc,writeBatch,arrayUnion,query,where,orderBy,limit,startAfter,runTransaction,serverTimestamp,Timestamp,type DocumentData,type QueryDocumentSnapshot,type QuerySnapshot} from 'firebase/firestore';
import {auth,db} from './firebase';
import {TeamError,memberInput,matchInput,fingerprint,normal,version,type Member,type MatchInput} from '../lib/team-domain';
import {memberSnapshot,japanDate,schoolYear} from '../lib/member-cohort';
import type {AccessViewer} from '../app/access-context';
import {encodeMatch,decodeMatch} from './codec';

type Row=DocumentData;
export let unlocked=false;
let sessionEpoch=0;
export function setUnlocked(value:boolean){sessionEpoch++;unlocked=value;if(!value){membersCache=[];memberRows.clear();matchesCache.clear();since=null;memberSince=null;journalCursor=null;}}
let membersCache:Member[]=[],memberRows=new Map<string,Member>(),matchesCache=new Map<string,Row>(),since:Timestamp|null=null,memberSince:Timestamp|null=null;
let selectedTeam:string|null=null;
export const TEAM_LIMIT=3;

export function selectTeam(id:string|null){
  setUnlocked(false);
  selectedTeam=id;
}

function teamDoc(path:string,...segments:string[]){
  return selectedTeam?doc(db,'teams',selectedTeam,path,...segments):doc(db,path,...segments);
}
function teamCollection(path:string,...segments:string[]){
  return selectedTeam?collection(db,'teams',selectedTeam,path,...segments):collection(db,path,...segments);
}
const accountRef=(uid:string)=>doc(db,'accountTeams',uid);
const teamSlot=(teamId:string)=>({teamIds:arrayUnion(teamId),lastAdded:teamId});
const teamLimitError=()=>new TeamError('所属できるのは3チームまでです。',409,'team_limit');
const uuid=()=>crypto.randomUUID();
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
const memberRef=(id:string)=>teamDoc('players',id);
const matchRef=(id:string)=>teamDoc('matches',id);
const nameKey=(m:{name:string;group:string})=>JSON.stringify([normal(m.name),normal(m.group)]);
const conflict=()=>new TeamError('別の画面で更新されました。入力を控えてから再読み込みしてください。',409);
const feedbackRef=(uid:string,id:string)=>teamDoc('privateUsers',uid,'feedback',id);
function uid(){if(!auth.currentUser)throw new TeamError('メールアドレスとパスワードでログインしてください。',401);return auth.currentUser.uid;}
function captureSession(){return {epoch:sessionEpoch,id:uid(),teamId:selectedTeam};}
function assertSession(scope:ReturnType<typeof captureSession>){if(scope.epoch!==sessionEpoch||auth.currentUser?.uid!==scope.id)throw new TeamError('入場状態が変わりました。もう一度ロックを解除してください。',401);}
export async function membership(){
  const scope=captureSession();
  try{const snap=await getDoc(teamDoc('memberships',scope.id));assertSession(scope);return snap.exists()?snap.data():null;}
  catch(error){if((error as {code?:string}).code==='permission-denied')throw new TeamError('ログイン後の参加情報を取得できません。メール認証版の保存ルールが反映されているか、保守担当に確認してください。',403,'membership_access_denied');throw error;}
}
export async function viewer():Promise<AccessViewer>{
  const scope=captureSession(),id=scope.id,m=await membership();assertSession(scope);if(!m?.active)throw new TeamError('部への参加登録を確認してください。',403);
  const p=await getDoc(memberRef(m.playerId));assertSession(scope);if(!p.exists())throw new TeamError('選手情報を確認してください。');
  const team=await getTeam();
  assertSession(scope);
  return {id,memberId:m.playerId,name:p.data().name,teamName:team?.name,teamHistoryId:team?.historyId};
}
export type TeamSummary={id:string;name:string;ownerUid?:string};
export async function listTeams():Promise<TeamSummary[]>{
  const scope=captureSession();
  const account=await getDoc(accountRef(scope.id)).catch(error=>{
    if((error as {code?:string}).code==='permission-denied'){
      throw new TeamError('メール認証済みですが、所属チームを読み込めません。接続先のFirestoreに複数チーム版の保存ルールが反映されているか確認してください。',403,'team_directory_denied');
    }
    throw error;
  });
  const ids:string[]=account.data()?.teamIds??[];
  const snapshots=await Promise.all(ids.map(id=>getDoc(doc(db,'teams',id))));
  assertSession(scope);
  return snapshots.flatMap(snapshot=>snapshot.exists()?[{
    id:snapshot.id,name:snapshot.data().name,ownerUid:snapshot.data().ownerUid,
  }]:[]);
}
async function checkTeamSlot(scope:ReturnType<typeof captureSession>){
  const teams=(await getDoc(accountRef(scope.id))).data()?.teamIds??[];
  assertSession(scope);
  if(teams.length>=TEAM_LIMIT)throw teamLimitError();
}
export async function createCommunity(name:string,phrase:string):Promise<TeamSummary>{
  const scope=captureSession();
  name=name.trim();
  if(!name||name.length>60)throw new TeamError('チーム名を60文字以内で入力してください。');
  if(phrase.length<8||phrase.length>200||!phrase.trim())throw new TeamError('チームコードを8〜200文字で入力してください。');
  await checkTeamSlot(scope);
  const id=uuid(),codeKey=await digest(phrase),code=doc(db,'teamCodes',codeKey);
  if((await getDoc(code)).exists())throw new TeamError('このチームコードは使われています。別のコードを入力してください。',409);
  assertSession(scope);
  const batch=writeBatch(db);
  batch.set(doc(db,'teams',id),{name,ownerUid:scope.id,createdAt:serverTimestamp()});
  batch.set(doc(db,'teams',id,'settings','registration'),{codeKey});
  batch.set(code,{teamId:id,expiresAt:Timestamp.fromMillis(Date.now()+365*86400000)});
  batch.set(accountRef(scope.id),teamSlot(id),{merge:true});
  try{await batch.commit();}
  catch(error){
    if((error as {code?:string}).code==='permission-denied'){
      await checkTeamSlot(scope);
      if((await getDoc(code)).exists())throw new TeamError('このチームコードは使われています。別のコードを入力してください。',409);
    }
    throw error;
  }
  assertSession(scope);
  return {id,name,ownerUid:scope.id};
}
export async function findTeamByCode(phrase:string):Promise<string>{
  const scope=captureSession();
  const code=await getDoc(doc(db,'teamCodes',await digest(phrase)));
  assertSession(scope);
  const data=code.data();
  if(!data||data.expiresAt.toMillis()<=Date.now())throw new TeamError('チームコードが違うか、参加受付が終了しています。');
  return data.teamId;
}
export async function getTeam(){
  const snapshot=await getDoc(selectedTeam?doc(db,'teams',selectedTeam):doc(db,'team','current'));
  if(!snapshot.exists())return null;
  const {name,createdAt,ownerUid}=snapshot.data();
  return {
    name:typeof name==='string'?name:undefined,
    historyId:selectedTeam??(createdAt instanceof Timestamp?createdAt.seconds+':'+createdAt.nanoseconds:undefined),
    ownerUid:typeof ownerUid==='string'?ownerUid:undefined,
  };
}
export async function isDesignatedFounder(){
  try{return (await getDoc(teamDoc('setup','founder'))).exists();}
  catch(error){if((error as {code?:string}).code==='permission-denied')return false;throw error;}
}
export async function createTeam(teamName:string,phrase:string){
  const scope=captureSession();
  const name=teamName.trim();
  if(!name||name.length>60)throw new TeamError('チーム名を60文字以内で入力してください。');
  if(phrase.length<8||phrase.length>200||!phrase.trim())throw new TeamError('チームコードを8〜200文字で入力してください。');
  const joinKey=await digest(phrase);
  const team=teamDoc('team','current');
  await runTransaction(db,async tx=>{
    const current=await tx.get(team);
    assertSession(scope);
    if(current.exists())throw new TeamError('チームはすでに作成されています。',409);
    tx.set(team,{name,createdAt:serverTimestamp()});
    tx.set(teamDoc('setup','teamRegistration'),{joinKey});
    tx.set(teamDoc('joinKeys',joinKey),{enabled:true,expiresAt:Timestamp.fromMillis(Date.now()+365*86400000)});
  });
  assertSession(scope);
}
export async function joinTeam(phrase:string|null,body:Row){
  const scope=captureSession(),id=scope.id,input=memberInput(body);
  const joinKey=phrase===null?'':await digest(phrase);
  const key=await digest(nameKey(input));
  const membershipRef=teamDoc('memberships',id),player=memberRef('self-'+id),lock=teamDoc('playerNames',key);
  if(scope.teamId&&phrase!==null)await checkTeamSlot(scope);
  await runTransaction(db,async tx=>{
    const [joined,named,p]=await Promise.all([tx.get(membershipRef),tx.get(lock),tx.get(player)]);
    assertSession(scope);
    if(joined.exists())throw new TeamError('すでに登録されています。再読み込みしてください。',409);
    if(named.exists()||p.exists())throw new TeamError('同じ名前・所属の登録があります。他人の選手とはひも付けず、登録内容を確認してください。',409);
    if(scope.teamId&&phrase!==null)tx.set(accountRef(id),teamSlot(scope.teamId),{merge:true});
    tx.set(membershipRef,{playerId:player.id,active:true,joinKey,createdAt:serverTimestamp()});
    tx.set(player,{...input,id:player.id,ownerUid:id,version:1,deletedAt:null,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),nameLock:key});
    tx.set(lock,{playerId:player.id,key:nameKey(input)});
  }).catch(async error=>{
    if(scope.teamId&&phrase!==null&&(error as {code?:string}).code==='permission-denied')await checkTeamSlot(scope);
    throw error;
  });
  assertSession(scope);
}
export type JoinPlayer = Member & {ownerUid:string|null};
export type LinkRequest = {uid:string;playerId:string;playerName:string;approverUid:string;joinKey:string;status:'pending'|'approved'|'rejected'};
export async function ownLinkRequest():Promise<LinkRequest|null>{
  const scope=captureSession(),snap=await getDoc(teamDoc('linkRequests',scope.id));assertSession(scope);
  return snap.exists()?snap.data() as LinkRequest:null;
}
export async function verifyJoinCode(phrase:string):Promise<string>{
  const scope=captureSession(),joinKey=await digest(phrase);
  try{await setDoc(teamDoc('joinSessions',scope.id),{joinKey,createdAt:serverTimestamp()});assertSession(scope);}
  catch(error){if((error as {code?:string}).code==='permission-denied')throw new TeamError('合言葉を確認できませんでした。入力内容・受付期限・保存先の設定を確認してください。',403,'join_code_denied');throw error;}
  const team=await getTeam();
  assertSession(scope);
  if(!team?.name)throw new TeamError('チームがまだ作成されていません。');
  return team.name;
}
export async function loadJoinRoster():Promise<JoinPlayer[]>{
  const scope=captureSession();
  try{const result=await getDocs(query(teamCollection('players'),where('deletedAt','==',null)));assertSession(scope);return result.docs.map(d=>d.data() as JoinPlayer).filter(p=>!p.deletedAt);}
  catch(error){if((error as {code?:string}).code==='permission-denied')throw new TeamError('合言葉の確認後に名簿を取得できません。画面に対応する保存ルールを保守担当に確認してください。',403,'roster_access_denied');throw error;}
}
export async function requestPlayerLink(playerId:string,approverUid:string){
  const scope=captureSession();if(approverUid===scope.id)throw new TeamError('自分自身には確認を依頼できません。');
  const ref=teamDoc('linkRequests',scope.id);
  await runTransaction(db,async tx=>{
    const [m,r,p,session]=await Promise.all([tx.get(teamDoc('memberships',scope.id)),tx.get(ref),tx.get(memberRef(playerId)),tx.get(teamDoc('joinSessions',scope.id))]);
    assertSession(scope);
    if(m.exists()||r.exists())throw new TeamError('すでに登録または確認依頼があります。画面を更新してください。');
    if(!p.exists()||p.data().deletedAt||p.data().ownerUid!==null)throw new TeamError('この選手は現在選べません。名簿を確認し直してください。');
    if(!session.exists())throw new TeamError('部の合言葉を確認してください。');
    tx.set(ref,{uid:scope.id,playerId,playerName:p.data().name,approverUid,joinKey:session.data().joinKey,status:'pending',createdAt:serverTimestamp(),decidedAt:null});
  });assertSession(scope);
}
async function linkRequests(){
  const scope=captureSession();const result=await getDocs(query(teamCollection('linkRequests'),where('approverUid','==',scope.id)));assertSession(scope);
  return {requests:result.docs.map(d=>d.data() as LinkRequest).filter(r=>r.status==='pending')};
}
async function decideLink(requestUid:string,approve:boolean){
  const scope=captureSession(),ref=teamDoc('linkRequests',requestUid);
  await runTransaction(db,async tx=>{
    const r=await tx.get(ref);assertSession(scope);
    if(!r.exists()||r.data().status!=='pending'||r.data().approverUid!==scope.id||requestUid===scope.id)throw new TeamError('この確認依頼は処理できません。画面を更新してください。',409);
    const data=r.data();
    if(approve){
      const p=await tx.get(memberRef(data.playerId));assertSession(scope);
      if(!p.exists()||p.data().deletedAt||p.data().ownerUid!==null)throw new TeamError('選手情報が変更されたか、すでにアカウントと結び付いています。',409);
      tx.update(memberRef(data.playerId),{ownerUid:requestUid,version:p.data().version+1,updatedAt:serverTimestamp()});
      if(scope.teamId)tx.set(accountRef(requestUid),teamSlot(scope.teamId),{merge:true});
      tx.set(teamDoc('memberships',requestUid),{playerId:data.playerId,active:true,joinKey:data.joinKey,createdAt:serverTimestamp()});
    }
    tx.update(ref,{status:approve?'approved':'rejected',decidedAt:serverTimestamp()});
  });assertSession(scope);return {ok:true};
}
async function allMembers(){
  const scope=captureSession();
  const rows=await getDocs(memberSince?query(teamCollection('players'),where('updatedAt','>=',memberSince)):teamCollection('players'));
  assertSession(scope);
  for(const row of rows.docs){const value=row.data();memberRows.set(row.id,value as Member);if(value.updatedAt instanceof Timestamp&&(!memberSince||value.updatedAt.toMillis()>memberSince.toMillis()))memberSince=value.updatedAt;}
  membersCache=[...memberRows.values()];return membersCache;
}
async function bootstrap(){
  const scope=captureSession();
  const actor=await viewer();
  // Include tombstones in incremental reads, so deleted matches disappear without a full reload.
  const rows=await getDocs(since?query(teamCollection('matches'),where('updatedAt','>=',since)):teamCollection('matches'));
  assertSession(scope);
  for(const d of rows.docs){const row=decodeMatch(d.data());matchesCache.set(d.id,row);if(row.updatedAt instanceof Timestamp&&(!since||row.updatedAt.toMillis()>since.toMillis()))since=row.updatedAt;}
  const members=await allMembers();
  return {members,matches:[...matchesCache.values()].filter(m=>!m.deletedAt).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)),viewer:actor,today:japanDate(),currentSchoolYear:schoolYear(),updatedAt:new Date().toISOString()};
}
async function writeMember(body:Row,id?:string,operation='write'){
  const scope=captureSession(),target=memberRef(id||uuid());
  return runTransaction(db,async tx=>{
    const previousSnap=await tx.get(target),previous=previousSnap.exists()?previousSnap.data():null;
    if(id&&(!previous||previous.version!==version(body.version)))throw conflict();
    if(previous?.deletedAt&&operation==='write')throw new TeamError('削除済みの選手です。先に復元してください。',409);
    const input=operation==='write'?memberInput(body,previous as Member|undefined):previous!;
    const key=await digest(nameKey(input as Member));
    assertSession(scope);
    const keyRef=teamDoc('playerNames',key),named=await tx.get(keyRef);
    if(operation!=='delete'&&named.exists()&&named.data().playerId!==target.id)throw new TeamError('同じ名前・所属のメンバーが登録されています。',409);
    if(operation==='restore'&&!previous?.deletedAt)throw conflict();
    if(operation==='delete'&&previous?.deletedAt)throw conflict();
    assertSession(scope);
    if(previous?.nameLock&&previous.nameLock!==key){const oldRef=teamDoc('playerNames',previous.nameLock);await tx.get(oldRef);tx.delete(oldRef);}
    const data={...previous,...input,id:target.id,ownerUid:previous?.ownerUid??null,version:(previous?.version||0)+1,deletedAt:operation==='delete'?serverTimestamp():null,createdAt:previous?.createdAt??serverTimestamp(),updatedAt:serverTimestamp(),nameLock:key};
    tx.set(target,data);
    if(operation==='delete')tx.delete(keyRef);else tx.set(keyRef,{playerId:target.id,key:nameKey(input as Member)});
    return {member:data,ok:true};
  });
}
function publicInput(row:Row){return matchInput(row,membersCache,row as MatchInput);}
async function writeMatch(body:Row,id?:string,remove=false){
  const scope=captureSession(),actor=await viewer();await allMembers();
  assertSession(scope);
  const target=matchRef(id||body.id||'invalid');
  if(!id&&!/^[0-9a-f-]{36}$/i.test(target.id))throw new TeamError('保存用IDを確認してください。');
  return runTransaction(db,async tx=>{
    const snap=await tx.get(target),old=snap.exists()?decodeMatch(snap.data()):null;
    if(id&&(!old||old.deletedAt||old.version!==version(body.version)))throw conflict();
    const input=remove?publicInput(old!):matchInput(body,membersCache,old as MatchInput|undefined);
    if(!id&&old){if(!old.deletedAt&&JSON.stringify(publicInput(old))===JSON.stringify(input))return {match:old};throw conflict();}
    const canonical=fingerprint(input),key=await digest(canonical);
    assertSession(scope);
    const newRef=teamDoc('matchKeys',key),newSnap=await tx.get(newRef);
    assertSession(scope);
    const oldRef=old?.matchKey&&old.matchKey!==key?teamDoc('matchKeys',old.matchKey):null;
    const oldSnap=oldRef?await tx.get(oldRef):null;
    assertSession(scope);
    const ids:string[]=newSnap.data()?.ids||[];
    const separate=body.allowDuplicate===true||old?.separate===true;
    if(!remove&&!separate&&old?.canonical!==canonical&&ids.some(value=>value!==target.id))throw new TeamError('同じ日・選手・得点の試合が記録されています。別の試合であれば、確認して保存できます。',409,'duplicate_match');
    const snapshots:Row={};
    for(const playerId of [...input.sideAIds,...input.sideBIds]){
      if(old?.date===input.date&&[...old.sideAIds,...old.sideBIds].includes(playerId)){if(old.memberSnapshots?.[playerId])snapshots[playerId]=old.memberSnapshots[playerId];}
      else snapshots[playerId]=memberSnapshot(membersCache.find(p=>p.id===playerId)!,input.date);
    }
    const data={...input,id:target.id,memberSnapshots:remove?old!.memberSnapshots:snapshots,canonical,matchKey:key,separate,version:(old?.version||0)+1,createdBy:old?.createdBy??actor.id,createdByName:old?.createdByName??actor.name,createdAt:old?.createdAt??serverTimestamp(),updatedBy:actor.id,updatedAt:serverTimestamp(),deletedAt:remove?serverTimestamp():null};
    if(oldRef)tx.set(oldRef,{ids:(oldSnap?.data()?.ids||[]).filter((value:string)=>value!==target.id),canonical:old!.canonical});
    tx.set(newRef,{ids:remove?ids.filter(value=>value!==target.id):[...new Set([...ids,target.id])],canonical});
    tx.set(target,encodeMatch(data));
    return {match:data,ok:true};
  });
}
function participates(match:Row|null,playerId:string|null){return Boolean(match&&!match.deletedAt&&playerId&&[...match.sideAIds,...match.sideBIds].includes(playerId));}
async function contextOf(match:Row){
  if(!membersCache.length)await allMembers();
  const name=(id:string)=>membersCache.find(p=>p.id===id)?.name||'登録済みの選手';
  return {date:match.date,category:match.category,event:match.event,discipline:match.discipline,sideA:match.sideAIds.map(name),sideB:match.opponentType==='internal'?match.sideBIds.map(name):match.opponents,scores:match.scores};
}
async function feedback(id:string,method:string,body:Row):Promise<Row>{
  const scope=captureSession(),actor=await viewer();
  assertSession(scope);
  const ref=feedbackRef(actor.id,id),target=matchRef(id);
  if(method==='GET'){
    const [f,m]=await Promise.all([getDoc(ref),getDoc(target)]);const match=m.exists()?decodeMatch(m.data()):null;
    if(f.exists())return {feedback:f.data(),context:decodeMatch(f.data().context),archived:!match||Boolean(match.deletedAt),canCreate:false};
    if(!participates(match,actor.memberId))throw new TeamError('出場した本人だけが振り返りを書けます。',403);
    return {feedback:null,context:await contextOf(match!),archived:false,canCreate:true};
  }
  if(!membersCache.length)await allMembers();
  assertSession(scope);
  await runTransaction(db,async tx=>{
    const [f,m]=await Promise.all([tx.get(ref),tx.get(target)]),old=f.exists()?f.data():null;
    if((old?.version??0)!==body.version)throw conflict();
    if(method==='DELETE'){if(!old)throw conflict();tx.delete(ref);return;}
    if(!old&&!participates(m.exists()?m.data():null,actor.memberId))throw new TeamError('出場した本人だけが振り返りを書けます。',403);
    assertSession(scope);
    const context=old?.context??encodeMatch(await contextOf(decodeMatch(m.data()!)));
    const fields:Row={};for(const key of ['goodPoints','improvements','nextAction']){if(typeof body[key]!=='string'||Array.from(body[key]).length>1000)throw new TeamError('各欄は1000文字以内で入力してください。');fields[key]=body[key].trim();}
    if(!Object.values(fields).some(Boolean))throw new TeamError('いずれかの欄に振り返りを入力してください。');
    tx.set(ref,{...fields,matchId:id,ownerId:actor.id,ownerMemberId:actor.memberId,context,version:(old?.version??0)+1,createdAt:old?.createdAt??serverTimestamp(),updatedAt:serverTimestamp()});
  });
  return method==='DELETE'?{ok:true}:feedback(id,'GET',{});
}
let journalCursor:QueryDocumentSnapshot|null=null;
async function journal(more:boolean){
  const scope=captureSession(),id=scope.id;if(!more)journalCursor=null;
  const base=[orderBy('updatedAt','desc'),orderBy('__name__','desc'),limit(20)];
  const result=await getDocs(query(teamCollection('privateUsers',id,'feedback'),...base,...(journalCursor?[startAfter(journalCursor)]:[])));
  assertSession(scope);
  journalCursor=result.docs.at(-1)??journalCursor;
  const feedback=await Promise.all(result.docs.map(async d=>{const row=d.data(),m=await getDoc(matchRef(row.matchId));return {goodPoints:row.goodPoints,improvements:row.improvements,nextAction:row.nextAction,matchId:row.matchId,context:decodeMatch(row.context),version:row.version,updatedAt:row.updatedAt?.toDate().toISOString(),archived:!m.exists()||Boolean(m.data()?.deletedAt),people:m.exists()?matchPeople({sideAIds:m.data()!.sideAIds,sideBIds:m.data()!.sideBIds,opponentType:m.data()!.opponentType,opponents:m.data()!.opponents},row.ownerMemberId):null};}));
  return {feedback,hasMore:result.size===20};
}
async function latestFeedbackGoal(){
  const scope=captureSession();let cursor:QueryDocumentSnapshot|null=null;
  while(true){
    const result:QuerySnapshot=await getDocs(query(teamCollection('privateUsers',scope.id,'feedback'),orderBy('context.date','desc'),orderBy('__name__','desc'),limit(20),...(cursor?[startAfter(cursor)]:[])));
    assertSession(scope);
    for(const note of result.docs){const row=note.data();if(typeof row.nextAction==='string'&&row.nextAction.trim())return {goal:{matchId:row.matchId,date:row.context.date,nextAction:row.nextAction}};}
    if(result.size<20)return {goal:null};cursor=result.docs[result.docs.length-1];
  }
}
export async function firebaseRequest<T>(url:string,method:string,raw?:unknown):Promise<T>{
  if(!unlocked)throw new TeamError('4桁PINでロックを解除してください。',401);
  const scope=captureSession();
  const body=(raw||{}) as Row;let value:unknown;
  try{
    if(url==='/api/link-requests'&&method==='GET')value=await linkRequests();
    else if(/^\/api\/link-requests\/[^/]+$/.test(url)&&method==='POST'){
      if(typeof body.approve!=='boolean')throw new TeamError('確認結果を選んでください。');
      value=await decideLink(decodeURIComponent(url.split('/')[3]),body.approve);
    }
    else if(url==='/api/team'&&method==='GET')value=await bootstrap();
    else if(url==='/api/feedback-goal'&&method==='GET')value=await latestFeedbackGoal();
    else if(url.startsWith('/api/feedback')&&method==='GET')value=await journal(url.includes('more=1'));
    else if(/^\/api\/matches\/[^/]+\/feedback$/.test(url))value=await feedback(decodeURIComponent(url.split('/')[3]),method,body);
    else if(url==='/api/members'&&method==='POST')value=await writeMember(body);
    else if(/^\/api\/members\/[^/]+(?:\/restore)?$/.test(url))value=await writeMember(body,url.split('/')[3],url.endsWith('/restore')?'restore':method==='DELETE'?'delete':'write');
    else if(url==='/api/matches'&&method==='POST')value=await writeMatch(body);
    else if(/^\/api\/matches\/[^/]+$/.test(url))value=await writeMatch(body,url.split('/')[3],method==='DELETE');
    else throw new TeamError('この操作には対応していません。');
    assertSession(scope);
    if(!unlocked)throw new TeamError('ロックされています。',401);
    return value as T;
  }catch(error){
    if(error instanceof TeamError)throw error;
    const code=(error as {code?:string}).code;
    if(code==='permission-denied')throw new TeamError('このデータを操作する権限がありません。参加登録と接続を確認してください。',403);
    if(code==='failed-precondition'&&/index/i.test((error as {message?:string}).message||''))throw new TeamError('日付検索に必要な保存先の設定がまだ反映されていません。保守担当にお知らせください。',503,'query_index_missing');
    if(code==='resource-exhausted')throw new TeamError('無料枠の利用上限に達しました。時間をおいて再度お試しください。',429);
    if(code==='aborted')throw conflict();
    throw new TeamError('保存先に接続できません。入力を残したまま、接続を確認してください。',503);
  }
}
