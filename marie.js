'use strict';

const AsteriaMarie = (() => {
  const teaInterval = 120;
  const teaSeconds = 8;
  const droneSeconds = 5;
  const hazards = {
    meteor: '유성우 접근. 보호막 상태를 확인합니다.',
    asteroid: '소행성 근접 통과. 안전 거리 확보를 권장합니다.',
    flare: '항성 플레어 감지. 보호막 보강을 권장합니다.',
    ring: '고리 파편층 진입. 항로와 보호막을 확인합니다.',
    dust: '먼지 구름 진입. 광학 필터 보정을 권장합니다.',
  };

  function activity(seconds, reduced) {
    const phase = seconds % 34;
    const {forwardInspection: [fx,,fz], aftInspection: [ax,,az]} = AsteriaInterior.waypoints;
    const front = [fx, fz], aft = [ax, az];
    let point = front, direction = phase >= 3 && phase < 7 ? .27 : 0, step = 0;
    let label = '계기판 점검';
    if (phase >= 7 && phase < 15) {
      const portion = (phase - 7) / 8;
      point = front.map((value, i) => value + (aft[i] - value)*portion);
      direction = -.22;
      step = Math.sin(seconds*7.4);
      label = '함교 순찰';
    } else if (phase >= 15 && phase < 22) {
      point = aft;
      direction = -1.4;
      label = '보조 계기판 점검';
    } else if (phase >= 22 && phase < 30) {
      const portion = (phase - 22) / 8;
      point = aft.map((value, i) => value + (front[i] - value)*portion);
      direction = Math.PI - .22;
      step = Math.sin(seconds*7.4);
      label = '함교 순찰';
    }
    return {point: reduced ? front : point, direction: reduced ? 0 : direction, step: reduced ? 0 : step, label};
  }

  function create(sectors, reduced) {
    const el = id => document.getElementById(id);
    const dialog = el('marieDialog');
    const activityLabel = el('marieActivity');
    const reportLabel = el('marieReport');
    const brief = el('marieBrief');
    const teaButton = el('marieTea');
    const droneButton = el('marieDrone');
    let current = 0;
    let route = null;
    let transit = false;
    let activeEvent = null;
    let drone = null;
    let tea = null;
    let clock = 0;
    let teaAt = teaInterval;
    let report = '함장님, 함교 점검을 시작합니다.';
    let motion = activity(0, reduced);

    const name = index => sectors[index][1];
    const code = index => sectors[index][3];
    const signal = () => activeEvent === 'signal' || activeEvent === 'distress';
    const warning = () => hazards[activeEvent];

    function refresh() {
      const label = warning() ? '위험 감시' : transit ? '항해 감시' : drone === 'ready' ? '탐사 제안'
        : drone !== null && drone !== 'done' ? '드론 관측'
        : tea === 'ready' ? '차 준비 완료' : typeof tea === 'number' ? '차 준비 중' : motion.label;
      if (brief.textContent !== label) brief.textContent = label;
      if (!dialog.open) return;
      if (activityLabel.textContent !== label) activityLabel.textContent = label;
      const message = warning() || report;
      if (reportLabel.textContent !== message) reportLabel.textContent = message;
      teaButton.disabled = transit || !!warning() || typeof tea === 'number' || typeof drone === 'number';
      const teaAction = tea === 'ready' ? '차 받기' : '차 준비';
      if (teaButton.textContent !== teaAction) teaButton.textContent = teaAction;
      droneButton.hidden = !signal();
      droneButton.disabled = drone !== 'ready' || transit;
    }

    function prepareTea() {
      tea = clock + teaSeconds;
      teaAt = clock + teaInterval;
      report = '차를 준비합니다. 함장님, 잠시 기다려 주십시오.';
    }

    teaButton.onclick = () => {
      if (transit || warning() || typeof tea === 'number' || typeof drone === 'number') return;
      if (tea === 'ready') {
        tea = null;
        teaAt = clock + teaInterval;
        report = '차를 올려두었습니다. 물 온도 확인 완료.';
      } else {
        prepareTea();
      }
      refresh();
    };

    droneButton.onclick = () => {
      if (!signal() || drone !== 'ready' || transit) return;
      drone = clock + droneSeconds;
      report = '탐사 드론 파견. 신호 방향과 반복 주기를 측정합니다.';
      refresh();
    };

    el('marieStatus').onclick = () => {
      if (transit) report = route === null ? '워프 상태 점검 중입니다.' : name(route) + ' 항로를 추적 중입니다.';
      else if (drone === 'ready') report = '미확인 신호에 탐사 드론을 파견할 수 있습니다.';
      else if (typeof drone === 'number') report = '탐사 드론에서 관측 데이터를 수신 중입니다.';
      else if (tea === 'ready') report = '함장님, 차가 준비되었습니다.';
      else if (typeof tea === 'number') report = '차를 준비 중입니다.';
      else report = name(current) + ' 구역. 관측창과 항해 계기판 상태 정상입니다.';
      refresh();
    };

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
        if (drone === 'ready' || typeof drone === 'number') return;
        report = route === null ? '함장님, 현재 구역의 관측을 유지합니다.'
          : name(current) + ' → ' + name(route) + '. 목적지 ' + code(route) + ' 항로를 분석했습니다.';
        refresh();
      },
      failed() {
        report = '목적지 자료를 불러오지 못했습니다. ' + name(current) + '에서 대기합니다.';
        refresh();
      },
      depart(index) {
        transit = true;
        route = index;
        report = index === null ? '워프 개시. 함교 계기판을 감시합니다.'
          : name(index) + '로 출항합니다. 항로 ' + code(index) + ' 확인 완료.';
        refresh();
      },
      arrive(index) {
        current = index;
        route = null;
        transit = false;
        report = name(index) + ' 도착. ' + sectors[index][2] + '. 관측을 시작할 수 있습니다.';
        refresh();
      },
      event(type) {
        const droneInterrupted = typeof drone === 'number';
        activeEvent = type;
        drone = signal() ? 'ready' : null;
        if (signal()) {
          report = (type === 'distress' ? '구조 신호 수신.' : '미확인 신호 감지.')
            + ' 함장님, 탐사 드론 파견을 제안합니다.';
        } else if (droneInterrupted) {
          report = '신호 추적을 종료하고 드론을 귀환시켰습니다.';
        } else if (type === null && !transit) {
          report = '상황 종료. ' + name(current) + ' 구역 관측을 재개합니다.';
        }
        refresh();
      },
      advance(dt) {
        clock += dt;
        motion = activity(clock, reduced);
        if (typeof drone === 'number' && clock >= drone) {
          drone = 'done';
          report = name(current) + ' 조사 완료. 드론이 반복 신호의 방향을 기록했습니다. 발신원 분류는 보류합니다.';
        }
        if (typeof tea === 'number' && clock >= tea && !transit && !warning()) {
          tea = 'ready';
          if (!signal()) report = '함장님, 차가 준비되었습니다.';
        }
        if (tea === null && drone === null && !transit && !warning() && clock >= teaAt) prepareTea();
        refresh();
      },
      pose() {
        const position = transit || warning() ? activity(0, true) : motion;
        return {...position, tea: tea === 'ready' && !transit && !warning()};
      },
    };
  }

  function model(box, quad, mark) {
    const uniform = [.055,.075,.11], seam = [.11,.16,.22], linen = [.81,.87,.88];
    const skin = [.69,.49,.39], hair = [.19,.116,.10], trim = [.48,.65,.71];

    function loft(levels, color) {
      const sides = 12;
      function point([y, rx, rz, cx = 0, cz = 0], index) {
        const a = index/sides * Math.PI * 2;
        return [cx + Math.cos(a)*rx, y, cz + Math.sin(a)*rz];
      }
      for (let row = 1; row < levels.length; row++) {
        for (let i = 0; i < sides; i++) {
          const shadow = .82 + .18 * Math.max(0, Math.cos(i/sides * Math.PI * 2));
          quad(point(levels[row-1], i), point(levels[row-1], i+1),
            point(levels[row], i+1), point(levels[row], i), color, shadow);
        }
      }
    }

    loft([[.59,.32,.205],[.65,.31,.2],[.87,.22,.15],[1.02,.13,.105]], uniform);
    loft([[.56,.31,.202],[.59,.32,.207]], seam);
    loft([[.99,.135,.11],[1.13,.18,.116],[1.26,.215,.11],[1.30,.13,.073]], uniform);
    loft([[.99,.142,.116],[1.035,.145,.115]], linen);
    quad([-.22,.615,-.155],[.22,.615,-.155],[.095,1.026,-.093],[-.095,1.026,-.093], linen);
    quad([-.095,1.035,-.110],[.095,1.035,-.110],[.077,1.19,-.109],[-.077,1.19,-.109], linen);
    quad([-.092,1.255,-.101],[.092,1.255,-.101],[.071,1.30,-.077],[-.071,1.30,-.077], linen);
    box([-.019,1.222,-.132],[.019,1.263,-.114], trim);
    for (const side of [-1, 1]) {
      loft([[.96,.045,.042,side*.252,-.02],[1.075,.052,.05,side*.244,.007],
        [1.20,.074,.069,side*.203,0],[1.268,.033,.032,side*.191,0]], uniform);
      loft([[.946,.047,.043,side*.253,-.023],[.981,.050,.045,side*.253,-.022]], linen);
      loft([[.888,.025,.022,side*.25,-.041],[.949,.044,.039,side*.252,-.026]], skin);
    }
    loft([[1.25,.051,.045],[1.386,.058,.051]], skin);
    loft([[1.346,.032,.062,0,-.006],[1.39,.082,.083,0,-.008],
      [1.52,.102,.104],[1.637,.074,.077],[1.674,.009,.01]], skin);
    loft([[1.425,.112,.082,0,.052],[1.525,.113,.108,0,.016],
      [1.624,.094,.092],[1.693,.051,.066],[1.715,0,0]], hair);
    for (const side of [-1, 1]) {
      loft([[1.338,.016,.024,side*.086,.041],[1.45,.029,.052,side*.092,.04],
        [1.548,.030,.059,side*.082,.001]], hair);
      const x = side*.044;
      box([x-.016,1.492,-.105],[x+.016,1.507,-.098], [.17,.12,.115]);
      box([x-.006,1.497,-.108],[x+.005,1.505,-.105], [.56,.37,.31]);
    }
    box([-.018,1.420,-.091],[.020,1.427,-.086], [.43,.25,.22]);
    loft([[1.627,.086,.088],[1.648,.083,.084]], linen);
    quad([-.061,1.645,-.083],[.061,1.645,-.083],[.049,1.695,-.056],[-.049,1.695,-.056], linen);
    const bodyEnd = mark();

    const legEnds = [];
    for (const x of [-.107,.107]) {
      loft([[.075,.042,.044,x],[.29,.058,.053,x],[.55,.064,.06,x],[.66,.078,.069,x]], uniform);
      loft([[.045,.059,.103,x,-.041],[.112,.057,.078,x,-.024],
        [.155,.042,.048,x]], seam);
      legEnds.push(mark());
    }
    box([-.27,.891,-.347],[.27,.916,-.13], trim);
    loft([[.917,.037,.039,0,-.25],[.992,.047,.049,0,-.25],[1.00,.043,.045,0,-.25]], linen);
    box([.042,.949,-.264],[.072,.979,-.237], linen);
    return [bodyEnd, ...legEnds, mark()];
  }

  return {create, model};

})();
