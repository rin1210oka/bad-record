import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged,signOut,setPersistence,browserLocalPersistence,type User} from 'firebase/auth';
import {auth,configured} from './firebase';
import {firebaseRequest,setUnlocked,membership,viewer as loadViewer,joinTeam,getTeam,createCommunity,findTeamByCode,verifyJoinCode,listTeams,selectTeam,TEAM_LIMIT,type TeamSummary} from './store';
import {hasDevicePin,setDevicePin,verifyDevicePin} from './pin';
import {createEmailAccount,loginWithEmail,passwordSession,checkEmailVerification,resendVerification,reauthenticateEmail,sendRecoveryEmail} from './email-auth';
import {installClientBackend} from '../lib/client-backend';
import TeamApp,{MemberForm} from '../app/team-app';
import JoinChoice from '../app/join-choice';
import {AccessContext,type AccessViewer} from '../app/access-context';
import {accessErrorMessage as message} from './errors';
import '../app/globals.css';
import '../app/access.css';
import './style.css';

type Step='entry'|'create'|'founderProfile'|'teamCode'|'ready'|'loading'|'configuration'|'login'|'verify'|'join'|'setupPin'|'unlock'|'reauth'|'error';
const teamHistoryKey='shuttle-note:recent-team:v2:' + auth.app.options.projectId;

function rememberTeam(team:TeamSummary){
  try{localStorage.setItem(teamHistoryKey,JSON.stringify({id:team.id,name:team.name}));}catch{/* Browser storage is optional. */}
}
function readRecentTeam():TeamSummary|null{
  try{
    const data=JSON.parse(localStorage.getItem(teamHistoryKey)??'null');
    return typeof data?.id==='string'&&typeof data?.name==='string'?data:null;
  }catch{return null;}
}

function Gate(){
  const [user,setUser]=useState<User|null>(null),[viewer,setViewer]=useState<AccessViewer|null>(null);
  const [step,setStep]=useState<Step>('loading'),[phrase,setPhrase]=useState(''),[pin,setPin]=useState(''),[confirmPin,setConfirmPin]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [authMode,setAuthMode]=useState<'login'|'register'|'reset'>('login'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[failures,setFailures]=useState(0);
  const freshLogin=useRef<string|null>(null),active=useRef(false),sequence=useRef(0),phase=useRef(step),accountMenu=useRef<HTMLDetailsElement>(null);
  const [teamName,setTeamName]=useState(''),[profileOpen,setProfileOpen]=useState(false);
  const [teams,setTeams]=useState<TeamSummary[]>([]),[recentTeam,setRecentTeam]=useState(readRecentTeam);
  const [joiningTeam,setJoiningTeam]=useState<TeamSummary|null>(null);
  const intent=useRef<'create'|'join'|null>(null);
  const intendedTeam=useRef<string|null>(null);
  const currentTeamId=useRef<string|null>(null);
  const submittingCredentials=useRef(false);
  phase.current=step;
  function clearPasswords(){setPassword('');setConfirmation('');}
  function lock(){active.current=false;setUnlocked(false);clearPasswords();setPin('');setConfirmPin('');setFailures(0);setStep('unlock');}
  async function openTeam(team:TeamSummary){
    const current=auth.currentUser;
    if(!current)return;
    const token=++sequence.current;
    selectTeam(team.id);
    currentTeamId.current=team.id;
    active.current=false;
    setViewer(null);setError('');setPin('');setConfirmPin('');setFailures(0);
    setStep('loading');
    try{
      const m=await membership();
      if(token!==sequence.current||current.uid!==auth.currentUser?.uid)return;
      if(!m&&team.ownerUid===current.uid){
        setTeamName(team.name);setStep('founderProfile');
        return;
      }
      if(!m?.active)throw new Error('このチームの参加登録を確認してください。');
      const v=await loadViewer();
      if(token!==sequence.current||current.uid!==auth.currentUser?.uid)return;
      setViewer(v);
      setStep(hasDevicePin(current.uid)?'unlock':freshLogin.current===current.uid?'setupPin':'reauth');
    }catch(e){if(token===sequence.current){setError(message(e,'membership'));setStep('error');}}
  }
  async function route(current:User|null){
    if((current?.uid??null)!==(auth.currentUser?.uid??null))return;
    const token=++sequence.current;
    active.current=false;
    selectTeam(null);
    setUser(current);setViewer(null);setError('');clearPasswords();
    setTeams([]);setJoiningTeam(null);
    if(!current){setStep('entry');return;}
    setEmail(current.email||'');setStep('loading');
    try{
      const isPassword=await passwordSession(current);
      if(token!==sequence.current||current.uid!==auth.currentUser?.uid)return;
      if(!isPassword){await signOut(auth);return;}
      if(!current.emailVerified){setStep('verify');return;}
      const currentTeams=await listTeams();
      if(token!==sequence.current||current.uid!==auth.currentUser?.uid)return;
      setTeams(currentTeams);
      const requested=currentTeams.find(team=>team.id===intendedTeam.current);
      intendedTeam.current=null;
      const next=intent.current;
      intent.current=null;
      if(requested){await openTeam(requested);return;}
      if(next&&currentTeams.length>=TEAM_LIMIT){
        setError('所属できるのは3チームまでです。');
        setStep('entry');return;
      }
      setStep(next==='create'?'create':next==='join'?'teamCode':'entry');
    }catch(e){if(token===sequence.current){setError(message(e,'membership'));setStep('error');}}
  }
  async function logout(){intent.current=null;intendedTeam.current=null;sequence.current++;active.current=false;freshLogin.current=null;setUnlocked(false);setViewer(null);setPhrase('');setPin('');clearPasswords();setNotice('');setProfileOpen(false);setTeamName('');await signOut(auth);}
  useEffect(()=>{
    if(!configured){setStep('configuration');return;}
    const unsubscribe=onAuthStateChanged(auth,current=>{
      if(!submittingCredentials.current)void route(current);
    });
    return()=>{sequence.current++;unsubscribe();active.current=false;setUnlocked(false);};
  },[]);
  useEffect(()=>{
    installClientBackend(async<T,>(url:string,method:string,body?:unknown)=>{
      if((phase.current==='join'||phase.current==='founderProfile')&&url==='/api/members'&&method==='POST'){
        try{await joinTeam(phase.current==='founderProfile'?null:phrase,body as Record<string,unknown>);const v=await loadViewer();setViewer(v);setPhrase('');return {member:{id:v.memberId}} as T;}
        catch(e){throw new Error(message(e,'registration'));}
      }
      if(!active.current)throw new Error('4桁PINでロックを解除してください。');
      return firebaseRequest<T>(url,method,body);
    });
  },[phrase]);
  useEffect(()=>{
    const reset=(event:StorageEvent)=>{if(user&&event.key==='shuttle-note:device-pin:v1:'+user.uid&&phase.current==='ready')lock();};
    const expired=()=>{sequence.current++;active.current=false;setUnlocked(false);clearPasswords();setStep('error');setError('入場状態を確認してください。メールとパスワードでログインし直せます。');};
    window.addEventListener('storage',reset);window.addEventListener('access-expired',expired);
    return()=>{window.removeEventListener('storage',reset);window.removeEventListener('access-expired',expired);};
  },[user]);
  useEffect(()=>{
    if(step!=='ready')return;
    const closeOutside=(event:PointerEvent)=>{if(event.target instanceof Node&&accountMenu.current&&!accountMenu.current.contains(event.target))accountMenu.current.open=false;};
    const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&accountMenu.current?.open){event.preventDefault();accountMenu.current.open=false;accountMenu.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',closeOutside);document.addEventListener('keydown',closeEscape);
    return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape);};
  },[step]);
  function changeMode(mode:typeof authMode){setAuthMode(mode);clearPasswords();setError('');setNotice('');}
  function openAccountForm(mode:'login'|'register',action:'create'|'join'|null=null,teamId:string|null=null){
    intent.current=action;
    intendedTeam.current=teamId;
    setPhrase('');setTeamName('');setEmail('');
    changeMode(mode);
    setStep('login');
  }
  function openRecentTeam(team:TeamSummary){
    if(user&&auth.currentUser?.uid===user.uid){void openTeam(team);return;}
    openAccountForm('login',null,team.id);
  }
  function beginTeamAction(action:'create'|'join'){
    if(teams.length>=TEAM_LIMIT)return;
    openAccountForm(user?'login':'register',action);
  }
  async function submitLookup(event:React.FormEvent){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    const token=sequence.current;
    try{
      const id=await findTeamByCode(phrase);
      if(token!==sequence.current)return;
      const existing=teams.find(team=>team.id===id);
      if(existing){setNotice('すでに参加しているチームです。');await openTeam(existing);return;}
      selectTeam(id);
      const name=await verifyJoinCode(phrase);
      if(token!==sequence.current)return;
      setJoiningTeam({id,name});
      setStep('join');
    }catch(e){if(token===sequence.current)setError(message(e));}
    finally{setBusy(false);}
  }
  async function finishOnboarding(team:TeamSummary){
    try{
      const currentTeams=await listTeams();
      setTeams(currentTeams);
      setPhrase('');
      setNotice('チームに参加しました。');
      await openTeam(team);
    }catch(e){setError(message(e));}
  }
  async function submitCredentials(event:React.FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
    submittingCredentials.current=true;
    try{
      await setPersistence(auth,browserLocalPersistence);
      if(authMode==='reset'){await sendRecoveryEmail(auth,email);setNotice('登録されている場合は、パスワード再設定のメールを送信しました。');return;}
      const current=authMode==='register'?await createEmailAccount(auth,email,password,confirmation):await loginWithEmail(auth,email,password);
      freshLogin.current=current.uid;
      if(authMode==='register')setNotice('確認メールを送信しました。メール内のリンクを開いてください。');
      await route(current);
    }catch(e){
      freshLogin.current=null;
      const current=auth.currentUser;
      if(authMode==='register'&&current&&current.uid!==user?.uid&&!current.emailVerified)await route(current);
      setError(message(e));
    }finally{submittingCredentials.current=false;clearPasswords();setBusy(false);}
  }
  async function verifyEmail(resend=false){
    if(!auth.currentUser||busy)return;setBusy(true);setError('');setNotice('');
    try{if(resend){await resendVerification(auth.currentUser);setNotice('確認メールを再送しました。');}
      else if(await checkEmailVerification(auth.currentUser)){setNotice('メールアドレスを確認できました。');await route(auth.currentUser);}
      else setError('メールの確認がまだ完了していません。確認メールのリンクを開いてから、もう一度お試しください。');
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  async function submitTeam(event:React.FormEvent){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const team=await createCommunity(teamName,phrase);
      setTeams(current=>[...current,team]);
      setPhrase('');
      await openTeam(team);
    }catch(e){setError(message(e));}
    finally{setBusy(false);}
  }
  async function submitReauth(event:React.FormEvent){
    event.preventDefault();if(!auth.currentUser||busy)return;setBusy(true);setError('');
    const current=auth.currentUser,token=sequence.current;
    try{await reauthenticateEmail(current,password);if(token!==sequence.current||current.uid!==auth.currentUser?.uid)return;freshLogin.current=current.uid;setPin('');setConfirmPin('');setStep('setupPin');}
    catch(e){setError(message(e));}finally{clearPasswords();setBusy(false);}
  }
  async function submitPin(event:React.FormEvent){
    event.preventDefault();if(!user||busy)return;const token=sequence.current,id=user.uid;setBusy(true);setError('');
    try{
      if(id!==auth.currentUser?.uid)throw new Error('入場状態が変わりました。もう一度確認してください。');
      if(!/^\d{4}$/.test(pin))throw new Error('数字4桁で入力してください。');
      if(step==='setupPin'){
        if(freshLogin.current!==user.uid)throw new Error('アプリ用パスワードで再認証してください。');
        if(pin!==confirmPin)throw new Error('確認用のPINが一致していません。');
        await setDevicePin(user.uid,pin);
      }else{
        if(failures>=5)throw new Error('アプリ用パスワードで再認証してPINを設定し直してください。');
        if(!await verifyDevicePin(user.uid,pin)){setFailures(n=>n+1);throw new Error('PINが違います。忘れた場合はアプリ用パスワードで再設定できます。');}
      }
      if(token!==sequence.current||id!==auth.currentUser?.uid)throw new Error('入場状態が変わりました。もう一度確認してください。');
      const v=await loadViewer();
      if(token!==sequence.current||id!==auth.currentUser?.uid)throw new Error('入場状態が変わりました。もう一度確認してください。');
      if(v.teamHistoryId&&v.teamName){
        const team={id:v.teamHistoryId,name:v.teamName};
        rememberTeam(team);
        setRecentTeam(team);
      }
      setViewer(v);active.current=true;setUnlocked(true);setPin('');setConfirmPin('');setPhrase('');clearPasswords();setStep('ready');freshLogin.current=null;
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  const accountControls=<div className="firebase-account">
    <div className="firebase-account-identity">
      {viewer?.teamName&&<div className="firebase-account-name firebase-account-team">
        <small>入場中のチーム</small>
        <strong>{viewer.teamName}</strong>
      </div>}
      <div className="firebase-account-name">
        <small>入場中のアカウント</small>
        <strong>{viewer?.name}<span> さん</span></strong>
      </div>
    </div>
    <details className="firebase-account-menu" ref={accountMenu}><summary aria-label="アカウントのメニュー"><span aria-hidden="true">•••</span></summary><div className="firebase-account-actions"><button className="text-button" onClick={()=>void route(auth.currentUser)}>チーム選択に戻る</button><button className="text-button" onClick={()=>{if(accountMenu.current)accountMenu.current.open=false;if(confirm('未保存の入力は失われます。ロックしますか？'))lock();}}>ロック</button><button className="text-button" onClick={()=>{if(accountMenu.current)accountMenu.current.open=false;if(confirm('未保存の入力は失われます。ログアウトしますか？'))void logout().catch(e=>setError(message(e)));}}>ログアウト</button></div></details></div>;
  if(step==='ready'&&viewer)return <AccessContext.Provider value={{viewer,controls:accountControls}}><TeamApp key={viewer.teamHistoryId??viewer.id}/></AccessContext.Provider>;
  const pinField=(label:string,value:string,change:(value:string)=>void)=><label>{label}<input className="access-pin" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete="off" value={value} onChange={e=>change(e.target.value.replace(/[^0-9]/g,''))}/></label>;
  const passwordField=(label:string,value:string,change:(value:string)=>void,newPassword=false)=><label>{label}<input type="password" required minLength={newPassword?8:undefined} autoComplete={newPassword?'new-password':'current-password'} value={value} onChange={e=>change(e.target.value)}/></label>;
  return <div className="access-shell"><div className="access-brand"><span className="access-brand-symbol" aria-hidden="true">↗</span><span>Shuttle Note<small>TEAM MATCH JOURNAL</small></span></div><div className="access-layout"><div className="access-court" aria-hidden="true"><span/><i/></div><section className="access-card" aria-label="チームへの入場">
    <span className="access-step">YOUR TEAM, YOUR JOURNAL</span>{configured&&import.meta.env.DEV&&<p className="access-notice" role="status">公開先のFirebaseに接続しています。確認メールは入力したアドレスに届きます。</p>}
    {step==='loading'?<p role="status">入場情報を確認しています…</p>:step==='configuration'?<><h2>公開の準備中です</h2><p>チームの接続設定が済むと利用できます。記録はまだ送信されません。</p></>:step==='entry'?<>
      <h2>{user?'所属チーム':'チームの入口'}</h2>
      {user&&<p className="access-description">所属チーム {teams.length}/{TEAM_LIMIT}</p>}
      {recentTeam&&(!user||teams.some(team=>team.id===recentTeam.id))&&
        <button className="secondary access-submit recent-team" onClick={()=>openRecentTeam(teams.find(team=>team.id===recentTeam.id)??recentTeam)}>
          <span>前回利用したチーム</span><strong>{recentTeam.name}</strong>
        </button>}
      {teams.filter(team=>team.id!==recentTeam?.id).map(team=>
        <button className="secondary access-submit recent-team" key={team.id} onClick={()=>openRecentTeam(team)}>{team.name}</button>
      )}
      <button className="primary access-submit" disabled={teams.length>=TEAM_LIMIT} onClick={()=>beginTeamAction('join')}>チームに参加する</button>
      <button className="secondary access-submit" disabled={teams.length>=TEAM_LIMIT} onClick={()=>beginTeamAction('create')}>チームを作成する</button>
      {teams.length>=TEAM_LIMIT&&<p className="access-help">所属できるのは3チームまでです。</p>}
      {!user&&<button className="text-button" onClick={()=>openAccountForm('login')}>登録済みの方はログイン</button>}
    </>:step==='teamCode'?<>
      <h2>チームに参加する</h2>
      <form className="access-form" onSubmit={submitLookup}>
        <label>チームコード<input required type="password" maxLength={200} autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)}/></label>
        <button className="primary access-submit" disabled={busy}>{busy?'確認中…':'チームコードを送信'}</button>
      </form>
      <button className="text-button" onClick={()=>void route(auth.currentUser)}>チーム選択に戻る</button>
    </>:step==='create'?<>
      <h2>チームを作成する</h2>
      <form className="access-form" onSubmit={submitTeam}>
        <label>チーム名<input disabled={busy} required maxLength={60} value={teamName} onChange={e=>setTeamName(e.target.value)}/></label>
        <label>参加用のチームコード<input disabled={busy} type="password" required minLength={8} maxLength={200} autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)}/></label>
        <p className="access-help">部員に配るコードを8文字以上で決めてください。新規参加の受付期間は1年間です。</p>
        <button className="primary access-submit" disabled={busy||!teamName.trim()||!phrase.trim()}>{busy?'作成中…':'チームを作成する'}</button>
      </form>
    </>:step==='founderProfile'?<>
      <h2>チームを作成しました</h2>
      <p className="join-selected"><strong>{teamName}</strong></p>
      <button className="primary access-submit" onClick={()=>setProfileOpen(true)}>自分を名簿に登録する</button>
      {profileOpen&&<MemberForm member={null} onClose={()=>setProfileOpen(false)} onSaved={()=>{setProfileOpen(false);const team=teams.find(item=>item.id===currentTeamId.current);if(team)void finishOnboarding(team);else void route(auth.currentUser);}}/>}
    </>:step==='login'?<>
      <h2>{authMode==='register'?'アカウントを作成':authMode==='reset'?'パスワードを再設定':'メールとパスワードでログイン'}</h2>
      <p className="access-description">{authMode==='register'?'初回だけメールを受信して確認します。学校メールのパスワードとは別に、アプリ用のパスワードを設定してください。':authMode==='reset'?'登録したメールを受信できる場合に利用できます。卒業後など受信できない場合は、保守担当に相談してください。':'登録したメールアドレスとアプリ用パスワードを入力してください。通常のログインでメールの受信は不要です。'}</p>
      <form className="access-form" onSubmit={submitCredentials}><fieldset disabled={busy}><label>メールアドレス<input type="email" required autoComplete="username" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>{authMode!=='reset'&&passwordField('アプリ用パスワード',password,setPassword,authMode==='register')}{authMode==='register'&&<>{passwordField('確認用パスワード',confirmation,setConfirmation,true)}<p className="access-help">8文字以上。端末用の4桁PINとは別のパスワードです。</p></>}</fieldset><button className="primary access-submit" disabled={busy}>{busy?'確認しています…':authMode==='register'?'登録して確認メールを送る':authMode==='reset'?'再設定メールを送る':'ログイン'}</button></form>
      <div className="email-auth-links">{authMode!=='login'&&<button className="text-button" disabled={busy} onClick={()=>changeMode('login')}>ログインに戻る</button>}{authMode==='login'&&<><button className="text-button" disabled={busy} onClick={()=>changeMode('register')}>初めての方・アカウントを作成</button><button className="text-button" disabled={busy} onClick={()=>changeMode('reset')}>パスワードを忘れた</button></>}<button className="text-button" disabled={busy} onClick={()=>{clearPasswords();setError('');setNotice('');setStep('entry');}}>入口に戻る</button></div>
    </>:step==='verify'?<><h2>メールアドレスを確認</h2><p className="access-description"><strong className="access-email">{user?.email}</strong>へ届いた確認メールのリンクを開いてください。確認が完了するまで記録は閲覧できません。</p><button className="primary access-submit" disabled={busy} onClick={()=>void verifyEmail()}>メールを確認したので次へ</button><button className="text-button firebase-reset" disabled={busy} onClick={()=>void verifyEmail(true)}>確認メールを再送</button><p className="access-help">初回の確認後、通常のログインではメール受信は不要です。</p></>:step==='join'&&joiningTeam?<JoinChoice key={joiningTeam.id+user?.uid} userUid={user?.uid||''} teamName={joiningTeam.name} onBackToLookup={()=>{setJoiningTeam(null);setPhrase('');setStep('teamCode');}}
      onJoined={()=>finishOnboarding(joiningTeam)}/>:step==='setupPin'||step==='unlock'?<><h2>{step==='setupPin'?'この端末の4桁PINを作成':'4桁PINでロック解除'}</h2><p className="access-description">{viewer?.teamName&&<strong className="access-team-name">{viewer.teamName}</strong>}{viewer?.name}さんの記録。PINはこの端末の簡易ロックです。</p><form className="access-form" onSubmit={submitPin}><fieldset disabled={busy||step==='unlock'&&failures>=5}>{pinField('4桁PIN',pin,setPin)}{step==='setupPin'&&pinField('もう一度入力',confirmPin,setConfirmPin)}</fieldset><button className="primary access-submit" disabled={busy||step==='unlock'&&failures>=5}>{busy?'確認しています…':step==='setupPin'?'PINを設定して利用開始':'ロックを解除'}</button></form>{step==='unlock'&&<button className="text-button firebase-reset" disabled={busy} onClick={()=>{clearPasswords();setError('');setStep('reauth');}}>PINを忘れた・変更する（アプリ用パスワードで確認）</button>}<p className="access-help">個人端末の画面ロックと併用してください。共用端末ではログアウトしてください。</p></>:step==='reauth'?<><h2>アプリ用パスワードで確認</h2><p className="access-description"><strong className="access-email">{user?.email}</strong>のパスワードで、この端末のPINを設定し直せます。</p><form className="access-form" onSubmit={submitReauth}><fieldset disabled={busy}>{passwordField('アプリ用パスワード',password,setPassword)}</fieldset><button className="primary access-submit" disabled={busy}>確認してPINを設定</button></form></>:<><h2>入場を確認してください</h2><button className="primary access-submit" onClick={()=>void route(auth.currentUser)}>入場情報を再確認</button></>}
    {notice&&<p className="access-notice" role="status">{notice}</p>}{error&&<p className="access-error" role="alert">{error}</p>}{user&&step!=='loading'&&<button className="text-button firebase-reset" disabled={busy} onClick={()=>void logout()}>別のアカウントを使う・ログアウト</button>}
  </section></div><footer className="access-footer">SHUTTLE NOTE <span>記録が、次の一歩になる。</span></footer></div>;
}
const root=import.meta.hot?.data.root??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.root=root;
root.render(<Gate/>);
