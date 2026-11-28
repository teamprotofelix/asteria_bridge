'use strict';

const AsteriaMarieConsole = (() => {
  const help = '함장님, 상태 보고·관측지 추천·가이아로 항로 설정·헤일로 게이트로 워프·차 준비·드론 파견·자동 관측 시작·정지를 요청할 수 있습니다.';
  const fallback = '명령을 확인할 수 없습니다. 도움말이나 구역 이름을 입력해 주십시오.';

  function create(sectors,{snapshot,execute,onPreference=()=>{},initialPreference=null}) {
    const el=id=>document.getElementById(id);
    const dialog=el('commandDialog');
    const input=el('commandInput');
    const log=el('commandLog');
    const status=el('commandFeedback');
    const pref=AsteriaCommand.preferences(sectors,{
      getItem:key=>localStorage.getItem(key),
      setItem:(key,value)=>localStorage.setItem(key,value),
      removeItem:key=>localStorage.removeItem(key),
    });
    if (initialPreference) pref.absorb(initialPreference);
    let nextId=0, pending=null, request=null, adapter=null, adapterAddress=null, opener=null;
    let previous='', previousAt=-Infinity;

    function entry(role,text) {
      const row=document.createElement('li');
      row.dataset.speaker=role;
      const speaker=document.createElement('b');
      speaker.textContent=role==='captain' ? '함장' : '마리';
      const message=document.createElement('span');
      message.textContent=text;
      row.append(speaker,message);
      log.append(row);
      while (log.childElementCount>32) log.firstElementChild.remove();
      row.scrollIntoView({block:'nearest'});
    }

    function stateEvent(id,phase,intent) {
      dialog.dispatchEvent(new CustomEvent('asteria:command',{
        bubbles:true,detail:{id,phase,intent},
      }));
    }

    function localReply(intent,state=snapshot()) {
      if (intent==='guide') return help;
      if (intent==='recommend') {
        const candidate=sectors.find(([id])=>id===pref.sectorId)
          ?? ['halogate','gaia','nebula','nereid'].map(id=>sectors.find(s=>s[0]===id))
            .find(s=>s && !state.visited.includes(s[0]))
          ?? sectors.find(s=>s[0]!==state.sectorId);
        if (!candidate) return '추천할 관측 구역이 없습니다.';
        return (pref.sectorId===candidate[0] ? '선호 구역입니다. ' : '관측 추천. ')+candidate[1]+' · '+candidate[2]+'.';
      }
      return [state.sectorName+' · '+state.mode, state.activity,
        state.warning || (state.eventName ? '관측 중: '+state.eventName : ''), state.report]
        .filter(Boolean).join(' / ');
    }

    function showMemory() {
      el('commandRemember').checked=pref.consent;
      const destination=sectors.find(([id])=>id===pref.sectorId)?.[1] ?? '미설정';
      el('commandMemory').textContent=(pref.consent ? '이 브라우저에 보관' : '현재 세션만')+' · 선호 구역 '+destination;
      if (!el('commandExportData').hidden) {
        el('commandExportData').textContent=JSON.stringify(pref.export(),null,2);
      }
    }
    function cancelPending(message) {
      if (!pending) return;
      const {id,intent}=pending;
      pending=null;
      el('commandApproval').hidden=true;
      el('commandPreview').hidden=true;
      el('commandPreview').textContent='';
      stateEvent(id,'cancelled',intent);
      if (message) entry('marie',message);
    }

    function cancelRequest(message) {
      if (!request) return;
      const current=request;
      request=null;
      current.abort.abort();
      el('commandAbortRequest').hidden=true;
      stateEvent(current.id,'cancelled','external_reply');
      if (message) entry('marie',message);
    }

    function propose(item,title,preview='') {
      pending=item;
      el('commandApprovalText').textContent=title;
      el('commandPreview').textContent=preview;
      el('commandPreview').hidden=!preview;
      el('commandApprove').textContent=item.remote ? '전송 승인' : '실행 승인';
      el('commandApproval').hidden=false;
      stateEvent(item.id,'pending',item.intent);
    }

    function run(command,id) {
      const result=AsteriaCommand.blocked(command,snapshot());
      if (result) {
        entry('marie',result);
        stateEvent(id,'blocked',command.intent);
        return;
      }
      if (['status','guide','recommend'].includes(command.intent)) {
        entry('marie',localReply(command.intent));
      } else if (command.intent==='remember_sector') {
        const saved=pref.set(command.sectorId);
        onPreference(command.sectorId);
        showMemory();
        entry('marie',!saved ? '브라우저 저장이 실패했습니다. 이번 세션에만 적용됩니다.'
          : pref.consent ? '선호 구역을 이 브라우저에 저장했습니다.' : '선호 구역을 이번 세션에 기억합니다.');
      } else {
        entry('marie',execute(command));
      }
      stateEvent(id,'processed',command.intent);
    }

    function validApproval(item,state) {
      return state.epoch===item.epoch && state.sectorId===item.sectorId
        && !AsteriaCommand.blocked(item.command,state) && performance.now()<=item.expires;
    }

    function submit(text) {
      if (!text.trim()) return;
      const parsed=AsteriaCommand.parse(text,sectors);
      const command=parsed.command;
      if (command?.intent==='status' && text===previous && performance.now()-previousAt<1200) return;
      previous=text;
      previousAt=performance.now();
      const id=++nextId;
      cancelPending();
      cancelRequest();
      entry('captain',text);
      if (parsed.kind==='clarify') {entry('marie',parsed.text);return;}
      if (!AsteriaCommand.validate(command,sectors)) {
        if (parsed.kind!=='unsupported' || !adapter || text.length>AsteriaCommand.maxText
            || /[<>{}]|https?:\/\/|(?:api[_ -]?key|bearer)\s*[:= ]/i.test(text)) {
          entry('marie',fallback);
          return;
        }
        const data=AsteriaMarieAdapter.payload(snapshot(),text);
        propose({id,intent:'external_reply',remote:true,data},adapterAddress+'로 아래 데이터 1건을 전송합니까?',
          JSON.stringify(data,null,2));
        return;
      }
      if (!AsteriaCommand.requiresApproval.has(command.intent)) {run(command,id);return;}
      const state=snapshot();
      const reason=AsteriaCommand.blocked(command,state);
      if (reason) {entry('marie',reason);stateEvent(id,'blocked',command.intent);return;}
      const name=sectors.find(([sectorId])=>sectorId===command.sectorId)?.[1];
      const label=command.intent==='warp' ? state.sectorName+' → '+name+' 워프를 실행합니까?'
        : '8개 구역 자동 관측을 시작합니까? 종료할 때까지 반복합니다.';
      propose({id,command,intent:command.intent,epoch:state.epoch,sectorId:state.sectorId,
        expires:performance.now()+45000},label);
    }

    async function askRemote(item) {
      if (!adapter) return;
      const abort=new AbortController();
      const session={id:item.id,abort};
      request=session;
      el('commandAbortRequest').hidden=false;
      status.textContent='외부 응답 대기 중';
      stateEvent(item.id,'sending',item.intent);
      try {
        const reply=await adapter.respond(item.data.snapshot,item.data.text,abort.signal);
        if (request!==session) return;
        const intent={observe:'recommend',report:'status',guide:'guide'}[reply];
        entry('marie',intent ? localReply(intent) : fallback);
        stateEvent(item.id,'processed',item.intent);
      } catch {
        if (request!==session) return;
        entry('marie','외부 응답을 사용할 수 없습니다. 로컬 모드로 응답합니다. '+fallback);
        stateEvent(item.id,'fallback',item.intent);
      } finally {
        if (request===session) {
          request=null;
          status.textContent='';
          el('commandAbortRequest').hidden=true;
        }
      }
    }

    el('commandForm').onsubmit=event=>{
      event.preventDefault();
      const text=input.value.trim();
      input.value='';
      status.textContent='';
      submit(text);
    };
    el('commandApprove').onclick=()=>{
      const item=pending;
      if (!item) return;
      pending=null;
      el('commandApproval').hidden=true;
      el('commandPreview').hidden=true;
      el('commandPreview').textContent='';
      if (item.remote) {void askRemote(item);return;}
      if (!validApproval(item,snapshot())) {
        entry('marie','함교 상태가 바뀌었거나 승인 시간이 만료되었습니다. 명령을 다시 요청해 주십시오.');
        stateEvent(item.id,'cancelled',item.intent);
        return;
      }
      run(item.command,item.id);
      input.focus({preventScroll:true});
    };
    el('commandReject').onclick=()=>{
      cancelPending('요청을 취소했습니다.');
      input.focus({preventScroll:true});
    };
    el('commandAbortRequest').onclick=()=>{
      status.textContent='';
      cancelRequest('외부 요청을 취소했습니다. 로컬 명령을 사용할 수 있습니다.');
    };
    el('commandClose').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{
      cancelPending();
      cancelRequest();
      status.textContent='';
      const target=opener?.getClientRects().length ? opener : el('marieOpen');
      target.focus({preventScroll:true});
    });

    const connection=el('commandConnection');
    el('commandConnect').onclick=()=>{
      cancelPending();
      cancelRequest();
      const value=el('commandEndpoint').value;
      adapterAddress=AsteriaMarieAdapter.endpoint(value);
      adapter=adapterAddress ? AsteriaMarieAdapter.create(adapterAddress) : null;
      connection.textContent=adapter ? '이 세션에서 외부 응답 제안 사용 중. 전송마다 승인이 필요합니다.'
        : '연결할 수 없습니다. 사용자 관리 HTTPS 프록시 주소를 입력해 주십시오.';
      status.textContent='';
    };
    el('commandDisconnect').onclick=()=>{
      adapter=adapterAddress=null;
      cancelPending();
      cancelRequest();
      el('commandEndpoint').value='';
      connection.textContent='외부 응답 OFF · 로컬 모드';
      status.textContent='';
    };
    el('commandRemember').onchange=event=>{
      const enabled=event.target.checked;
      if (!pref.setConsent(enabled)) status.textContent='브라우저 저장 설정을 변경할 수 없습니다.';
      showMemory();
    };
    el('commandClear').onclick=()=>{
      if (!pref.clear()) status.textContent='저장된 선호를 삭제할 수 없습니다.';
      else {status.textContent='선호 구역과 저장 동의를 삭제했습니다.';onPreference(null);}
      el('commandExportData').hidden=true;
      showMemory();
    };
    el('commandExport').onclick=()=>{
      el('commandExportData').hidden=false;
      showMemory();
      const file=new Blob([JSON.stringify(pref.export(),null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(file);
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download='asteria-marie-preferences.json';
      anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    showMemory();

    return {
      restorePreference(sectorId) {pref.absorb(sectorId);showMemory();},
      open(trigger) {
        opener=trigger;
        dialog.showModal();
        input.focus({preventScroll:true});
        if (!log.childElementCount) entry('marie','명령 수신 대기 중입니다. 예: 상태 보고');
      },
      sync() {
        if (pending?.command && !validApproval(pending,snapshot())) {
          cancelPending('함교 상태가 바뀌었거나 승인 시간이 만료되어 요청을 취소했습니다.');
        }
      },
    };
  }

  return {create};
})();
