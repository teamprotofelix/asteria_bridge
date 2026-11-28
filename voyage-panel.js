'use strict';

const AsteriaVoyagePanel = (() => {
  function create(destinations,events,voyage,actions) {
    const el=id=>document.getElementById(id);
    const dialog=el('voyageDialog');
    const sectors=new Set(destinations.map(([id])=>id));
    const sectorName=id=>destinations.find(row=>row[0]===id)?.[1] ?? '—';
    const labels={departure:'출발',arrival:'도착',observation:'관측',discovery:'발견',drone:'드론',tea:'차',event:'우주 상황'};
    const feedback=el('voyageFeedback');
    const storageConsent=el('voyageConsent');
    let backup=null, opener=null, registration=null, applying=false, installer=null, working=false, fileRevision=0;
    const sectorSelect=()=>{
      const select=document.createElement('select');
      for (const [id,name] of destinations) select.add(new Option(name,id));
      return select;
    };
    for (const id of ['voyageOfflineSector','voyageCatalog']) {
      for (const [sector,name] of destinations) el(id).add(new Option(name,sector));
    }
    for (const [type,label] of Object.entries(labels)) el('voyageFilter').add(new Option(label,type));

    function status(text) {feedback.textContent=text;}
    function attempt(action,message) {
      return async()=>{
        if (working) return;
        working=true;
        refresh();
        try {if (await action()) status(message);}
        finally {working=false;refresh();}
      };
    }
    function refresh() {
      if (!dialog.open) return;
      const data=voyage.data;
      if (!working) storageConsent.checked=data.preferences.persist;
      storageConsent.disabled=working;
      el('voyageStorageStatus').textContent=voyage.error || (data.preferences.persist ? '이 브라우저에 저장 중' : '세션 모드 · 항해 기록을 브라우저에 저장하지 않습니다.');
      const legacy=voyage.getLegacy();
      el('voyageLegacy').hidden=!legacy.length;
      el('voyageLegacy').textContent='기존 방문 기록 '+legacy.length+'개 가져오기';
      el('voyageLegacy').disabled=working;
      el('voyageForget').disabled=working;
      el('voyageApply').disabled=!backup || working || actions.busy();
      el('voyageRestore').disabled=working || actions.busy() || !data.lastSafeSector;
      el('voyageRestore').textContent='안전 구역 열기 · '+sectorName(data.lastSafeSector);
      el('voyageStart').disabled=working || actions.busy();
      el('voyageApplyUpdate').hidden=!registration?.waiting;
      el('voyageApplyUpdate').disabled=actions.busy() || applying;
      const target=el('voyageCatalog').value;
      el('voyageCatalogInfo').textContent=sectorName(target)+' · '+(destinations.find(row=>row[0]===target)?.[2] ?? '')
        +' · '+(data.visitedSectorIds.includes(target)?'방문 완료':'미탐사');
      const query=el('voyageSearch').value.trim().toLowerCase();
      const category=el('voyageFilter').value;
      const list=el('voyageLog');
      const rows=data.discoveryLog.filter(entry=>(!category || entry.kind===category) &&
        [sectorName(entry.sectorId),labels[entry.kind],events[entry.eventId]?.name ?? '']
          .some(value=>value.toLowerCase().includes(query)));
      rows.sort((a,b)=>(el('voyageOrder').value==='oldest' ? 1 : -1)*(a.time-b.time));
      list.replaceChildren(...rows.map(entry=>{
        const li=document.createElement('li');
        const header=document.createElement('b');
        header.textContent=labels[entry.kind]+' · '+sectorName(entry.sectorId)+(entry.eventId ? ' · '+events[entry.eventId].name : '');
        const small=document.createElement('small');
        small.textContent=new Date(entry.time).toLocaleString('ko-KR')+' · 모의 '+entry.simSeconds.toFixed(1)+'초';
        li.append(header,small);
        return li;
      }));
      el('voyageLogEmpty').hidden=rows.length>0;
    }
    function configure(plan) {
      el('voyageStops').replaceChildren();
      for (const stop of plan.stops) addStop(stop);
      el('voyageRepeat').value=String(plan.repeat);
      el('voyageView').value=plan.view;
      el('voyageAudio').value=plan.audio;
    }
    function addStop(stop={sectorId:'nereid',seconds:60}) {
      const rows=el('voyageStops');
      if (rows.childElementCount>=32) return;
      const row=document.createElement('li');
      const sector=sectorSelect();
      sector.value=stop.sectorId;
      sector.setAttribute('aria-label','관측 구역');
      const seconds=document.createElement('input');
      seconds.type='number';seconds.min='30';seconds.max='3600';seconds.step='1';
      seconds.setAttribute('list','voyageDwell');
      seconds.setAttribute('aria-label','관측 시간(초)');
      seconds.value=stop.seconds;
      row.append(sector,seconds);
      for (const [direction,label] of [[-1,'위'],[1,'아래'],[0,'삭제']]) {
        const button=document.createElement('button');
        button.type='button';button.textContent=label;
        button.onclick=()=>{
          if (!direction) {if (rows.childElementCount>1) row.remove();return;}
          const other=direction<0 ? row.previousElementSibling : row.nextElementSibling;
          if (!other) return;
          if (direction<0) other.before(row);
          else other.after(row);
          button.focus();
        };
        row.append(button);
      }
      rows.append(row);
    }
    function planFromForm() {
      const stops=Array.from(el('voyageStops').children,row=>({
        sectorId:row.querySelector('select').value,seconds:row.querySelector('input').valueAsNumber,
      }));
      return {stops,repeat:el('voyageRepeat').valueAsNumber,view:el('voyageView').value,audio:el('voyageAudio').value};
    }
    function downloadBackup() {
      const url=URL.createObjectURL(new Blob([JSON.stringify(voyage.snapshot(),null,2)+'\n'],{type:'application/json'}));
      const link=document.createElement('a');
      link.href=url;
      link.download='asteria-voyage.json';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }

    function message(worker,data) {
      if (!worker) return Promise.reject(Error('오프라인 준비가 끝나지 않았습니다.'));
      return new Promise((resolve,reject)=>{
        const channel=new MessageChannel();
        const timeout=setTimeout(()=>{
          channel.port1.close();
          reject(Error('응답이 지연됩니다. 잠시 뒤 목록을 확인하십시오.'));
        },45000);
        channel.port1.onmessage=event=>{
          clearTimeout(timeout);
          channel.port1.close();
          event.data.ok ? resolve(event.data.items) : reject(Error(event.data.error));
        };
        worker.postMessage(data,[channel.port2]);
      });
    }
    async function manageOffline(type) {
      el('voyageOfflineAdd').disabled=el('voyageOfflineRemove').disabled=true;
      const id=el('voyageOfflineSector').value;
      try {
        const items=await message(navigator.serviceWorker?.controller,{type,id,paths:actions.assetPaths(id)});
        const names=items.map(item=>sectorName(item.id)+' '+(item.bytes/1048576).toFixed(2)+' MB');
        el('voyageOfflineList').textContent='기본 NEREID 준비됨'+(names.length ? ' · '+names.join(' / ') : ' · 추가 구역 없음');
      } catch (error) {
        el('voyageOfflineList').textContent=error.message;
      } finally {
        el('voyageOfflineAdd').disabled=el('voyageOfflineRemove').disabled=false;
      }
    }
    if ('serviceWorker' in navigator && location.protocol!=='file:') {
      navigator.serviceWorker.register('./sw.js').then(value=>{
        registration=value;
        refresh();
        function monitor() {
          registration.installing?.addEventListener('statechange',refresh);
        }
        monitor();
        registration.addEventListener('updatefound',monitor);
      }).catch(()=>{el('voyageOfflineList').textContent='오프라인 구성을 설치할 수 없습니다.';});
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        if (applying) location.reload();
        else if (dialog.open) void manageOffline('list');
      });
      navigator.serviceWorker.ready.then(()=>{
        el('voyageOfflineList').textContent='기본 네레이드 관측 에셋을 준비했습니다.';
        if (dialog.open && navigator.serviceWorker.controller) void manageOffline('list');
      });
    } else el('voyageOfflineList').textContent='이 환경에서는 오프라인 설치를 사용할 수 없습니다.';
    window.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();
      installer=event;
      el('voyageInstall').hidden=false;
    });
    el('voyageInstall').onclick=async()=>{
      if (!installer) return;
      await installer.prompt();
      installer=null;
      el('voyageInstall').hidden=true;
    };
    el('voyageApplyUpdate').onclick=async()=>{
      if (actions.busy() || applying || !registration?.waiting) return;
      applying=true;
      refresh();
      try {await message(registration.waiting,{type:'activate'});}
      catch (error) {applying=false;status(error.message);refresh();}
    };
    el('voyageOfflineAdd').onclick=()=>void manageOffline('download');
    el('voyageOfflineRemove').onclick=()=>void manageOffline('remove');

    function open(trigger,tab) {
      opener=trigger;
      status('');
      if (!dialog.open) dialog.showModal();
      for (const section of dialog.querySelectorAll('details[data-voyage]')) section.open=section.dataset.voyage===tab;
      if (tab==='offline' && navigator.serviceWorker?.controller) void manageOffline('list');
      refresh();
    }
    el('voyageOpen').onclick=()=>open(el('voyageOpen'),'log');
    el('watchEditor').onclick=()=>open(el('watchEditor'),'route');
    dialog.querySelector('[data-voyage="offline"]').addEventListener('toggle',event=>{
      if (event.currentTarget.open && navigator.serviceWorker?.controller) void manageOffline('list');
    });
    el('voyageClose').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{
      const focus=opener?.getClientRects().length ? opener : el('exitCinema');
      focus.focus({preventScroll:true});
    });
    for (const id of ['voyageCatalog','voyageFilter','voyageSearch','voyageOrder']) el(id).oninput=refresh;
    storageConsent.onchange=()=>{
      const enabled=storageConsent.checked;
      return attempt(()=>voyage.consent(enabled),'저장 설정을 적용했습니다.')();
    };
    el('voyageLegacy').onclick=attempt(voyage.importLegacy,'기존 방문 기록을 합쳤습니다.');
    el('voyageExport').onclick=downloadBackup;
    el('voyageConfirmErase').onclick=(event)=>{
      const confirmation=el('voyageErase');
      confirmation.hidden=!confirmation.hidden;
      event.currentTarget.setAttribute('aria-expanded',String(!confirmation.hidden));
    };
    el('voyageForget').onclick=attempt(async()=>{
      if (!await voyage.forget()) return false;
      el('voyageErase').hidden=true;
      el('voyageConfirmErase').setAttribute('aria-expanded','false');
      return true;
    },'항해 기록을 초기화했습니다. 기존 버전의 기록과 마리의 별도 저장 설정은 보존됩니다.');
    el('voyageFile').onchange=async event=>{
      const revision=++fileRevision;
      const file=event.target.files[0];
      backup=null;
      const preview=el('voyagePreview');
      preview.textContent='';
      refresh();
      if (!file) return;
      try {
        if (file.size>AsteriaVoyage.maxBytes) throw Error('백업 파일은 최대 256 KB까지 읽을 수 있습니다.');
        const data=voyage.decode(await file.text());
        if (revision!==fileRevision) return;
        backup=data;
        preview.textContent='방문 '+data.visitedSectorIds.length+'개 · 일지 '+data.discoveryLog.length+'건 · 마지막 구역 '+sectorName(data.lastSafeSector);
      } catch (error) {
        if (revision===fileRevision) preview.textContent=error instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : error.message;
      }
      refresh();
    };
    el('voyageApply').onclick=attempt(async()=>{
      if (!backup || actions.busy()) return false;
      const saved=await voyage.restore(backup,el('voyageMerge').value);
      if (saved) {
        backup=null;
        el('voyageFile').value='';
        el('voyagePreview').textContent='';
        if (voyage.data.approvedRoute) configure(voyage.data.approvedRoute);
      }
      return saved;
    },'백업을 반영했습니다. 저장한 자동 항로는 다시 시작할 때만 실행됩니다.');
    el('voyageRestore').onclick=()=>{
      const index=destinations.findIndex(([id])=>id===voyage.data.lastSafeSector);
      if (index>=0 && actions.restore(index)) dialog.close();
      else status('현재 구역이거나 복원할 수 없는 상태입니다.');
    };
    el('voyageAdd').onclick=()=>addStop();
    el('voyageStart').onclick=()=>{
      const plan=planFromForm();
      if (!AsteriaVoyage.route(plan,sectors)) {
        status('관측 시간은 30~3600초, 반복은 0~99회, 목적지는 1~32개로 지정하십시오.');
        return;
      }
      if (!actions.start(plan)) {status('현재 자동 관측을 시작할 수 없습니다.');return;}
      void voyage.updateRoute(plan);
      dialog.close();
    };
    voyage.subscribe(refresh);
    configure(voyage.data.approvedRoute ?? {stops: ['nereid','gaia','halogate'].map(sectorId=>({sectorId,seconds:60})),
      repeat:1,view:'bridge',audio:'mute'});
    return {refresh,
      async availableOffline(id) {
        if (id==='nereid') return true;
        try {
          const items=await message(navigator.serviceWorker?.controller,{type:'list'});
          return items.some(item=>item.id===id);
        } catch {return false;}
      },
    };
  }
  return {create};
})();
