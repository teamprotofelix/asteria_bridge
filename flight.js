'use strict';

const AsteriaFlight = (() => {
  const step = 1/120;
  const boundary = 36;
  const margin = .34;
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const add = (a,b) => a.map((v,i)=>v+b[i]);
  const sub = (a,b) => a.map((v,i)=>v-b[i]);
  const scale = (a,n) => a.map(v=>v*n);
  const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
  const length = v => Math.hypot(...v);
  const unit = v => scale(v,1/(length(v)||1));
  const cross = ([x,y,z],[a,b,c]) => [y*c-z*b,z*a-x*c,x*b-y*a];
  const zero = () => [0,0,0];

  function multiply([x,y,z,w],[a,b,c,d]) {
    return [w*a+x*d+y*c-z*b,w*b-x*c+y*d+z*a,w*c+x*b-y*a+z*d,w*d-x*a-y*b-z*c];
  }
  function rotate(q,v) {
    const u=q.slice(0,3);
    const t=scale(cross(u,v),2);
    return add(add(v,scale(t,q[3])),cross(u,t));
  }
  function turn(q, angular, dt) {
    const speed=length(angular);
    if (!speed) return q;
    const angle=speed*dt/2;
    return unit(multiply(q,[...scale(angular,Math.sin(angle)/speed),Math.cos(angle)]));
  }

  function pointAt(q, direction, dt) {
    const [x,y,z]=direction;
    const yaw=Math.atan2(x,z)/2;
    const pitch=-Math.atan2(y,Math.hypot(x,z))/2;
    const desired=multiply([0,Math.sin(yaw),0,Math.cos(yaw)],[Math.sin(pitch),0,0,Math.cos(pitch)]);
    const signed=dot(q,desired)<0 ? scale(desired,-1) : desired;
    return unit(add(q,scale(sub(signed,q),dt*2.6)));
  }

  function sweep(start,end,body) {
    const from=sub(start,body.center);
    const delta=sub(end,start);
    const radius=body.radius+margin;
    const segment=dot(delta,delta);
    const time=segment ? clamp(-dot(from,delta)/segment,0,1) : 0;
    return length(add(from,scale(delta,time))) <= radius;
  }

  function safe(position, bodies) {
    return length(position)<=boundary && !bodies.some(body=>sweep(position,position,body));
  }

  function recover(position, fallback, bodies) {
    if (safe(position,bodies)) return [...position];
    if (safe(fallback,bodies)) return [...fallback];
    // Deterministic outward candidates also handle a moving moon entering the last safe point.
    for (const distance of [2,4,8,16]) {
      for (const direction of [[0,0,-1],[0,1,0],[1,0,0],[-1,0,0],[0,-1,0],[0,0,1]]) {
        const candidate=add(position,scale(direction,distance));
        if (safe(candidate,bodies)) return candidate;
      }
    }
    return [0,0,-18];
  }

  function create() {
    let state=null, accumulator=0;
    function begin(sectorId,position,orientation,bodies) {
      const start=recover(position,[0,0,-12],bodies);
      state={sectorId,position:start,velocity:zero(),orientation:unit(orientation),
        angularVelocity:zero(),throttle:.65,mode:'PILOT',assist:'IDLE',hazard:'',lastSafe:start};
      accumulator=0;
      return state;
    }
    function stop() {
      state=null;
      accumulator=0;
    }
    function brake() {
      if (!state) return;
      state.velocity=zero();
      state.angularVelocity=zero();
    }
    function assist(mode) {
      if (state) {state.assist=mode;state.hazard='';}
    }
    function guidance(bodies) {
      const target=bodies[0];
      if (!target || state.assist==='IDLE') return zero();
      const offset=sub(state.position,target.center);
      const distance=length(offset);
      const outward=unit(offset);
      const wanted=target.radius+2.5;
      const radial=clamp((wanted-distance)*.74,-2.6,2.6);
      if (state.assist==='DEPART') {
        if (distance>=wanted+6) {state.assist='IDLE';return zero();}
        return scale(outward,2.3);
      }
      if (state.assist==='APPROACH' && Math.abs(distance-wanted)<.16 && length(state.velocity)<.3) {
        state.assist='OBSERVE';
      }
      if (state.assist==='ORBIT') {
        const axis=Math.abs(outward[1])>.94 ? [1,0,0] : [0,1,0];
        return add(scale(outward,radial),scale(unit(cross(axis,outward)),1.7));
      }
      return scale(outward,radial);
    }
    function advance(dt,input,bodies,ring) {
      if (!state) return;
      accumulator+=clamp(dt,0,.12);
      const throttle=input.throttle || 0;
      const manual=length(input.translation)>0 || length(input.rotation)>0 || input.brake || throttle;
      if (manual) assist('IDLE');
      state.throttle=clamp(state.throttle+throttle*clamp(dt,0,.12)*.55,.12,1);
      if (!safe(state.position,bodies)) {
        state.position=recover(state.position,state.lastSafe,bodies);
        brake();
        assist('IDLE');
        state.hazard='안전 위치로 복귀';
      }
      while (accumulator+1e-9>=step) {
        accumulator-=step;
        const spin=scale(input.rotation,1.22);
        state.angularVelocity=add(state.angularVelocity,scale(sub(spin,state.angularVelocity),step*10));
        state.orientation=turn(state.orientation,state.angularVelocity,step);
        if (bodies[0] && ['APPROACH','OBSERVE','ORBIT'].includes(state.assist)) {
          state.orientation=pointAt(state.orientation,sub(bodies[0].center,state.position),step);
        }
        const maxSpeed=ring?.(state.position) ? .80 : .9+state.throttle*3.1;
        const desired=state.assist==='IDLE'
          ? rotate(state.orientation,scale(input.translation,maxSpeed/Math.max(1,length(input.translation))))
          : guidance(bodies);
        const target=input.brake ? zero() : scale(desired,Math.min(1,maxSpeed/(length(desired)||1)));
        const delta=sub(target,state.velocity);
        const rate=input.brake ? 14 : state.assist!=='IDLE' || length(input.translation)>0 ? 6 : 2.4;
        const velocity=add(state.velocity,scale(delta,Math.min(1,rate*step/(length(delta)||1))));
        const next=add(state.position,scale(velocity,step));
        const contact=bodies.find(body=>sweep(state.position,next,body));
        if (contact || length(next)>boundary) {
          state.velocity=zero();
          assist('IDLE');
          state.hazard=contact ? contact.label+' 안전 거리 · 정지' : '구역 비행 경계 · 정지';
          continue;
        }
        state.position=next;
        state.lastSafe=next;
        state.velocity=velocity;
      }
    }
    return {begin,stop,brake,assist,advance,get state(){return state;}};
  }

  return {create,sweep,safe,rotate};
})();
if (typeof module === 'object' && module.exports) module.exports=AsteriaFlight;
