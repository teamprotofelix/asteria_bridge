'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const Flight = require('../flight.js');
const blank = {translation:[0,0,0],rotation:[0,0,0]};
const nose = [0,0,0,1];

function exercise(input, rate = 60, seconds = 2, bodies = [], start = [0,0,0]) {
  const flight=Flight.create();
  flight.begin('nereid',start,nose,bodies);
  for (let i=0;i<rate*seconds;i++) flight.advance(1/rate,{...blank,...input},bodies);
  return flight.state;
}

test('three translation axes move independently and leave the quaternion unchanged',()=>{
  for (let i=0;i<3;i++) {
    const translation=[0,0,0];
    translation[i]=1;
    const state=exercise({translation});
    assert.ok(state.position[i]>3);
    assert.ok(state.position.every((value,axis)=>axis===i || value===0));
    assert.deepEqual(state.orientation,nose);
    assert.equal(state.sectorId,'nereid');
  }
});

test('three rotation axes are independent and quaternion length remains stable',()=>{
  for (let i=0;i<3;i++) {
    const rotation=[0,0,0];
    rotation[i]=1;
    const state=exercise({rotation},60,30);
    assert.ok(Math.abs(state.orientation[i])>.1);
    assert.ok(state.orientation.slice(0,3).every((value,axis)=>axis===i || Math.abs(value)<1e-9));
    assert.ok(Math.abs(Math.hypot(...state.orientation)-1)<1e-9);
    assert.deepEqual(state.position,[0,0,0]);
  }
});
test('the clamped fixed step is consistent across ordinary frame rates',()=>{
  const input={translation:[.5,.3,1],rotation:[.3,.5,-.2]};
  const at30=exercise(input,30), at120=exercise(input,120);
  assert.ok(at30.position.every((p,i)=>Math.abs(p-at120.position[i])<1e-7));
  assert.ok(at30.orientation.every((q,i)=>Math.abs(q-at120.orientation[i])<1e-7));
});

test('swept collision stops movement, and an overlapping moving body triggers recovery',()=>{
  const body={label:'위성',center:[0,0,3],radius:.8};
  assert.ok(Flight.sweep([0,0,0],[0,0,8],body));
  assert.ok(!Flight.sweep([2,0,0],[2,0,8],body));
  const state=exercise({translation:[0,0,1]},60,4,[body]);
  assert.ok(state.position[2]<1.86);
  assert.deepEqual(state.velocity,[0,0,0]);
  assert.match(state.hazard,/안전 거리/);
  const flight=Flight.create();
  flight.begin('test',[0,0,0],nose,[]);
  flight.advance(.12,blank,[{...body,center:[0,0,0]}]);
  assert.ok(Flight.safe(flight.state.position,[{...body,center:[0,0,0]}]));
  assert.match(flight.state.hazard,/복귀/);
});

test('guidance approaches, orbits, departs and yields to manual input',()=>{
  const flight=Flight.create();
  const bodies=[{label:'주 천체',center:[0,0,13],radius:2}];
  flight.begin('gaia',[0,0,0],nose,bodies);
  flight.assist('APPROACH');
  for (let i=0;i<900;i++) flight.advance(.025,blank,bodies);
  assert.equal(flight.state.assist,'OBSERVE');
  assert.ok(Math.abs(Math.hypot(13-flight.state.position[2])-4.5)<.18);
  flight.assist('ORBIT');
  for (let i=0;i<170;i++) flight.advance(.025,blank,bodies);
  assert.ok(Math.abs(flight.state.position[0])>2);
  flight.assist('DEPART');
  for (let i=0;i<250;i++) flight.advance(.025,blank,bodies);
  assert.equal(flight.state.assist,'IDLE');
  const before=flight.state.position;
  flight.assist('ORBIT');
  flight.advance(.1,{...blank,brake:true},bodies);
  assert.equal(flight.state.assist,'IDLE');
  assert.ok(Math.hypot(...flight.state.position.map((n,i)=>n-before[i]))<.3);
});
