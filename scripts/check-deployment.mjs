// Read-only preflight. Does not upload rules, change providers, or read user records.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),auth=require('firebase-tools/lib/auth'),{requireAuth}=require('firebase-tools/lib/requireAuth'),{Client}=require('firebase-tools/lib/apiv2');
try{
  const project=JSON.parse(await fs.readFile('.firebaserc','utf8')).projects.default;
  const account=auth.getProjectDefaultAccount(process.cwd());if(!account)throw Error('先にFirebase CLIへログインしてください。');
  await requireAuth({project,projectRoot:process.cwd(),...account});
  const rules=new Client({urlPrefix:'https://firebaserules.googleapis.com',apiVersion:'v1'}),identity=new Client({urlPrefix:'https://identitytoolkit.googleapis.com',apiVersion:'admin/v2'});
  const release=await rules.get('projects/'+project+'/releases/cloud.firestore');
  const [published,config,local]=await Promise.all([rules.get(release.body.rulesetName),identity.get('projects/'+project+'/config'),fs.readFile('firestore.rules','utf8')]);
  const remote=published.body.source.files.map(f=>f.content).join('\n');
  const matches=remote.replace(/\r/g,'').trim()===local.replace(/\r/g,'').trim();
  const enabled=config.body.signIn?.email?.enabled===true&&config.body.signIn?.email?.passwordRequired!==false;
  console.log('対象プロジェクト：'+project);
  console.log('メール／パスワード認証：'+(enabled?'有効':'未設定'));
  console.log('画面に対応する保存ルール：'+(matches?'反映済み':'不一致'));
  if(!enabled||!matches){console.log('公開手順を確認し、画面と保存ルールを同じブランチから揃えて反映してください。Firebaseの保存ルールは、実際に接続するプロジェクトで使用されます。');process.exitCode=1;}
}catch(error){console.error(error.message);process.exitCode=1;}
