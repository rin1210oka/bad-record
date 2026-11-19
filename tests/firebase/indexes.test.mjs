import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync('firestore.indexes.json','utf8'));
function effective(field){return config.fieldOverrides.filter(item=>item.collectionGroup==='feedback'&&(field===item.fieldPath||field.startsWith(item.fieldPath+'.'))).sort((a,b)=>b.fieldPath.length-a.fieldPath.length)[0];}
test('ホームの試合日順検索は親情報の索引除外を上書きし、実環境でも降順検索できる設定を持つ',()=>{
 const source=fs.readFileSync('firebase-web/store.ts','utf8');assert.ok(source.includes("orderBy('context.date','desc')"));
 assert.ok(effective('context.date')?.indexes.some(index=>index.order==='DESCENDING'&&index.queryScope==='COLLECTION'));
});
test('日付以外の試合情報と振り返り本文は検索対象に加えず、索引の容量増加を抑える',()=>{
 for(const field of ['context.sideA','context.sideB','context.scores','goodPoints','improvements','nextAction'])assert.deepEqual(effective(field)?.indexes,[],field);
});
