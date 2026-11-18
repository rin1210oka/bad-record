// Uses only the local demo emulators, never production credentials or data.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST,authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!firestoreHost||!authHost||!/^127\.0\.0\.1:[0-9]+$/.test(firestoreHost)||!/^127\.0\.0\.1:[0-9]+$/.test(authHost))throw Error('npm run dev:local から起動してください。両方の専用ローカルエミュレーターが必要です。');
const phrase='shuttle-local',key=createHash('sha256').update(phrase).digest('hex');
const endpoint='http://'+firestoreHost+'/v1/projects/demo-shuttle-note/databases/(default)/documents/joinKeys/'+key;
const response=await fetch(endpoint,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:{enabled:{booleanValue:true},expiresAt:{timestampValue:new Date(Date.now()+365*86400000).toISOString()}}})});
if(!response.ok)throw Error('ローカルの合言葉を準備できませんでした。HTTP '+response.status);
console.log('ローカル検証用の合言葉：'+phrase+'（本番の合言葉とは別です）');
console.log('メールは送信しません。確認リンクはこのターミナルに表示されます。');
const child=spawn(process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'--config','vite.firebase.config.ts'],{stdio:'inherit',env:{...process.env,VITE_USE_FIREBASE_EMULATORS:'true'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
