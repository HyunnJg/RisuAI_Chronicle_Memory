// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 HyunnJg. See LICENSE; provided without warranty.
const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../lifecycle.cjs');
const controlled=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};

test('a silently denied registration never becomes confirmed and cached denial stays visible',async()=>{
  let adds=0,queries=0;
  const l=L.create({addRisuReplacer:async()=>{adds++;},requestPluginPermission:async()=>{queries++;return false;}},async x=>x);
  assert.equal((await l.ensure()).phase,'denied');assert.equal((await l.ensure()).phase,'denied');
  assert.equal(adds,2);assert.equal(queries,2);assert.match(L.describe(l.snapshot()),/세션.*거절 캐시/);
});
test('permission is checked after registration so periodic host reconfirmation runs first',async()=>{
  const order=[];const l=L.create({addRisuReplacer:async()=>{order.push('registration / periodic confirmation');},requestPluginPermission:async p=>{assert.equal(p,'replacer');order.push('permission result');return true;}},async x=>x);
  assert.equal((await l.ensure()).phase,'confirmed');assert.deepEqual(order,['registration / periodic confirmation','permission result']);
  assert.match(L.describe(l.snapshot()),/실행은 아직/);
  await l.ensure();assert.equal(order.length,2);
});
test('concurrent automatic and manual requests share one pending registration without a deadline',async()=>{
  const gate=controlled();let count=0;
  const l=L.create({addRisuReplacer:async()=>{count++;await gate.promise;},requestPluginPermission:async()=>true},async x=>x);
  const a=l.ensure(),b=l.ensure();assert.equal(a,b);assert.equal(l.snapshot().phase,'pending');
  await new Promise(r=>setImmediate(r));assert.equal(count,1);assert.match(L.describe(l.snapshot()),/중복 요청하지/);
  gate.resolve();assert.equal((await a).phase,'confirmed');assert.equal(count,1);
});
test('hosts without an explicit permission result stay unverified until an actual RP hook runs',async()=>{
  let hook,adds=0;const l=L.create({addRisuReplacer:async(_name,fn)=>{hook=fn;adds++;}},async x=>[...x,{content:'processed'}],{now:()=> '2026-11-19T10:00:00.000Z'});
  assert.equal((await l.ensure()).phase,'unverified');await l.ensure();assert.equal(adds,1);
  const input=[{content:'input'}];await hook(input,'memory');assert.equal(l.snapshot().lastHookAt,'');
  assert.equal((await hook(input,'model')).length,2);assert.equal(l.snapshot().phase,'confirmed');assert.equal(l.snapshot().lastHookAt,'2026-11-19T10:00:00.000Z');
});
test('a new check can confirm an unverified installed hook without registering another',async()=>{
  let adds=0,queries=0;const l=L.create({addRisuReplacer:async()=>{adds++;},requestPluginPermission:async()=>++queries===1?undefined:true},async x=>x);
  assert.equal((await l.ensure()).phase,'unverified');assert.equal((await l.ensure()).phase,'confirmed');assert.equal(adds,1);
});
test('registration exceptions are visible, redactable, and retry does not leave an active duplicate',async()=>{
  const hooks=[],removed=[];let attempts=0,calls=0;
  const l=L.create({addRisuReplacer:async(_name,fn)=>{hooks.push(fn);if(++attempts===1)throw Error('sensitive-key');},removeRisuReplacer:async(_name,fn)=>removed.push(fn),requestPluginPermission:async()=>true},async x=>{calls++;return x;},{safeError:()=> '[redacted]'});
  assert.equal((await l.ensure()).phase,'error');assert.equal(l.snapshot().detail,'[redacted]');
  assert.equal((await l.ensure()).phase,'confirmed');assert.equal(removed[0],hooks[0]);
  const input=[];await hooks[0](input,'model');await hooks[1](input,'model');assert.equal(calls,1);
});
test('disposal during pending registration removes a late hook and makes it inert',async()=>{
  const gate=controlled(),hooks=[],removed=[];let calls=0,queries=0;
  const l=L.create({addRisuReplacer:async(_name,fn)=>{hooks.push(fn);await gate.promise;},removeRisuReplacer:async(_name,fn)=>removed.push(fn),requestPluginPermission:async()=>{queries++;return true;}},async x=>{calls++;return x;});
  const task=l.ensure();await new Promise(r=>setImmediate(r));await l.dispose();gate.resolve();await task;
  const input=[];assert.equal(await hooks[0](input,'model'),input);assert.equal(calls,0);assert.equal(queries,0);assert.equal(l.snapshot().phase,'unloaded');assert(removed.includes(hooks[0]));
});
test('a denied candidate cannot process RP even if a host calls its stale callback',async()=>{
  let hook,calls=0;const l=L.create({addRisuReplacer:async(_name,fn)=>{hook=fn;},requestPluginPermission:async()=>false},async x=>{calls++;return x;});
  await l.ensure();const input=[];assert.equal(await hook(input,'model'),input);assert.equal(calls,0);assert.equal(l.snapshot().phase,'denied');
});
test('permission checker failure never creates a false success and actual execution remains observable',async()=>{
  let hook;const l=L.create({addRisuReplacer:async(_name,fn)=>{hook=fn;},requestPluginPermission:async()=>{throw Error('unavailable');}},async x=>x);
  assert.equal((await l.ensure()).phase,'error');await hook([],'model');assert.equal(l.snapshot().phase,'confirmed');
});
test('diagnostic rendering failures cannot block successful registration',async()=>{
  const l=L.create({addRisuReplacer:async()=>{},requestPluginPermission:async()=>true},async x=>x,{onChange:()=>{throw Error('closed UI');}});
  assert.equal((await l.ensure()).phase,'confirmed');await l.dispose();assert.equal(l.snapshot().phase,'unloaded');
});
