'use strict';

const AsteriaVoyage = (() => {
  const key='asteria.voyage.v2';
  const legacyKey='asteria.visited-sectors.v1';
  const marieKey='asteria.marie.preferences.v1';
  const maxBytes=256*1024;
  const maxLog=300;
  const kinds=['departure','arrival','observation','discovery','drone','tea','event'];
  const exact=(o,fields)=>o && typeof o==='object' && !Array.isArray(o)
    && Object.keys(o).length===fields.length && fields.every(field=>Object.hasOwn(o,field));
  const time=n=>Number.isSafeInteger(n) && n>=0 && n<=8640000000000000;
  const empty=()=>({schemaVersion:2,updatedAt:0,revision:0,preferences:{persist:false},
    visitedSectorIds:[],lastSafeSector:null,safeFlightState:null,approvedRoute:null,discoveryLog:[],
    mariePreferences:null,optionalGameConversation:null});

  function route(value,sectors) {
    return exact(value,['stops','repeat','view','audio']) && Array.isArray(value.stops)
      && value.stops.length>=1 && value.stops.length<=32
      && value.stops.every(stop=>exact(stop,['sectorId','seconds']) && sectors.has(stop.sectorId)
        && Number.isInteger(stop.seconds) && stop.seconds>=30 && stop.seconds<=3600)
      && Number.isInteger(value.repeat) && value.repeat>=0 && value.repeat<=99
      && ['bridge','exterior','captain','lounge'].includes(value.view)
      && ['mute','inherit'].includes(value.audio);
  }

  function decode(raw,sectors,eventIds) {
    if (typeof raw!=='string' || new TextEncoder().encode(raw).length>maxBytes) throw Error('저장 파일 크기 한도를 초과했습니다.');
    const data=JSON.parse(raw);
    if (exact(data,['schemaVersion','visitedSectorIds']) && data.schemaVersion===1) {
      return validate({...empty(),visitedSectorIds:data.visitedSectorIds},sectors,eventIds);
    }
    return validate(data,sectors,eventIds);
  }

  function validate(data,sectors,eventIds) {
    const sector=id=>id===null || sectors.has(id);
    const list=data?.discoveryLog;
    if (!exact(data,Object.keys(empty())) || data.schemaVersion!==2 || !time(data.updatedAt)
        || !Number.isSafeInteger(data.revision) || data.revision<0 || data.revision>=Number.MAX_SAFE_INTEGER
        || !exact(data.preferences,['persist']) || typeof data.preferences.persist!=='boolean'
        || !Array.isArray(data.visitedSectorIds) || data.visitedSectorIds.length>sectors.size
        || new Set(data.visitedSectorIds).size!==data.visitedSectorIds.length
        || !data.visitedSectorIds.every(id=>sectors.has(id)) || !sector(data.lastSafeSector)
        || !(data.safeFlightState===null || (exact(data.safeFlightState,['sectorId','mode'])
          && sectors.has(data.safeFlightState.sectorId) && data.safeFlightState.sectorId===data.lastSafeSector
          && data.safeFlightState.mode==='view'))
        || !(data.approvedRoute===null || route(data.approvedRoute,sectors))
        || !(data.mariePreferences===null || (exact(data.mariePreferences,['sectorId']) && sector(data.mariePreferences.sectorId)))
        || data.optionalGameConversation!==null || !Array.isArray(list) || list.length>maxLog
        || new Set(list.map(entry=>entry?.id)).size!==list.length
        || !list.every(entry=>exact(entry,['id','kind','sectorId','eventId','time','simSeconds'])
          && /^[a-zA-Z0-9-]{1,64}$/.test(entry.id) && kinds.includes(entry.kind)
          && sectors.has(entry.sectorId) && (entry.eventId===null || eventIds.has(entry.eventId))
          && time(entry.time) && Number.isFinite(entry.simSeconds) && entry.simSeconds>=0)) {
      throw Error('저장 파일 버전 또는 항해 기록 형식이 올바르지 않습니다.');
    }
    return data;
  }

  function combine(old,incoming) {
    const log=new Map(old.discoveryLog.map(entry=>[entry.id,entry]));
    for (const entry of incoming.discoveryLog) log.set(entry.id,entry);
    return {...old,
      visitedSectorIds:[...new Set([...old.visitedSectorIds,...incoming.visitedSectorIds])],
      lastSafeSector:incoming.lastSafeSector ?? old.lastSafeSector,
      safeFlightState:incoming.lastSafeSector ? incoming.safeFlightState : old.safeFlightState,
      approvedRoute:incoming.approvedRoute ?? old.approvedRoute,
      mariePreferences:incoming.mariePreferences ?? old.mariePreferences,
      discoveryLog:[...log.values()].sort((a,b)=>a.time-b.time || a.id.localeCompare(b.id)).slice(-maxLog)};
  }

  function create(sectors,eventIds,{storage,withLock,now=Date.now,makeId}={}) {
    let data=empty(), error='', tail=Promise.resolve(), pending=0;
    const listeners=new Set();
    function read() {
      const raw=storage.getItem(key);
      return raw ? decode(raw,sectors,eventIds) : null;
    }
    try {
      const stored=read();
      if (stored?.preferences.persist) data=stored;
    } catch {error='저장된 항해 데이터에 접근할 수 없습니다. 세션 모드입니다.';}
    function notify() {for (const fn of listeners) fn();}
    function enqueue(operation) {
      pending++;
      const run=async()=>{
        try {
          error='';
          const result=withLock ? await withLock(operation) : operation();
          notify();
          return result;
        } catch (reason) {
          error=reason?.name==='QuotaExceededError' ? '저장 공간 한도를 초과했습니다.'
            : '저장할 수 없습니다. 기존 데이터는 유지됩니다.';
          notify();
          return false;
        } finally {pending--;}
      };
      const task=tail.then(run,run);
      tail=task.catch(()=>{});
      return task;
    }
    function write(next,previous) {
      const committed={...next,updatedAt:now(),revision:(previous?.revision ?? 0)+1};
      validate(committed,sectors,eventIds);
      const raw=JSON.stringify(committed);
      if (new TextEncoder().encode(raw).length>maxBytes) throw new DOMException('Voyage size','QuotaExceededError');
      storage.setItem(key,raw);
      data=committed;
    }
    function update(change) {
      if (!data.preferences.persist) {
        data=change(data);
        notify();
        return Promise.resolve(true);
      }
      return enqueue(()=>{
        const latest=read();
        if (!latest?.preferences.persist) {
          data=change(empty());
          return false;
        }
        write(change(latest),latest);
        return true;
      });
    }
    function record(kind,sectorId,simSeconds,eventId=null) {
      if (!kinds.includes(kind) || !sectors.has(sectorId) || (eventId && !eventIds.has(eventId))) return;
      const entry={id:makeId(),kind,sectorId,eventId,time:now(),simSeconds:Math.round(Math.max(0,simSeconds)*10)/10};
      return update(current=>{
        const first=kind==='arrival' && !current.visitedSectorIds.includes(sectorId);
        return {...current,
          visitedSectorIds:first ? [...current.visitedSectorIds,sectorId] : current.visitedSectorIds,
          lastSafeSector:kind==='arrival' ? sectorId : current.lastSafeSector,
          safeFlightState:kind==='arrival' ? {sectorId,mode:'view'} : current.safeFlightState,
          discoveryLog:[...current.discoveryLog,entry,...(first ? [{...entry,id:entry.id+'-d',kind:'discovery'}] : [])].slice(-maxLog)};
      });
    }
    function getLegacy() {
      try {
        const visits=JSON.parse(storage.getItem(legacyKey) || 'null');
        return Array.isArray(visits) ? [...new Set(visits.filter(id=>sectors.has(id)))] : [];
      } catch {return [];}
    }
    return {
      record,getLegacy,
      get data() {return data;},
      get error() {return error;},
      snapshot() {return structuredClone(data);},
      subscribe(fn) {listeners.add(fn);},
      decode:raw=>decode(raw,sectors,eventIds),
      updateRoute:plan=>route(plan,sectors) ? update(d=>({...d,approvedRoute:structuredClone(plan)})) : Promise.resolve(false),
      importLegacy:()=>update(d=>({...d,visitedSectorIds:[...new Set([...d.visitedSectorIds,...getLegacy()])]})),
      restore(incoming,mode) {
        try {validate(incoming,sectors,eventIds);} catch {return Promise.resolve(false);}
        if (!['merge','replace'].includes(mode)) return Promise.resolve(false);
        return update(current=>{
          const next=mode==='merge' ? combine(current,incoming) : structuredClone(incoming);
          return {...next,preferences:current.preferences};
        });
      },
      consent(enabled) {
        return enqueue(()=>{
          if (!enabled) {
            storage.removeItem(key);
            data={...data,preferences:{persist:false}};
          } else {
            const latest=read();
            write({...combine(latest ?? empty(),data),preferences:{persist:true}},latest);
          }
          return true;
        });
      },
      forget() {
        return enqueue(()=>{
          storage.removeItem(key);
          data=empty();
          return true;
        });
      },
      noteMarie(value) {
        if (value!==null && !sectors.has(value)) return Promise.resolve(false);
        return update(d=>({...d,mariePreferences:value ? {sectorId:value} : null}));
      },
      reconcile(changedKey) {
        if (changedKey!==key && changedKey!==null) return;
        void tail.then(()=>{
          if (pending) return;
          try {
            const latest=read();
            if (latest?.preferences.persist) data=latest;
            else if (data.preferences.persist) data=empty();
            notify();
          } catch {error='다른 탭의 저장을 읽을 수 없습니다.';notify();}
        });
      },
    };
  }

  return {create,decode,route,key,legacyKey,marieKey,maxBytes,kinds};
})();
if (typeof module==='object' && module.exports) module.exports=AsteriaVoyage;
