'use strict';

const AsteriaEvents = (() => {
  const catalog = {
    meteor: {
      name: '유성우', code: 'METEOR SHOWER', seconds: 12, load: 12,
      description: '미세 유성체 흐름 감지. 관측 보호막 작동.',
      action: ['보호막 보강', '보강 완료. 유성체에 따른 보호막 부하를 줄였습니다.'],
    },
    asteroid: {
      name: '소행성 통과', code: 'NEAR FLYBY', seconds: 14, load: 10,
      description: '암석 천체가 인접 항로를 가로지릅니다.',
      action: ['안전 거리 유지', '우회 경로를 확보했습니다. 안전 거리에서 통과를 관측합니다.'],
    },
    comet: {
      name: '혜성 조우', code: 'COMET', seconds: 18,
      description: '청백색 이온 꼬리와 먼지 꼬리를 관측합니다.',
      action: ['혜성 추적', '혜성 궤도에 추적기를 맞췄습니다. 관측 시간을 6초 연장합니다.'], extension: 6,
    },
    flare: {
      name: '태양 폭풍', code: 'SOLAR STORM', seconds: 13, load: 22, when: c => c.star,
      requirement: '항성 구역',
      description: '항성 플레어와 고에너지 입자 흐름을 감지했습니다.',
      action: ['보호막 보강', '보강 완료. 플레어에 따른 보호막 부하를 줄였습니다.'],
    },
    signal: {
      name: '미확인 신호', code: 'SIGNAL DETECTED', seconds: 16,
      description: '원거리 공명 신호를 레이더에서 추적합니다.',
      action: ['신호 분석', '반복되는 반송파를 분리했습니다. 신호 출처는 조사 중입니다.'],
    },
    flyby: {
      name: '탐사선 조우', code: 'PROBE CONTACT', seconds: 17,
      description: '무인 탐사선이 시야를 가로지릅니다.',
      action: ['식별 요청', '탐사선의 자동 식별 응답을 수신했습니다. 관측 시간을 5초 연장합니다.'], extension: 5,
    },
    sunrise: {
      name: '행성 일출', code: 'PLANETARY SUNRISE', seconds: 20, when: c => c.world, requirement: '행성 구역',
      description: '행성 가장자리로 항성빛이 번집니다.',
      action: ['분광 기록', '대기층을 통과한 첫 항성빛의 스펙트럼을 기록했습니다.'],
    },
    eclipse: {
      name: '개기일식', code: 'TOTAL ECLIPSE', seconds: 24, when: c => c.moon, requirement: '위성이 있는 행성',
      description: '위성이 항성의 원반 앞을 가로지릅니다.',
      action: ['코로나 촬영', '코로나 관측을 시작했습니다. 추적 시간을 5초 연장합니다.'], extension: 5,
    },
    ring: {
      name: '고리 통과', code: 'RING PASSAGE', seconds: 10, load: 8, when: c => c.ring, requirement: '실시간 3D 고리 접근',
      description: '항로가 행성 고리의 파편층에 진입했습니다.',
      action: ['안전 거리 유지', '파편층에 맞춰 안전 거리를 확보했습니다. 보호막 부하를 줄였습니다.'],
    },
    distress: {
      name: '구조 신호', code: 'DISTRESS BEACON', seconds: 28, when: c => c.deep || c.relic, requirement: '심우주 또는 미지 문명',
      description: '구조 채널에서 간헐적인 위치 신호를 수신 중입니다.',
      action: ['좌표 확인', '신호의 마지막 좌표를 수신했습니다. 추가 수신 시간을 8초 확보했습니다.'], extension: 8,
    },
    ruins: {
      name: '고대 유적', code: 'ANCIENT RUINS', seconds: 26, when: c => c.relic, requirement: '미지 문명 구역',
      description: '환형 구조물 표면에 규칙적인 광문이 감지됩니다.',
      action: ['문양 분석', '반복되는 광문 배열을 기록했습니다. 분석 시간을 8초 연장합니다.'], extension: 8,
    },
    supernova: {
      name: '초신성 관측', code: 'SUPERNOVA', seconds: 22, when: c => c.deep, requirement: '심우주 구역',
      description: '원거리 항성에서 확장하는 발광 껍질을 관측합니다.',
      action: ['노출 낮추기', '관측창 노출을 낮췄습니다. 팽창하는 외곽층이 더 잘 보입니다.'],
    },
    dust: {
      name: '우주 먼지', code: 'DUST CLOUD', seconds: 18, load: 6, when: c => c.deep || c.belt, requirement: '심우주 또는 파편대',
      description: '미세 먼지 구름이 관측 시야를 흐리게 합니다.',
      action: ['필터 보정', '광학 필터를 보정했습니다. 먼지에 의한 시야 저하와 보호막 부하를 줄였습니다.'],
    },
    portal: {
      name: '차원 포탈', code: 'DIMENSIONAL PORTAL', seconds: 30, when: c => c.portal, requirement: '헤일로 게이트 또는 팔림프세스트',
      description: '유적 앞에 간헐적인 공간 왜곡이 형성됩니다.',
      action: ['포탈 공명 분석', '공명 분석을 시작했습니다. 열린 구조를 10초 더 관측합니다.'], extension: 10,
    },
  };

  function eligible(type, context) {
    const entry = catalog[type];
    return Object.hasOwn(catalog, type) && (!entry.when || entry.when(context));
  }

  function start(type, context, time) {
    if (!eligible(type, context)) return null;
    return {type, start: time, end: time + catalog[type].seconds, responded: false};
  }

  function respond(event, time) {
    if (!event || event.responded || time >= event.end) return event;
    const extension = catalog[event.type].extension ?? 0;
    return {...event, responded: true, responseAt: time, end: event.end + extension};
  }

  function state(event, time) {
    const {seconds, load = 0, extension = 0} = catalog[event.type];
    let progress = (time - event.start) / seconds;
    if (event.responded && extension) {
      const atResponse = (event.responseAt - event.start) / seconds;
      progress = atResponse + (1 - atResponse) * (time - event.responseAt) / (event.end - event.responseAt);
    }
    progress = Math.max(0, Math.min(1, progress));
    return {
      progress,
      remaining: Math.max(0, Math.ceil(event.end - time)),
      shield: Math.round(100 - load * Math.sin(Math.PI * progress) * (event.responded ? .34 : 1)),
    };
  }

  function draw(event, time, {ctx, width, height, project, reduced}) {
    const animated = state(event, time).progress;
    const p = reduced ? .52 : animated;
    const fade = reduced ? .8 : Math.min(1, p * 6, (1 - p) * 6);
    const focus = project(.45, .43, 5);
    const radius = Math.min(width, height) * .12;

    function glow(x, y, size, color, power) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, size);
      g.addColorStop(0, 'rgba(' + color + ',' + power + ')');
      g.addColorStop(1, 'rgba(' + color + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    }

    function disc(x, y, size, fill) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    function ring(x, y, size, color, weight = 1, flatten = 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = weight;
      ctx.beginPath();
      ctx.ellipse(x, y, size, size * flatten, -.14, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (event.type === 'dust' || event.type === 'ring') {
      const dust = event.type === 'dust';
      const strength = event.responded ? .42 : 1;
      if (dust) glow(width * .5, height * .50, Math.max(width, height) * .78, '195,162,138', .18 * fade * strength);
      for (let i = 0; i < 40; i++) {
        const phase = (p * 1.3 + i * .127) % 1;
        const point = project(Math.sin(i * 2.39) * (3 + phase * 2), Math.cos(i * 3.14) * (dust ? 2 : .45), 8 - phase * 5);
        if (point) disc(point[0], point[1], dust ? 1 : 1.8, 'rgba(224,206,176,' + .33 * fade * strength + ')');
      }
      return;
    }
    if (!focus) return;
    const [x, y] = focus;

    switch (event.type) {
      case 'sunrise': {
        const rise = y + radius * (.64 - p * 1.32);
        glow(x, rise, radius * 2, '255,164,71', .38 * fade);
        disc(x, rise, radius * .49, 'rgba(255,235,180,' + fade + ')');
        disc(x, y + radius * 1.60, radius * 1.75, 'rgba(10,18,30,' + fade + ')');
        ring(x, y + radius * 1.60, radius * 1.75, 'rgba(255,178,77,' + .50 * fade + ')');
        break;
      }
      case 'eclipse': {
        const lunarX = x + (p - .52) * radius * 3.1;
        glow(x, y, radius * 1.58, '165,211,255', .62 * fade);
        disc(x, y, radius * .56, 'rgba(236,247,255,' + fade + ')');
        disc(lunarX, y, radius * .59, 'rgba(8,12,23,' + fade + ')');
        if (event.responded) ring(x, y, radius * .82, 'rgba(135,216,251,.57)');
        break;
      }
      case 'distress': {
        const pulse = .35 + (p * 4 % 1);
        glow(x, y, radius, '255,122,105', .53 * fade);
        ring(x, y, radius * pulse, 'rgba(255,148,133,' + fade + ')', 2);
        if (event.responded) ring(x, y, radius * .72, 'rgba(124,237,221,.84)', 2, .65);
        break;
      }
      case 'ruins': {
        const alpha = (event.responded ? .88 : .52) * fade;
        for (let i = 0; i < 10; i++) {
          const a = i * Math.PI / 5;
          ring(x + Math.cos(a) * radius, y + Math.sin(a) * radius * .47, 4 + i % 3, 'rgba(136,240,215,' + alpha + ')', 2);
        }
        ring(x, y, radius * 1.12, 'rgba(130,224,219,' + alpha + ')', 2, .61);
        break;
      }
      case 'supernova': {
        const size = radius * (.7 + 2.3 * p);
        const exposure = event.responded ? .43 : .8;
        glow(x, y, size, '164,163,255', fade * exposure);
        ring(x, y, size * .76, 'rgba(173,222,255,' + fade + ')', 2);
        ring(x, y, size * .91, 'rgba(245,175,228,' + .46 * fade + ')', 2);
        break;
      }
      case 'portal': {
        const size = radius * (event.responded ? 1.28 : .85) * (.68 + .32 * fade);
        glow(x, y, size * 1.68, '81,137,249', .59 * fade);
        disc(x, y, size * .70, 'rgba(15,23,58,' + .82 * fade + ')');
        ring(x, y, size, 'rgba(147,218,255,' + fade + ')', 3, .72);
        ring(x, y, size * 1.16, 'rgba(185,157,255,' + .6 * fade + ')', 1.8, .72);
        break;
      }
    }
  }

  return {catalog, eligible, start, respond, state, draw};
})();
