'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const Voyage=require('../voyage-store.js');
const Watch=require('../watch-plan.js');
const sectors=new Set(['nereid','gaia','halogate','selene']);
const events=new Set(['meteor']);
const raw=(object)=>JSON.stringify(object);
function fixture() {
  const values=new Map();
  let id=0,clock=1000,quarantine=false,mutex=Promise.resolve();
  const storage={
    getItem:k=>values.get(k),
    setItem(k,v) {
      if (quarantine) throw new DOMException('quota','QuotaExceededError');
      values.set(k,v);
    },
    removeItem:k=>values.delete(k),
  };
  return {values,fail:()=>{quarantine=true;},tab:()=>Voyage.create(sectors,events,{
    storage,now:()=>++clock,makeId:()=>String(++id),
    withLock(fn) {const task=mutex.then(fn);mutex=task.catch(()=>{});return task;},
  })};
}

test('session logs do not persist and legacy import requires an explicit action',async()=>{
  const f=fixture();
  f.values.set(Voyage.legacyKey,raw(['gaia','unknown','gaia']));
  const voyage=f.tab();
  await voyage.record('arrival','nereid',0);
  assert.deepEqual(voyage.data.visitedSectorIds,['nereid']);
  assert.equal(f.values.has(Voyage.key),false);
  await voyage.importLegacy();
  assert.deepEqual(voyage.data.visitedSectorIds,['nereid','gaia']);
  assert.equal(f.values.has(Voyage.key),false);
  await voyage.consent(true);
  await voyage.record('arrival','halogate',5);
  assert.deepEqual(f.tab().data.safeFlightState,{sectorId:'halogate',mode:'view'});
  await voyage.consent(false);
  assert.equal(f.values.has(Voyage.key),false);
  assert.equal(f.values.has(Voyage.legacyKey),true);
  assert.equal(voyage.data.visitedSectorIds.length,3);
});

test('strict validation rejects oversized or unsafe backups and migrates documented v1',async()=>{
  const f=fixture(),v=f.tab();
  assert.deepEqual(v.decode(raw({schemaVersion:1,visitedSectorIds:['gaia']})).visitedSectorIds,['gaia']);
  for (const file of [
    'broken',
    ' '.repeat(Voyage.maxBytes+1),
    raw({schemaVersion:1,visitedSectorIds:['unknown']}),
    raw({...v.snapshot(),token:'invalid'}),
    raw({...v.snapshot(),lastSafeSector:'gaia',safeFlightState:{sectorId:'gaia',mode:'warp'}}),
    raw({...v.snapshot(),optionalGameConversation:['unexpected']}),
  ]) assert.throws(()=>v.decode(file));
});

test('merge and replacement are atomic under quota failure',async()=>{
  const f=fixture(),v=f.tab();
  await v.record('arrival','nereid',1);
  await v.consent(true);
  const imported=v.decode(raw({schemaVersion:1,visitedSectorIds:['gaia']}));
  assert.ok(await v.restore(imported,'merge'));
  assert.deepEqual(v.data.visitedSectorIds,['nereid','gaia']);
  const prior=f.values.get(Voyage.key);
  f.fail();
  assert.equal(await v.restore(imported,'replace'),false);
  assert.equal(f.values.get(Voyage.key),prior);
  assert.deepEqual(v.data.visitedSectorIds,['nereid','gaia']);
  assert.match(v.error,/한도/);
});

test('two tabs merge serialized observations and a deletion prevents stale writes',async()=>{
  const f=fixture(),first=f.tab();
  await first.consent(true);
  const second=f.tab();
  await Promise.all([first.record('arrival','nereid',1),second.record('arrival','gaia',2)]);
  first.reconcile(Voyage.key);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.tab().data.visitedSectorIds,['nereid','gaia']);
  assert.deepEqual(first.data.visitedSectorIds,['nereid','gaia']);
  await first.forget();
  assert.equal(await second.record('arrival','selene',4),false);
  assert.equal(f.values.has(Voyage.key),false);
  assert.equal(second.data.preferences.persist,false);
});

test('custom routes run in approved order and once/indefinite presets obey repeat policy',()=>{
  const route={stops:[{sectorId:'halogate',seconds:60},{sectorId:'gaia',seconds:180},{sectorId:'selene',seconds:30}],
    repeat:2,view:'captain',audio:'mute'};
  assert.ok(Voyage.route(route,sectors));
  assert.equal(Voyage.route({...route,stops:[{sectorId:'gaia',seconds:4}]},sectors),false);
  const session=Watch.create(route,'nereid');
  const observed=[];
  for (let leg=Watch.candidate(session);leg;leg=Watch.candidate(session)) {
    observed.push(leg.sectorId);
    Watch.arrive(session,leg);
    assert.equal(session.remaining,leg.seconds);
  }
  assert.deepEqual(observed,['halogate','gaia','selene','halogate','gaia','selene']);
  const legacy=Watch.create({...route,repeat:0},'gaia',true);
  assert.equal(legacy.remaining,45);
  assert.equal(Watch.candidate(legacy).sectorId,'selene');
});

test('old Marie copies are scrubbed at startup and excluded from merge, replacement and export',async()=>{
  const f=fixture(), baseline=f.tab();
  await baseline.record('arrival','nereid',1);
  await baseline.consent(true);
  const legacy={...baseline.snapshot(),visitedSectorIds:['nereid','gaia'],mariePreferences:{sectorId:'gaia'}};
  f.values.set(Voyage.key,raw(legacy));
  const v=f.tab();
  assert.equal(v.data.mariePreferences,null);
  assert.ok(await v.purgeMarieCopy());
  assert.equal(JSON.parse(f.values.get(Voyage.key)).mariePreferences,null);
  assert.deepEqual(v.data.visitedSectorIds,['nereid','gaia']);
  assert.equal(v.decode(raw(legacy)).mariePreferences,null);
  for (const mode of ['merge','replace']) {
    assert.ok(await v.restore(legacy,mode));
    assert.equal(v.snapshot().mariePreferences,null);
    assert.equal(JSON.parse(f.values.get(Voyage.key)).mariePreferences,null);
  }
});

test('failed cleanup keeps the old voyage intact without exposing its copy',async()=>{
  const f=fixture(), baseline=f.tab();
  await baseline.consent(true);
  const value=raw({...baseline.snapshot(),mariePreferences:{sectorId:'gaia'}});
  f.values.set(Voyage.key,value);
  f.fail();
  const v=f.tab();
  assert.equal(await v.purgeMarieCopy(),false);
  assert.match(v.error,/한도/);
  assert.equal(f.values.get(Voyage.key),value);
  assert.equal(v.snapshot().mariePreferences,null);
});
