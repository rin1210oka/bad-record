import {createUserWithEmailAndPassword,signInWithEmailAndPassword,sendEmailVerification,reload,getIdToken,getIdTokenResult,EmailAuthProvider,reauthenticateWithCredential,sendPasswordResetEmail,type Auth,type User} from 'firebase/auth';

export function checkNewPassword(password:string,confirmation:string){
  if(password.length<8)throw new Error('アプリ用パスワードは8文字以上で入力してください。');
  if(password!==confirmation)throw new Error('確認用のパスワードが一致していません。');
}
export async function createEmailAccount(auth:Auth,email:string,password:string,confirmation:string){
  checkNewPassword(password,confirmation);
  const credential=await createUserWithEmailAndPassword(auth,email.trim(),password);
  await sendEmailVerification(credential.user);
  return credential.user;
}
export async function loginWithEmail(auth:Auth,email:string,password:string){
  return (await signInWithEmailAndPassword(auth,email.trim(),password)).user;
}
export async function passwordSession(user:User){
  const result=await getIdTokenResult(user);
  return result.claims.firebase?.sign_in_provider==='password';
}
export async function checkEmailVerification(user:User){
  await reload(user);await getIdToken(user,true);
  return user.emailVerified;
}
export async function resendVerification(user:User){await sendEmailVerification(user);}
export async function reauthenticateEmail(user:User,password:string){
  if(!user.email)throw new Error('登録したメールアドレスを確認してください。');
  await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,password));
}
export async function sendRecoveryEmail(auth:Auth,email:string){
  try{await sendPasswordResetEmail(auth,email.trim());}
  catch(error){if((error as {code?:string}).code!=='auth/user-not-found')throw error;}
}
