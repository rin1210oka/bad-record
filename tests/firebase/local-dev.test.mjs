import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('ローカル専用起動は片側だけのエミュレーターや外部ホストへ接続しない',()=>{for(const [firestore,auth] of [['',''],['127.0.0.1:8080',''],['firestore.googleapis.com:443','127.0.0.1:9099'],['127.0.0.1:8080','identitytoolkit.googleapis.com:443']]){const result=spawnSync(process.execPath,['scripts/dev-local.mjs'],{encoding:'utf8',env:{...process.env,FIRESTORE_EMULATOR_HOST:firestore,FIREBASE_AUTH_EMULATOR_HOST:auth}});assert.notEqual(result.status,0);assert.match(result.stderr,/専用ローカルエミュレーター/);}});
