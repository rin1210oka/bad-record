import {initializeApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {initializeFirestore,memoryLocalCache} from 'firebase/firestore';

const {VITE_FIREBASE_PROJECT_ID:projectId,VITE_FIREBASE_API_KEY:apiKey,VITE_FIREBASE_AUTH_DOMAIN:authDomain,VITE_FIREBASE_APP_ID:appId}=import.meta.env;
export const configured=Boolean(projectId&&apiKey&&authDomain);
const app=initializeApp({
  projectId:projectId||'not-configured',
  apiKey:apiKey||'not-configured',
  authDomain:authDomain||'localhost',
  appId:appId||undefined,
});
export const auth=getAuth(app);
auth.languageCode='ja';
export const db=initializeFirestore(app,{localCache:memoryLocalCache()});
