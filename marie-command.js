'use strict';

const AsteriaCommand = (() => {
  const maxText = 180;
  const preferenceKey = 'asteria.marie.preferences.v1';
  const intents = new Set([
    'status','recommend','guide','plan_route','warp','start_watch','stop','stop_watch',
    'prepare_tea','receive_tea','launch_drone','recall_drone','follow','remember_sector',
  ]);
  const byDestination = new Set(['plan_route','warp','remember_sector']);
  const requiresApproval = new Set(['warp','start_watch']);
  const exact = {
    status: /^(?:상태(?:를)? (?:보고|알려 줘|알려줘)|상태|상태 보고해줘|상태 보고해 주세요|지금 어디야|현재 구역|현재 상황|보고해|status|report|where are we)$/,
    recommend: /^(?:관측지 추천|관측 추천|어디를 볼까|어디가 좋아|추천해 줘|추천해줘|recommend|recommend a sector)$/,
    guide: /^(?:도움말|함교 안내|조작법|어떻게 조종해|help|bridge guide|controls)$/,
    prepare_tea: /^(?:차|차 한 잔|차(?:를)? 준비해줘|차(?:를)? (?:준비|부탁|주문)|차(?:를)? 줘|tea|make tea|prepare tea)$/,
    receive_tea: /^(?:차 받기|차 받을게|차(?:를)? 받을게|receive tea|take tea)$/,
    launch_drone: /^(?:드론(?:을)? (?:파견|보내|보내 줘|보내줘|출격)|launch drone|send drone|deploy drone)$/,
    recall_drone: /^(?:드론(?:을)? (?:회수|귀환|돌아오게 해)|recall drone|stop drone)$/,
    start_watch: /^(?:자동 관측(?: (?:시작|켜|켜 줘|켜줘))?|start watch|start observation|auto observe)$/,
    stop_watch: /^(?:자동 관측 (?:정지|중지|종료|꺼|꺼 줘|꺼줘)|stop watch|stop observation)$/,
    stop: /^(?:정지|중지|멈춰|멈춰 줘|멈춰줘|비상 정지|워프 취소|출항 취소|stop|halt|abort)$/,
  };
  const route = [
    ['remember_sector', /^(?:선호 구역|선호 목적지|remember sector|favorite) (.+)$/],
    ['remember_sector', /^(.+?)(?:을|를)? (?:선호 구역으로|선호 목적지로) (?:기억|저장)$/],
    ['plan_route', /^(?:목적지|항로|경로|route to|plan route to|destination) (.+)$/],
    ['plan_route', /^(.+?)(?:으?로|까지)? (?:항로|경로)(?:를)? (?:설정|계획|준비|잡아)$/],
    ['warp', /^(?:워프(?: 목적지)?|warp to|go to|travel to) (.+)$/],
    ['warp', /^(.+?)(?:으?로|까지)? (?:워프|출항|가자|이동|항해)$/],
  ];

  function normalize(text) {
    return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
  }

  function clean(text) {
    return normalize(text).replace(/^(?:마리(?:야|님)?|marie)(?:[,! ]+|$)/,'')
      .replace(/[.!?]+$/,'').replace(/ (?:해 줘|해줘|해주세요|해 주세요|부탁해|부탁합니다|please)$/,'').trim();
  }

  function aliasesFor([id,name,description,code]) {
    return [id,name,description.split(' · ')[0],code,...({
      nereid:['네레드','네레이드행성'],gaia:['가야','가이야','gaiaa'],selene:['셀레니','selne'],
      halogate:['헤일로게잇','헤일로 게잍','halo gat'],deep:['딥 스페이스'],
    }[id] ?? [])].map(value=>normalize(value).replace(/[-\s]/g,''));
  }

  function parse(text,sectors) {
    const result=(intent,fields={})=>({kind:'command',command:{intent,...fields}});
    if (typeof text!=='string' || text.length>maxText) return {kind:'unsupported'};
    const input=clean(text);
    if (!input) return {kind:'empty'};
    for (const [intent,pattern] of Object.entries(exact)) {
      if (pattern.test(input)) return result(intent);
    }
    if (/^(?:동행 (?:켜|켜줘|시작)|따라와|follow|follow me)$/.test(input)) return result('follow',{enabled:true});
    if (/^(?:동행 (?:꺼|꺼줘|종료)|따라오지 마|stop following|unfollow)$/.test(input)) return result('follow',{enabled:false});
    if (/^(?:워프|출항|항로 설정|목적지 선택|이동|warp|travel|go|route|destination)$/.test(input)) {
      return {kind:'clarify', text:'목적지의 이름이나 구역 코드를 입력해 주십시오. 예: 가이아로 워프'};
    }
    if (/^(?:드론|drone)$/.test(input)) return {kind:'clarify',text:'드론 파견과 드론 귀환 중 어느 쪽입니까?'};
    // Commands consume the entire input. In particular, quoted JSON and compound requests are data.
    for (const [intent,pattern] of route) {
      const match=input.match(pattern);
      if (!match) continue;
      const target=match[1].replace(/[-\s]/g,'');
      const matching=sectors.filter(sector=>aliasesFor(sector).includes(target));
      if (matching.length===1) return result(intent,{sectorId:matching[0][0]});
      const alternatives=target.length>1 ? sectors.filter(sector=>aliasesFor(sector).some(alias=>alias.startsWith(target))) : [];
      const hint=alternatives.slice(0,3).map(([,name])=>name).join(', ');
      return {kind:'clarify',text:hint ? '전체 구역 이름을 확인해 주십시오. 후보 '+hint+'.'
        : '목적지를 확인할 수 없습니다. 구역 이름이나 코드를 입력해 주십시오.'};
    }
    return {kind:'unsupported'};
  }

  function validate(command,sectors) {
    if (!command || typeof command!=='object' || Array.isArray(command) || !Object.hasOwn(command,'intent') || !intents.has(command.intent)) return false;
    const fields=Object.keys(command);
    if (byDestination.has(command.intent)) {
      return fields.length===2 && Object.hasOwn(command,'sectorId') &&
        sectors.some(([id])=>command.sectorId===id);
    }
    if (command.intent==='follow') return fields.length===2 && typeof command.enabled==='boolean' && Object.hasOwn(command,'enabled');
    return fields.length===1 && Object.hasOwn(command,'intent');
  }

  function blocked(command,snapshot) {
    const {intent}=command;
    if (['status','recommend','guide','stop','stop_watch','recall_drone'].includes(intent)) return '';
    if (!snapshot.ready) return '함교가 준비 중입니다.';
    if (intent==='remember_sector') return '';
    if (snapshot.busy) return '항로 준비 또는 워프 중입니다. 안정 상태에서 다시 요청해 주십시오.';
    if (snapshot.warning) return '현재 위험 감시 중입니다. 상황 종료 후 다시 요청해 주십시오.';
    if (snapshot.watch && ['warp','plan_route','start_watch'].includes(intent)) return '먼저 자동 관측을 종료해 주십시오.';
    if (intent==='warp' && snapshot.sectorId===command.sectorId) return '이미 해당 구역에 있습니다.';
    return '';
  }

  function preferences(sectors,storage) {
    let saved=null, consent=false;
    function readConsent() {
      const item=JSON.parse(storage.getItem(preferenceKey) || 'null');
      if (item?.version===1 && item.consent===true) {
        consent=true;
        saved=sectors.some(([id])=>id===item.sectorId) ? item.sectorId : null;
      } else if (consent) {
        // A different tab revoked consent. Discard the value loaded under that consent.
        saved=null;
        consent=false;
      }
    }
    function reconcile() {
      try {readConsent();} catch {
        // A blocked store still permits in-session memory.
      }
    }
    reconcile();
    const write=(sectorId,enabled)=>{
      storage.setItem(preferenceKey,JSON.stringify({version:1,consent:enabled,sectorId}));
    };
    return {
      get consent() {return consent;},
      get sectorId() {return saved;},
      setConsent(enabled) {
        try {
          if (enabled && consent) readConsent();
          if (enabled) write(saved,true);
          else storage.removeItem(preferenceKey);
          consent=enabled;
          return true;
        } catch {return false;}
      },
      set(sectorId) {
        if (!sectors.some(([id])=>id===sectorId)) return false;
        try {readConsent();} catch {if (consent) return false;}
        if (consent) {
          try {write(sectorId,true);} catch {return false;}
        }
        saved=sectorId;
        return true;
      },
      clear() {
        try {storage.removeItem(preferenceKey);} catch {return false;}
        saved=null;
        consent=false;
        return true;
      },
      reconcile,
      export() {return {version:1,consent,sectorId:saved};},
    };
  }

  return {parse,validate,blocked,preferences,preferenceKey,requiresApproval,maxText};
})();

if (typeof module==='object' && module.exports) module.exports=AsteriaCommand;
