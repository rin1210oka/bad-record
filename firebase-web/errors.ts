export type AccessErrorContext='general'|'membership'|'registration';
export function accessErrorMessage(error:unknown,context:AccessErrorContext='general'):string {
  const code=(error as {code?:string})?.code;
  if(code==='auth/configuration-not-found')return 'Firebase側のログイン設定がまだ済んでいません。保守担当にお知らせください。';
  if(code==='auth/unauthorized-domain')return 'この公開URLのログイン設定がまだ済んでいません。保守担当にお知らせください。';
  if(code==='auth/operation-not-allowed')return 'メール・パスワード認証がまだ有効になっていません。保守担当にお知らせください。';
  if(code==='auth/invalid-credential'||code==='auth/wrong-password'||code==='auth/user-not-found')return 'メールアドレスまたはアプリ用パスワードが違います。';
  if(code==='auth/invalid-email'||code==='auth/missing-email')return 'メールアドレスの形式を確認してください。';
  if(code==='auth/email-already-in-use'||code==='auth/account-exists-with-different-credential')return 'このメールアドレスは登録済みです。登録したメールアドレスとアプリ用パスワードでログインしてください。';
  if(code==='auth/weak-password'||code==='auth/password-does-not-meet-requirements')return 'パスワードが登録条件を満たしていません。8文字以上で、必要に応じて英数字や記号を組み合わせてください。';
  if(code==='auth/too-many-requests')return '試行回数が多いため、一時的に制限されています。時間をおいて再度お試しください。';
  if(code==='auth/user-disabled')return 'このアカウントは利用停止中です。保守担当に確認してください。';
  if(code==='auth/requires-recent-login')return '本人確認の有効時間が過ぎました。もう一度ログインしてからお試しください。';
  if(code==='auth/credential-already-in-use'||code==='auth/provider-already-linked')return 'この認証情報はすでに登録されています。アカウントを付け替えず、保守担当に相談してください。';
  if(code==='permission-denied'){
    if(context==='membership')return 'ログイン後の参加情報を取得できません。画面と保存ルールの認証方式が一致しているか、保守担当に確認してください。';
    if(context==='registration')return '選手情報を登録できません。合言葉の受付期限と保存先のアクセス設定を確認してください。';
    return '保存先へのアクセスが拒否されました。ログイン状態と、画面に対応する保存ルールが反映されているか確認してください。';
  }
  if(code==='auth/network-request-failed'||code==='unavailable')return '接続を確認して、もう一度お試しください。';
  return error instanceof Error?error.message:'処理できませんでした。もう一度お試しください。';
}
