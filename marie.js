'use strict';

const AsteriaMarie = (() => {
  const teaInterval = 120;
  const labels = {
    IDLE: '대기', PATROL: '함교 순찰', CHECK_CONSOLE: '계기판 점검',
    OBSERVE: '관측창 감시', FOLLOW: '함장님 동행', REPORT: '상태 보고',
    REST: '지정석 휴식', ALERT: '위험 감시', ASSIST_NAVIGATION: '항해 감시',
    PREPARE_TEA: '차 준비 중', SERVE_TEA: '차 대접 중', CONTROL_DRONE: '드론 관측',
  };
  const hazards = {
    meteor: '유성우 접근. 보호막 상태를 확인합니다.',
    asteroid: '소행성 근접 통과. 안전 거리 확보를 권장합니다.',
    flare: '항성 플레어 감지. 보호막 보강을 권장합니다.',
    ring: '고리 파편층 진입. 항로와 보호막을 확인합니다.',
    dust: '먼지 구름 진입. 광학 필터 보정을 권장합니다.',
  };

  function create(sectors, reduced) {
    const el = id => document.getElementById(id);
    const dialog = el('marieDialog');
    const activity = el('marieActivity');
    const reportLabel = el('marieReport');
    const brief = el('marieBrief');
    const teaButton = el('marieTea');
    const droneButton = el('marieDrone');
    const followButton = el('marieFollow');
    const droneCancel = el('marieDroneCancel');
    const dronePhase = el('marieDronePhase');
    const motion = AsteriaMarieMotion.create(AsteriaInterior,reduced);
    let current=0, route=null, transit=false, activeEvent=null, drone=null, tea=null;
    let clock=0, teaAt=teaInterval, reportUntil=0, follow=false;
    let report = '함장님, 함교 점검을 시작합니다.';

    const name = index => sectors[index][1];
    const code = index => sectors[index][3];
    const signal = () => activeEvent === 'signal' || activeEvent === 'distress';
    const warning = () => hazards[activeEvent];
    const droneActive = () => drone && drone.phase !== 'done';
    const droneStatus = () => {
      if (!drone) return '';
      if (drone.phase === 'done') return '귀환 완료 · 모의 조사';
      if (drone.elapsed < .9) return '드론 출격 중';
      if (drone.elapsed < 3.9) return '드론 신호 조사 중';
      return '드론 귀환 중';
    };

    function display(element, text) {
      if (element.textContent !== text) element.textContent=text;
    }

    function refresh() {
      const label = warning() ? labels.ALERT : transit ? labels.ASSIST_NAVIGATION
        : droneActive() ? labels.CONTROL_DRONE : signal() && !drone ? '탐사 제안'
        : tea?.phase === 'ready' ? '차 준비 완료'
        : tea?.phase === 'serve' ? labels.SERVE_TEA : tea ? labels.PREPARE_TEA
        : labels[motion.pose().state];
      display(brief,label);
      if (!dialog.open) return;
      display(activity,label);
      display(reportLabel,warning() || report);
      teaButton.disabled=transit || !!warning() || (!!tea && tea.phase !== 'ready') || !!droneActive();
      display(teaButton,tea?.phase === 'ready' ? '차 받기' : '차 준비');
      droneButton.hidden=!signal();
      droneButton.disabled=!!drone || transit || !!warning();
      droneCancel.hidden=!droneActive();
      display(dronePhase,droneStatus());
      followButton.setAttribute('aria-pressed',String(follow));
      display(followButton,follow ? '동행 끄기' : '동행 켜기');
    }

    function prepareTea() {
      tea={phase:'prepare',elapsed:0};
      teaAt=clock+teaInterval;
      report='차를 준비합니다. 함장님, 잠시 기다려 주십시오.';
    }

    teaButton.onclick = () => {
      if (transit || warning() || droneActive() || (tea && tea.phase !== 'ready')) return;
      if (tea) {
        tea=null;
        teaAt=clock+teaInterval;
        report='차를 올려두었습니다. 물 온도 확인 완료.';
      } else prepareTea();
      refresh();
    };

    droneButton.onclick = () => {
      if (!signal() || drone || transit || warning()) return;
      drone={phase:'flight',elapsed:0};
      report='탐사 드론 파견. 신호 방향과 반복 주기를 측정합니다.';
      refresh();
    };

    droneCancel.onclick = () => {
      if (!droneActive()) return;
      drone=null;
      report='드론 조사를 취소했습니다. 드론을 귀환시켰습니다.';
      refresh();
    };

    followButton.onclick = () => {
      follow=!follow;
      if (!warning() && !transit && !tea && !signal()) {
        report=follow ? '함교 이동 중 거리를 유지하며 동행합니다.' : '동행 종료. 함교 순찰을 재개합니다.';
      }
      refresh();
    };

    el('marieStatus').onclick = () => {
      if (transit) report = route === null ? '워프 상태 점검 중입니다.' : name(route) + ' 항로를 추적 중입니다.';
      else if (droneActive()) report = '탐사 드론에서 관측 데이터를 수신 중입니다.';
      else if (signal() && !drone) report = '미확인 신호에 탐사 드론을 파견할 수 있습니다.';
      else if (tea?.phase === 'ready') report = '함장님, 차가 준비되었습니다.';
      else if (tea) report = '차를 준비 중입니다.';
      else {
        report = name(current) + ' 구역. 관측창과 항해 계기판 상태 정상입니다.';
        if (clock >= reportUntil) reportUntil=clock+2.5;
      }
      refresh();
    };

    function intent(bridge) {
      if (warning()) return {state:'ALERT'};
      if (transit || bridge.loading) return {state:'ASSIST_NAVIGATION'};
      if (droneActive()) return {state:'CONTROL_DRONE'};
      if (tea) return {state:tea.phase === 'prepare' ? 'PREPARE_TEA' : 'SERVE_TEA',tray:tea.phase !== 'prepare'};
      if (clock<reportUntil) return {state:'REPORT'};
      if (follow && bridge.walking) return {state:'FOLLOW'};
      return {};
    }

    el('marieClose').onclick = () => dialog.close();
    refresh();
    return {
      open() {
        dialog.showModal();
        refresh();
      },
      plan(index) {
        if (transit) return;
        route = index === current ? null : index;
        if (signal() || droneActive()) return;
        report = route === null ? '함장님, 현재 구역의 관측을 유지합니다.'
          : name(current) + ' → ' + name(route) + '. 목적지 ' + code(route) + ' 항로를 분석했습니다.';
        refresh();
      },
      failed() {
        report = '목적지 자료를 불러오지 못했습니다. ' + name(current) + '에서 대기합니다.';
        refresh();
      },
      depart(index) {
        transit=true;
        route=index;
        drone=null;
        reportUntil=0;
        report=index === null ? '워프 개시. 함교 계기판을 감시합니다.'
          : name(index) + '로 출항합니다. 항로 ' + code(index) + ' 확인 완료.';
        refresh();
      },
      arrive(index) {
        current=index;
        route=null;
        transit=false;
        report=name(index) + ' 도착. ' + sectors[index][2] + '. 관측을 시작할 수 있습니다.';
        refresh();
      },
      event(type) {
        const interrupted=droneActive();
        activeEvent=type;
        drone=null;
        if (signal()) {
          report=(type === 'distress' ? '구조 신호 수신.' : '미확인 신호 감지.')
            + ' 함장님, 탐사 드론 파견을 제안합니다.';
        } else if (interrupted) {
          report='신호 추적을 종료하고 드론을 귀환시켰습니다.';
        } else if (type === null && !transit) {
          report=name(current) + ' 구역 관측을 재개합니다.';
        }
        refresh();
      },
      advance(dt,bridge) {
        clock+=dt;
        const order=intent(bridge);
        const reached=motion.advance(dt,order,bridge);
        if (order.state === 'CONTROL_DRONE') {
          drone.elapsed+=dt;
          if (drone.elapsed>=5) {
            drone.phase='done';
            report=name(current) + ' 조사 완료. 모의 데이터: 반복 신호 방위 024°, 주기 7.2초. 발신원 분류는 보류합니다.';
          }
        } else if (order.state === 'PREPARE_TEA') {
          tea.elapsed+=dt;
          if (tea.elapsed>=3 && (reached || tea.elapsed>=4)) tea.phase='serve';
        } else if (order.state === 'SERVE_TEA' && tea.phase !== 'ready') {
          tea.elapsed+=dt;
          if (tea.elapsed>=8 && (reached || tea.elapsed>=12)) {
            tea.phase='ready';
            const where=reached ? '' : ' 통로가 비면 접근하겠습니다.';
            if (!signal()) report='함장님, 차가 준비되었습니다.' + where;
          }
        }
        if (!tea && !drone && !signal() && !transit && !bridge.loading && !warning() && clock>=teaAt) prepareTea();
        refresh();
      },
      pose: motion.pose,
      droneView() {
        if (!droneActive()) return null;
        const t=drone.elapsed;
        return {label:droneStatus(), progress:t<.9 ? t/.9 : t<3.9 ? 1 : (5-t)/1.1};
      },
    };
  }
  return {create};
})();
