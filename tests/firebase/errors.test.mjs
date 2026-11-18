import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('firebase-web/errors.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {accessErrorMessage}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('実際に発生したFirebase初期設定エラーは対応がわかる日本語で表示する',()=>{
  const error=Object.assign(new Error('Firebase: Error (auth/configuration-not-found).'),{code:'auth/configuration-not-found'});
  const text=accessErrorMessage(error);assert.match(text,/ログイン設定/);assert.match(text,/保守担当/);assert.ok(!text.includes('auth/configuration-not-found'));
});

test('メール認証のエラーは資格情報や生のエラーコードを出さず操作を案内する',()=>{for(const [code,expected] of [['auth/invalid-credential',/メールアドレス/],['auth/wrong-password',/パスワード/],['auth/invalid-email',/形式/],['auth/email-already-in-use',/登録済み/],['auth/operation-not-allowed',/メール・パスワード認証/],['auth/too-many-requests',/時間をおいて/],['auth/weak-password',/8文字/]]){const text=accessErrorMessage(Object.assign(new Error(code),{code}));assert.match(text,expected);assert.ok(!text.includes(code));}});

test('参加情報の権限エラーを合言葉の誤りと断定せず、処理別に案内する',()=>{const error=Object.assign(new Error('permission-denied'),{code:'permission-denied'});const general=accessErrorMessage(error),membership=accessErrorMessage(error,'membership'),registration=accessErrorMessage(error,'registration');assert.match(general,/保存ルール/);assert.match(membership,/参加情報/);assert.ok(!membership.includes('合言葉'));assert.match(registration,/受付期限/);});
