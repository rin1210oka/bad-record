import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,applyActionCode,getIdTokenResult,signOut,confirmPasswordReset} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,getDoc,getDocs,collection,Timestamp} from 'firebase/firestore';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
const encode=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const api=await import(encode(compile('firebase-web/email-auth.ts').replaceAll("'firebase/auth'",JSON.stringify(import.meta.resolve('firebase/auth')))));
const hash=s=>createHash('sha256').update(s).digest('hex');
const phrase='email-auth-test-phrase',password='App-password-for-test-42';
let env,app,auth,db,store;
async function codes(email){const r=await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-shuttle-note/oobCodes');assert.equal(r.ok,true);return (await r.json()).oobCodes.filter(c=>c.email===email);}
async function verify(user){const code=(await codes(user.email)).filter(c=>c.requestType==='VERIFY_EMAIL').at(-1);assert.ok(code);await applyActionCode(auth,code.oobCode);assert.equal(await api.checkEmailVerification(user),true);}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-shuttle-note',firestore:{rules:fs.readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8080}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearFirestore();app=initializeApp({projectId:'demo-shuttle-note',apiKey:'emulator-only',authDomain:'localhost'},'email-test-'+crypto.randomUUID());auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8080);globalThis.__emailStore={db,auth};const names=encode(compile('lib/member-name.ts')),cohort=encode(compile('lib/member-cohort.ts')),domain=encode(compile('lib/team-domain.ts').replaceAll("'./member-name'",JSON.stringify(names)).replaceAll("'./member-cohort'",JSON.stringify(cohort))),search=encode(compile('lib/match-search.ts').replaceAll("'./member-name'",JSON.stringify(names))),codec=encode(compile('firebase-web/codec.ts')),firebase=encode('export const db=globalThis.__emailStore.db;export const auth=globalThis.__emailStore.auth; //'+crypto.randomUUID());store=await import(encode(compile('firebase-web/store.ts').replaceAll("'firebase/firestore'",JSON.stringify(import.meta.resolve('firebase/firestore'))).replaceAll("'./firebase'",JSON.stringify(firebase)).replaceAll("'../lib/team-domain'",JSON.stringify(domain)).replaceAll("'../lib/member-cohort'",JSON.stringify(cohort)).replaceAll("'./codec'",JSON.stringify(codec)).replaceAll("'../lib/match-search'",JSON.stringify(search)))+'#'+crypto.randomUUID());await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'team','current'),{name:'テスト部',createdAt:Timestamp.now()});
  await setDoc(doc(c.firestore(),'joinKeys',hash(phrase)),{enabled:true,expiresAt:Timestamp.fromMillis(Date.now()+86400000)});
});});
afterEach(async()=>{store?.setUnlocked(false);await signOut(auth);await deleteApp(app);delete globalThis.__emailStore;});
const address=()=>crypto.randomUUID()+'@school.example';
const profile={name:'アオキ',group:'',status:'active',hasTeamHistory:true,stageMode:'cohort',cohortYear:2026,generation:80};
test('初回メール確認前は参加も閲覧もできず、確認後は自己登録と本人のフィードバックを保存できる',async()=>{const user=await api.createEmailAccount(auth,address(),password,password);assert.equal(user.emailVerified,false);assert.equal(await api.passwordSession(user),true);await assertFails(getDocs(collection(db,'players')));await assertFails(getDocs(collection(db,'matches')));await assertFails(getDocs(collection(db,'privateUsers',user.uid,'feedback')));await assert.rejects(store.joinTeam(phrase,profile));await verify(user);await store.joinTeam(phrase,profile);store.setUnlocked(true);const data=await store.firebaseRequest('/api/team','GET');assert.equal(data.viewer.memberId,'self-'+user.uid);const {member}=await store.firebaseRequest('/api/members','POST',{...profile,name:'イノウエ',hasTeamHistory:false});const id=crypto.randomUUID();await store.firebaseRequest('/api/matches','POST',{id,date:'2026-11-12',category:'ゲーム練',event:'',discipline:'シングルス',opponentType:'internal',sideAIds:[data.viewer.memberId],sideBIds:[member.id],opponents:[],scores:[[15,9]],memo:''});await store.firebaseRequest('/api/matches/'+id+'/feedback','PUT',{version:0,goodPoints:'自分だけの文章',improvements:'',nextAction:''});assert.equal((await store.firebaseRequest('/api/matches/'+id+'/feedback','GET')).feedback.goodPoints,'自分だけの文章');const m=await getDoc(doc(db,'memberships',user.uid));assert.equal(m.data().playerId,'self-'+user.uid);});
test('確認済み学校メールは再ログインで受信確認を要求せず、UIDと参加情報が変わらない',async()=>{const email=address(),user=await api.createEmailAccount(auth,email,password,password);await verify(user);await store.joinTeam(phrase,profile);const uid=user.uid,count=(await codes(email)).length;await signOut(auth);const again=await api.loginWithEmail(auth,email,password);assert.equal(again.uid,uid);assert.equal(again.emailVerified,true);assert.equal((await getIdTokenResult(again)).claims.firebase.sign_in_provider,'password');assert.equal((await codes(email)).length,count);assert.equal((await store.membership()).playerId,'self-'+uid);});
test('間違ったパスワード・短い新パスワード・確認不一致では登録や再認証を進めない',async()=>{const email=address();await assert.rejects(api.createEmailAccount(auth,email,'1234','1234'),/8文字/);await assert.rejects(api.createEmailAccount(auth,email,password,'different'),/一致/);assert.equal(auth.currentUser,null);const user=await api.createEmailAccount(auth,email,password,password);await verify(user);await assert.rejects(api.reauthenticateEmail(user,'wrong-password'));await api.reauthenticateEmail(user,password);await signOut(auth);await assert.rejects(api.loginWithEmail(auth,email,'wrong-password'));});
test('登録メールを受信できる場合の再設定は同じUIDを維持し、古いパスワードを使えなくする',async()=>{const email=address(),user=await api.createEmailAccount(auth,email,password,password);await verify(user);const uid=user.uid;await signOut(auth);await api.sendRecoveryEmail(auth,email);const reset=(await codes(email)).filter(c=>c.requestType==='PASSWORD_RESET').at(-1);assert.ok(reset);const changed='Changed-app-password-43';await confirmPasswordReset(auth,reset.oobCode,changed);await assert.rejects(api.loginWithEmail(auth,email,password));assert.equal((await api.loginWithEmail(auth,email,changed)).uid,uid);});

test('旧Google用ルールの不一致を合言葉エラーと区別し、メール用ルール反映後は同じアカウントで参加できる',async()=>{const user=await api.createEmailAccount(auth,address(),password,password);await verify(user);const modern=fs.readFileSync('firestore.rules','utf8'),old=modern.replace("sign_in_provider == 'password'","sign_in_provider == 'google.com'");const legacy=await initializeTestEnvironment({projectId:'demo-shuttle-note',firestore:{rules:old,host:'127.0.0.1',port:8080}});try{await assert.rejects(store.membership(),error=>error.code==='membership_access_denied'&&error.message.includes('保存ルール')&&!error.message.includes('合言葉'));await assertFails(getDocs(collection(db,'players')));}finally{const restored=await initializeTestEnvironment({projectId:'demo-shuttle-note',firestore:{rules:modern,host:'127.0.0.1',port:8080}});await legacy.cleanup();await restored.cleanup();}assert.equal(await store.membership(),null);await assert.rejects(store.verifyJoinCode('incorrect-phrase'),error=>error.code==='join_code_denied');assert.equal(await store.verifyJoinCode(phrase),'テスト部');assert.deepEqual(await store.loadJoinRoster(),[]);await store.joinTeam(phrase,profile);assert.equal((await store.membership()).playerId,'self-'+user.uid);});

test('メール確認後にチームを作成し、再ログインから選手登録を再開できる',async()=>{
  await env.clearFirestore();
  const email=address();
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'setup','founder'),{email}));
  const founder=await api.createEmailAccount(auth,email,password,password);
  await assert.rejects(store.createTeam('テスト部',phrase));
  await verify(founder);
  assert.equal(await store.isDesignatedFounder(),true);
  await store.createTeam('テスト部',phrase);
  assert.equal(await store.membership(),null);
  await signOut(auth);
  await api.loginWithEmail(auth,email,password);
  assert.equal((await store.getTeam()).name,'テスト部');
  await store.joinTeam(null,profile);
  assert.equal((await store.viewer()).teamName,'テスト部');

  await signOut(auth);
  const member=await api.createEmailAccount(auth,address(),password,password);
  await verify(member);
  await assert.rejects(store.verifyJoinCode('incorrect-phrase'));
  assert.equal(await store.verifyJoinCode(phrase),'テスト部');
  assert.equal(await store.membership(),null);
  await store.joinTeam(phrase,{...profile,name:'イノウエ'});
  assert.equal((await store.viewer()).memberId,'self-'+member.uid);
});


test('メール確認した誰でもチームを作れ、参加と作成を合わせて3チームに制限される',async()=>{
  const firstEmail=address();
  const first=await api.createEmailAccount(auth,firstEmail,password,password);
  await assert.rejects(store.createCommunity('作成できない部','unverified-code'));
  await verify(first);
  const firstTeam=await store.createCommunity('バドミントン部','first-team-code');
  store.selectTeam(firstTeam.id);
  await store.joinTeam(null,profile);
  assert.equal((await store.viewer()).teamName,'バドミントン部');
  store.selectTeam(null);
  await signOut(auth);

  const second=await api.createEmailAccount(auth,address(),password,password);
  await verify(second);
  assert.deepEqual(await store.listTeams(),[]);
  assert.equal(await store.findTeamByCode('first-team-code'),firstTeam.id);
  await assertFails(getDoc(doc(db,'teams',firstTeam.id)));
  await assertFails(getDocs(collection(db,'teams',firstTeam.id,'players')));
  store.selectTeam(firstTeam.id);
  await assert.rejects(store.joinTeam(null,profile));
  assert.equal(await store.verifyJoinCode('first-team-code'),'バドミントン部');
  await store.joinTeam('first-team-code',{...profile,name:'イノウエ'});
  assert.equal((await store.viewer()).memberId,'self-'+second.uid);
  store.selectTeam(null);
  const secondTeam=await store.createCommunity('地域クラブ','second-team-code');
  await assert.rejects(store.createCommunity('同じコード','first-team-code'));
  const competing=await Promise.allSettled([
    store.createCommunity('卒業生チーム','third-team-code'),
    store.createCommunity('別のクラブ','fourth-team-code'),
  ]);
  assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);
  const teams=await store.listTeams();
  assert.equal(teams.length,3);
  assert.ok(teams.some(team=>team.id===firstTeam.id&&team.ownerUid!==second.uid));
  assert.ok(teams.some(team=>team.id===secondTeam.id&&team.ownerUid===second.uid));
  await assert.rejects(store.createCommunity('上限超過','another-team-code'),error=>error.code==='team_limit');

  await signOut(auth);
  await api.loginWithEmail(auth,firstEmail,password);
  assert.equal((await store.listTeams()).length,1);
  await assertFails(getDoc(doc(db,'teams',secondTeam.id)));
  await assertFails(getDocs(collection(db,'teams',secondTeam.id,'matches')));
  await assertFails(getDoc(doc(db,'accountTeams',second.uid)));
  store.selectTeam(null);
});

test('名簿との紐づけ承認でも3チームを超えず、拒否時に選手は未連携のまま残る',async()=>{
  const ownerEmail=address(),joiningEmail=address();
  const owner=await api.createEmailAccount(auth,ownerEmail,password,password);
  await verify(owner);
  const target=await store.createCommunity('受け入れ先','link-limit-code');
  store.selectTeam(target.id);
  await store.joinTeam(null,profile);
  store.setUnlocked(true);
  const first=(await store.firebaseRequest('/api/members','POST',{...profile,name:'イノウエ',hasTeamHistory:false})).member;
  const second=(await store.firebaseRequest('/api/members','POST',{...profile,name:'ウエダ',hasTeamHistory:false})).member;

  store.selectTeam(null);
  await signOut(auth);
  const candidate=await api.createEmailAccount(auth,joiningEmail,password,password);
  await verify(candidate);
  store.selectTeam(target.id);
  await store.verifyJoinCode('link-limit-code');
  await store.requestPlayerLink(first.id,owner.uid);
  store.selectTeam(null);
  for(let i=0;i<3;i++)await store.createCommunity('別のチーム'+i,'other-team-code-'+i);
  store.selectTeam(target.id);
  await assert.rejects(store.joinTeam('link-limit-code',{...profile,name:'タナカ'}),error=>error.code==='team_limit');

  store.selectTeam(null);
  await signOut(auth);
  const eligible=await api.createEmailAccount(auth,address(),password,password);
  await verify(eligible);
  store.selectTeam(target.id);
  await store.verifyJoinCode('link-limit-code');
  await store.requestPlayerLink(second.id,owner.uid);

  store.selectTeam(null);
  await signOut(auth);
  await api.loginWithEmail(auth,ownerEmail,password);
  store.selectTeam(target.id);
  store.setUnlocked(true);
  await assert.rejects(store.firebaseRequest('/api/link-requests/'+candidate.uid,'POST',{approve:true}));
  assert.equal((await getDoc(doc(db,'teams',target.id,'players',first.id))).data().ownerUid,null);
  assert.equal((await getDoc(doc(db,'teams',target.id,'linkRequests',candidate.uid))).data().status,'pending');
  await store.firebaseRequest('/api/link-requests/'+eligible.uid,'POST',{approve:true});
  assert.equal((await getDoc(doc(db,'teams',target.id,'players',second.id))).data().ownerUid,eligible.uid);
  store.selectTeam(null);
});
