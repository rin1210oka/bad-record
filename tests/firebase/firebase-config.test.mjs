import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const encode=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function config(env){globalThis.__configProbe={authCalls:[],firestoreCalls:[]};let code=ts.transpileModule(fs.readFileSync('firebase-web/firebase.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('import.meta.env',JSON.stringify(env));const modules={'firebase/app':'export const initializeApp=config=>{globalThis.__configProbe.config=config;return {};};','firebase/auth':'export const getAuth=()=>({});export const connectAuthEmulator=(...args)=>globalThis.__configProbe.authCalls.push(args);','firebase/firestore':'export const memoryLocalCache=()=>({});export const initializeFirestore=()=>({});export const connectFirestoreEmulator=(...args)=>globalThis.__configProbe.firestoreCalls.push(args);'};for(const [name,stub] of Object.entries(modules))code=code.replaceAll("'"+name+"'",JSON.stringify(encode(stub)));await import(encode(code)+'#'+crypto.randomUUID());return globalThis.__configProbe;}
const supplied={VITE_FIREBASE_PROJECT_ID:'production-project',VITE_FIREBASE_API_KEY:'production-public-key',VITE_FIREBASE_AUTH_DOMAIN:'production.firebaseapp.com',VITE_FIREBASE_APP_ID:'production-app'};
test('開発時もビルド時も指定したFirebaseプロジェクトに接続する',async()=>{
  try{
    for(const DEV of [true,false]){
      const result=await config({...supplied,DEV,VITE_USE_FIREBASE_EMULATORS:'true'});
      assert.equal(result.config.projectId,supplied.VITE_FIREBASE_PROJECT_ID);
      assert.equal(result.config.apiKey,supplied.VITE_FIREBASE_API_KEY);
      assert.equal(result.config.authDomain,supplied.VITE_FIREBASE_AUTH_DOMAIN);
      assert.equal(result.authCalls.length,0);
      assert.equal(result.firestoreCalls.length,0);
    }
  }finally{delete globalThis.__configProbe;}
});
