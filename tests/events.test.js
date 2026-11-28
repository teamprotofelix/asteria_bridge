'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const context = vm.createContext({});
for (const file of ['sectors.js', 'space.js', 'events.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
}
const {AsteriaEvents, AsteriaSpace} = vm.runInContext('({AsteriaEvents, AsteriaSpace})', context);

test('the event catalog has 21 distinct events with regional eligibility', () => {
  assert.equal(Object.keys(AsteriaEvents.catalog).length, 21);
  const special = {
    flare: {star: true}, sunrise: {world: true}, eclipse: {moon: true},
    ring: {ring: true}, distress: {deep: true}, ruins: {relic: true},
    supernova: {deep: true}, dust: {belt: true}, portal: {portal: true},
    sunset: {world:true}, moonTransit: {moon:true},
    stellarFlare: {star:true,nearStar:true}, pulsar: {pulsar:true},
    nebulaTurbulence: {nebula:true}, fleet: {deep:true}, docking: {station:true},
  };
  for (const [type, conditions] of Object.entries(special)) {
    assert.equal(AsteriaEvents.start(type, {}, 4), null);
    assert.equal(AsteriaEvents.start(type, conditions, 4).start, 4);
  }
  assert.equal(AsteriaEvents.eligible('__proto__', {}), false);
});

test('a response extends tracking once and preserves visual progress', () => {
  const event = AsteriaEvents.start('comet', {}, 10);
  const original = AsteriaEvents.state(event, 18);
  const tracked = AsteriaEvents.respond(event, 18);
  assert.equal(tracked.end, event.end + 6);
  assert.equal(AsteriaEvents.state(tracked, 18).progress, original.progress);
  assert.equal(AsteriaEvents.respond(tracked, 19), tracked);
  assert.equal(AsteriaEvents.respond(event, event.end), event);
  assert.equal(AsteriaEvents.state(tracked, tracked.end).remaining, 0);
  assert.equal(AsteriaEvents.state(tracked, tracked.end).progress, 1);
});

test('protective actions reduce simulated load while the event is active', () => {
  const event = AsteriaEvents.start('flare', {star: true}, 0);
  const time = 6.5;
  assert.equal(AsteriaEvents.state(event, time).shield, 78);
  const protectedEvent = AsteriaEvents.respond(event, time);
  assert.equal(protectedEvent.end, event.end);
  assert.ok(AsteriaEvents.state(protectedEvent, time).shield > 90);
});

test('the Nereid route reaches the annulus while artificial rings are excluded', () => {
  const {nereid, halogate, singularity} = AsteriaSpace.scenes;
  assert.equal(AsteriaSpace.nearRing(nereid, .30, 0), false);
  assert.equal(AsteriaSpace.nearRing(nereid, .78, 0), true);
  assert.equal(AsteriaSpace.nearRing(nereid, 1, 0), false);
  assert.equal(AsteriaSpace.nearRing(halogate, .78, 0), false);
  assert.equal(AsteriaSpace.nearRing(singularity, .78, 0), false);
});


test('simulated moon alignment uses actual world positions and changes with the observer', () => {
  const scene=AsteriaSpace.scenes.nereid;
  const [body,moon]=AsteriaSpace.flightBodies(scene,4);
  const delta=moon.center.map((v,i)=>v-body.center[i]);
  const fromMoon=moon.center.map((v,i)=>v+delta[i]*2);
  const fromPlanet=body.center.map((v,i)=>v-delta[i]*2);
  assert.ok(AsteriaSpace.alignments(scene,4,fromMoon).transit);
  assert.ok(!AsteriaSpace.alignments(scene,4,fromPlanet).transit);
  const light=scene.keyLight ?? [-.61,.53,-.59];
  const towardLight=moon.center.map((v,i)=>v-light[i]*2);
  assert.ok(AsteriaSpace.alignments(scene,4,towardLight).eclipse);
  assert.ok(!AsteriaSpace.alignments(scene,4,fromPlanet).eclipse);
  assert.equal(AsteriaEvents.start('stellarFlare',{star:true},4),null);
});
