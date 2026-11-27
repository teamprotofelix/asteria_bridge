'use strict';

// Shared geometry and interaction coordinates in bridge-local units.
const AsteriaInterior = (() => {
  const box = (x, z, width, depth) => [x-width/2, z-depth/2, x+width/2, z+depth/2];
  const consoles = [
    {x: 0, z: 3.45, width: 1.85, depth: 1.35},
    ...[-3.93, 3.93].flatMap(x => [1.9, -1.45].map(z => ({x, z, width: 1.15, depth: 1.75}))),
  ];
  const seats = {
    captain: {label: '함장석', eye: [-1.65, -.28, -.85], heading: 0, stand: [-1, 0, -.85]},
    lounge: {label: '라운지 좌석', eye: [1.55, -.28, -6.45], heading: Math.PI, stand: [.85, 0, -6.45]},
  };
  const stations = [
    {id: 'captain', label: '함장석 착석', x: -1, z: -.85, reach: 1.45},
    {id: 'lounge', label: '라운지 착석', x: .85, z: -6.45, reach: 1.2},
    {id: 'science', label: '과학 콘솔 · 항해 지도', x: -3.02, z: 1.9, reach: 1.22},
    {id: 'communications', label: '통신 콘솔 · 함교 음향', x: 3.02, z: 1.9, reach: 1.22},
    {id: 'hatch', label: '후방 출입문', x: 0, z: -4.86, reach: 1.65},
  ];
  const waypoints = {
    spawn: [0, 0, 0], forwardInspection: [1.60, 0, 3.05], aftInspection: [2.62, 0, -1.60],
    teaService: [-.5, 0, -.85], aftHatch: [0, 0, -4.86], lounge: [0, 0, -6.45],
  };
  const radius = .19;
  const hatchZ = -4.86;
  const obstacles = [
    ...consoles.map(({x,z,width,depth}) => box(x,z,width,depth)),
    ...Object.values(seats).map(({eye: [x,,z]}) => box(x,z,.90,.94)),
    box(-1.65,-6.62,1.22,.75),
  ];

  function nearHatch([x,,z]) {
    return Math.abs(x) < 1.11 && Math.abs(z-hatchZ) < .36;
  }

  function walkable([x,y,z], hatch = 0) {
    if (y < -.65 || y > .65) return false;
    const bridge = z >= -4.68 && z <= 4.72 && Math.abs(x) <= 4.52 && Math.abs(x)+Math.abs(z) <= 8.06;
    const passage = z >= -5.28 && z <= -4.68 && Math.abs(x) <= .88;
    const lounge = z <= -5.28 && z >= -7.61 && Math.abs(x) <= 2.89;
    if (!(bridge || passage || lounge)) return false;
    if (Math.abs(z-hatchZ) < .25 && Math.abs(x) + radius > .025 + 1.09*hatch) return false;
    return !obstacles.some(([minX,minZ,maxX,maxZ]) =>
      x > minX-radius && x < maxX+radius && z > minZ-radius && z < maxZ+radius);
  }

  function move(position, displacement, hatch) {
    const steps = Math.max(1, Math.ceil(Math.hypot(...displacement)/.10));
    const result = [...position];
    for (let i = 0; i < steps; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const candidate = [...result];
        candidate[axis] += displacement[axis]/steps;
        if (axis === 1) candidate[1] = Math.max(-.65, Math.min(.65, candidate[1]));
        if (walkable(candidate, hatch)) result[axis] = candidate[axis];
      }
    }
    return result;
  }

  function nearby([x,,z]) {
    return stations.find(station => Math.hypot(x-station.x, z-station.z) <= station.reach);
  }

  function hatchSensor([x,,z], open) {
    return Math.abs(x) < 1.12 && z < (open ? -2.15 : -2.55) && z > -6.05;
  }

  function acoustics(source, listener, right) {
    const offset = source.map((value, axis) => value - listener[axis]);
    const distance = Math.hypot(...offset);
    return {pan: offset.reduce((sum, value, i) => sum + value*right[i], 0)/Math.max(1,distance),
      level: 1/(1 + .055*distance*distance)};
  }

  return {consoles, seats, stations, waypoints, walkable, move, nearby, nearHatch, hatchSensor, acoustics};
})();

if (typeof module === 'object' && module.exports) module.exports = AsteriaInterior;
