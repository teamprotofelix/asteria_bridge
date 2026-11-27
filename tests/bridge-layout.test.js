'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {walkable, move, seats, waypoints, nearHatch, hatchSensor, acoustics} = require('../bridge-layout.js');

test('bridge spawn, dismount and service positions stay clear of interior geometry', () => {
  for (const point of [waypoints.spawn, waypoints.forwardInspection, waypoints.aftInspection,
    waypoints.teaService, seats.captain.stand, seats.lounge.stand]) {
    assert.ok(walkable(point), String(point));
  }
  assert.ok(!walkable(seats.captain.eye));
  assert.ok(!walkable(seats.lounge.eye));
  assert.equal(move(waypoints.spawn,[0,8,0],0)[1],.65);
  assert.equal(move(waypoints.spawn,[0,-8,0],0)[1],-.65);
});

test('long frames cannot tunnel through the console, glazing or pressure door', () => {
  const front = move(waypoints.spawn,[0,0,10],0);
  assert.ok(front[2] > 2.35 && front[2] < 2.59, front);
  const side = move([0,0,.2],[10,0,0],0);
  assert.ok(side[0] > 4.34 && side[0] <= 4.52, side);
  const closed = move(waypoints.spawn,[0,0,-7],0);
  const open = move(waypoints.spawn,[0,0,-7],1);
  assert.ok(closed[2] > -4.64, closed);
  assert.ok(open[2] < -6.95, open);
  assert.ok(move(open,[0,0,-9],1)[2] >= -7.61);
  assert.ok(move(open,[0,0,7],1)[2] > -.12);
  assert.ok(nearHatch([0,0,-4.86]));
  assert.ok(hatchSensor([0,0,-2.7],false));
  assert.ok(!nearHatch(open));
});

test('bridge audio responds to camera heading and distance', () => {
  const source = [4,0,0], listener = [0,0,0];
  const forward = acoustics(source,listener,[1,0,0]);
  const reversed = acoustics(source,listener,[-1,0,0]);
  assert.equal(forward.pan,1);
  assert.equal(reversed.pan,-1);
  assert.equal(forward.level,reversed.level);
  assert.ok(acoustics(source,[3,0,0],[1,0,0]).level > forward.level);
});
