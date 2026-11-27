'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const motion = require('../marie-motion.js');
const rig = require('../marie-rig.js');
const interior = require('../bridge-layout.js');
const manifest = require('../assets/crew/manifest.json');
const crew = [1.60,3.05];

test('crew route respects consoles, tracks around visitors and stops at closed pressure doors', () => {
  const safe = motion.path([2.62,-1.6],[-.5,-.85],0,[1,-1],interior);
  assert.ok(safe.length>1);
  assert.ok(safe.every(p=>motion.canWalk(p,0,[1,-1],interior)));
  assert.deepEqual(motion.path([0,-3],[0,-6.45],0,null,interior),[]);
  assert.ok(motion.path([0,-3],[0,-6.45],1,null,interior).length);
  const bounded = interior.move([1.60,0,1.6],[0,0,4],0,crew);
  assert.ok(bounded[2]<2.68 && bounded[2]>2.45);
});

test('following holds personal distance, and reduced motion advances the gesture in place', () => {
  const visitor = {walking:true,hatch:0,eye:[0,0,0]};
  const regular = motion.create(interior,false);
  for (let i=0;i<250;i++) regular.advance(.06,{state:'FOLLOW'},visitor);
  const distance = Math.hypot(...regular.pose().point);
  assert.ok(distance>=1.2 && distance<=1.6,distance);
  const reduced = motion.create(interior,true);
  for (let i=0;i<180;i++) reduced.advance(.06,{state:'SERVE_TEA',tray:true},visitor);
  assert.deepEqual(reduced.pose().point,crew);
  assert.equal(reduced.pose().state,'SERVE_TEA');
  assert.equal(reduced.pose().tea,true);
});

test('GLB masters match their manifest and contain valid skin and clip references', () => {
  for (const asset of manifest.assets) {
    const bytes = fs.readFileSync(path.join(__dirname,'..',asset.path));
    assert.equal(bytes.length,asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    assert.equal(bytes.subarray(0,4).toString(),'glTF');
    assert.equal(bytes.readUInt32LE(4),2);
    assert.equal(bytes.readUInt32LE(8),bytes.length);
    const length=bytes.readUInt32LE(12);
    const model=JSON.parse(bytes.subarray(20,20+length));
    assert.equal(model.skins[0].joints.length,rig.joints.length);
    assert.deepEqual(model.animations.map(a=>a.name),manifest.clips);
    assert.ok(model.animations.every(a=>a.channels.length &&
      a.channels.every(c=>c.sampler<a.samplers.length && c.target.node<model.nodes.length)));
    assert.ok(model.meshes[0].primitives.every(p=>p.attributes.JOINTS_0!==undefined));
    const triangles=model.meshes[0].primitives.reduce((n,p)=>n+model.accessors[p.indices].count/3,0);
    assert.equal(triangles,asset.triangles);
  }
  assert.ok(manifest.assets[0].triangles>2*manifest.assets[1].triangles);
});

test('blinks, gait and tea tray use distinct articulated poses', () => {
  const idle={time:0,phase:0,gait:0,blend:1,previous:'IDLE',state:'IDLE',seated:false,reduced:false};
  const base=rig.transforms(idle);
  const blink=rig.transforms({...idle,time:3.9});
  assert.ok(blink[4*16+5]<base[4*16+5]*.2);
  const stride=rig.transforms({...idle,state:'PATROL',phase:Math.PI/2,gait:1});
  assert.notDeepEqual(stride.slice(9*16,10*16),base.slice(9*16,10*16));
  const serve=rig.transforms({...idle,state:'SERVE_TEA'});
  assert.notDeepEqual(serve.slice(15*16),base.slice(15*16));
  assert.ok(serve.every(Number.isFinite));
});
