'use strict';

const AsteriaSectors = (() => {
  const groups = {
    star: '항성계',
    world: '외계 행성',
    deep: '심우주',
    relic: '미지 문명',
  };

  const presets = {
    star: { surface: 'star', emissive: true, radius: 2.7, fallback: 'solaris' },
    gas: { surface: 'gas', radius: 2.75, fallback: 'nereid' },
    ocean: { surface: 'earth', radius: 2.5, fallback: 'gaia' },
    rock: { surface: 'rock', radius: 2.3, fallback: 'eos' },
    ice: { surface: 'ice', radius: 2.35, fallback: 'selene' },
    dust: { surface: 'rock', belt: true, fallback: 'belt', background: 'nebula' },
    hole: { radius: 0.88, blackHole: true, fallback: 'singularity', background: 'nebula' },
    relic: { radius: .66, structure: true, fallback: 'deep' },
  };

  const moon = (distance, radius, speed) => ({distance, radius, speed});
  const ring = (inner, outer, normal) => ({inner, outer, normal});
  const entries = [
    ['star', 'helion', 'HELION', '헬리온 · 백색 주계열성', 'ST-01', 'star',
      {radius: 3.15, tint: [.88, 1.21, 2.15], atmosphere: [.77, .85, 1], spin: .023}],
    ['star', 'kallisto', 'KALLISTO', '칼리스토 · 적색 왜성', 'ST-02', 'star',
      {radius: 1.5, tint: [.94, .52, .31], atmosphere: [1, .19, .09], spin: .053}],
    ['star', 'velaris', 'VELARIS', '벨라리스 · 청백색 거성', 'ST-03', 'star',
      {radius: 3.65, tint: [.62, 1.35, 2.8], atmosphere: [.36, .67, 1], spin: .035, background: 'nebula'}],
    ['star', 'sereph', 'SEREPH', '세레프 · 쌍성계', 'ST-04', 'star',
      {radius: 2.25, moon: moon(4.35, 1.14, .037), tint: [1.04, 1.13, 1.42], atmosphere: [1, .68, .28]}],
    ['star', 'cinder', 'CINDER', '신더 · 백색 왜성과 파편 고리', 'ST-05', 'star',
      {radius: 1.08, tint: [.91, 1.32, 2.35], atmosphere: [.59, .77, 1],
        ring: ring(1.73, 3.75, [.11, .81, .55])}],

    ['world', 'thalassa', 'THALASSA', '탈라사 · 청록 해양 행성', 'PL-01', 'ocean',
      {tint: [.53, 1.27, 1.13], atmosphere: [.21, .93, .88], moon: moon(4.2, .38, .072)}],
    ['world', 'verdant', 'VERDANT', '베르단트 · 삼림과 구름대', 'PL-02', 'ocean',
      {radius: 2.8, tint: [.66, 1.45, .69], atmosphere: [.31, .87, .54], spin: .061}],
    ['world', 'vespera', 'VESPERA', '베스페라 · 황혼 사막 행성', 'PL-03', 'rock',
      {tint: [1.48, 1.05, .71], atmosphere: [.93, .53, .27], spin: .021}],
    ['world', 'cryon', 'CRYON', '크라이온 · 얼음 고리 행성', 'PL-04', 'ice',
      {tint: [.76, 1.06, 1.35], atmosphere: [.41, .75, 1],
        ring: ring(2.9, 4.3, [-.41, .88, .23])}],
    ['world', 'mistral', 'MISTRAL', '미스트랄 · 보랏빛 가스 행성', 'PL-05', 'gas',
      {radius: 3.1, tint: [.86, .63, 1.5], atmosphere: [.75, .39, 1], moon: moon(4.8, .62, .034)}],
    ['world', 'aurum', 'AURUM', '아우룸 · 황금빛 쌍고리', 'PL-06', 'gas',
      {radius: 2.35, tint: [1.29, .96, .54], atmosphere: [.95, .7, .32],
        ring: ring(2.88, 5.05, [.35, .86, -.27])}],
    ['world', 'obsidian', 'OBSIDIAN', '옵시디언 · 현무암 화산 지대', 'PL-07', 'rock',
      {radius: 2.75, tint: [.72, .39, .38], atmosphere: [1, .23, .12], spin: .05}],
    ['world', 'eirene', 'EIRENE', '에이레네 · 자색 얼음 달', 'PL-08', 'ice',
      {radius: 1.75, tint: [1.17, .76, 1.24], atmosphere: [.77, .49, .83], background: 'nebula'}],

    ['deep', 'emberrift', 'EMBER RIFT', '엠버 균열 · 적색 먼지와 파편', 'DS-01', 'dust',
      {tint: [1.36, .56, .37], skyTone: [1.45, .69, .44], swarm: [.33, 3.1, 1.1, 1.23]}],
    ['deep', 'glacier', 'GLACIER DRIFT', '빙하 표류대 · 성간 얼음 파편', 'DS-02', 'dust',
      {surface: 'ice', tint: [.62, 1.17, 1.46], skyTone: [.72, 1.03, 1.47], swarm: [1.2, 3.8, 2.5, 1.63]}],
    ['deep', 'wanderer', 'WANDERER', '방랑자 · 성간 떠돌이 행성', 'DS-03', 'rock',
      {radius: 1.85, tint: [.62, .85, 1.08], atmosphere: [.26, .48, .82], spin: .014}],
    ['deep', 'undertow', 'UNDERTOW', '언더토 · 푸른 강착 원반', 'DS-04', 'hole',
      {tint: [.37, .75, 1.45], skyTone: [.67, .82, 1.29], ring: ring(1.25, 4.4, [.16, .76, .61])}],
    ['deep', 'hush', 'THE HUSH', '고요 지대 · 자색 성운과 얼음 핵', 'DS-05', 'ice',
      {radius: 1.62, tint: [.64, .49, 1.1], atmosphere: [.28, .13, .62], background: 'nebula',
        skyTone: [.94, .53, 1.27]}],

    ['relic', 'halogate', 'HALO GATE', '헤일로 게이트 · 동심원 관문', 'CX-01', 'relic',
      {tint: [.27, 1, .95], ring: ring(1.58, 2.92, [.16, .34, .93]), structureStyle: 1}],
    ['relic', 'silentarray', 'SILENT ARRAY', '침묵 배열 · 분절형 안테나 유적', 'CX-02', 'relic',
      {tint: [.67, .76, 1], ring: ring(.83, 3.35, [-.25, .48, .84]), structureStyle: 2}],
    ['relic', 'ambervault', 'AMBER VAULT', '호박 금고 · 봉인된 환형 시설', 'CX-03', 'relic',
      {radius: 1.04, tint: [1, .67, .23], ring: ring(1.15, 2.68, [.54, .72, .43]), structureStyle: 3}],
    ['relic', 'palimpsest', 'PALIMPSEST', '팔림프세스트 · 가동 흔적이 남은 기록소', 'CX-04', 'relic',
      {tint: [.69, 1, .31], ring: ring(1.4, 3.18, [-.62, .24, .75]), structureStyle: 4,
        background: 'nebula'}],
    ['relic', 'mirrorward', 'MIRRORWARD', '미러워드 · 반사판 요새', 'CX-05', 'relic',
      {radius: .84, tint: [1, .38, .77], ring: ring(1.18, 3.45, [.18, .77, .62]), structureStyle: 5,
        background: 'nebula'}],
  ];

  function define([group, id, name, description, code, preset, overrides]) {
    return {group, id, name, description, code, scene: {...presets[preset], ...overrides}};
  }
  return { groups, additions: entries.map(define) };
})();
