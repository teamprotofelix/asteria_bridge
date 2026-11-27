'use strict';

const AsteriaMarieMotion = (() => {
  const spacing = .33;
  const clearance = .38;
  const pi = Math.PI;
  const wrap = angle => Math.atan2(Math.sin(angle),Math.cos(angle));
  const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
  const onFloor = ([x,z]) => [x,0,z];
  const offsets = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

  function canWalk(point, hatch, visitor, layout) {
    return layout.walkable(onFloor(point),hatch) && (!visitor || distance(point,visitor) >= clearance);
  }

  function segment(from,to,passable) {
    const steps = Math.max(1,Math.ceil(distance(from,to)/.09));
    for (let i=1;i<=steps;i++) {
      const sample = from.map((n,j)=> n+(to[j]-n)*i/steps);
      if (!passable(sample)) return false;
    }
    return true;
  }

  function path(start, goal, hatch, visitor, layout) {
    const passable = point => canWalk(point,hatch,visitor,layout);
    if (!passable(goal)) return [];
    if (segment(start,goal,passable)) return [goal];

    const near = point => point.map(v=>Math.round(v/spacing));
    const pointAt = coordinate => coordinate.map(v=>v*spacing);
    const startCell = near(start), endCell = near(goal);
    const candidates = [];
    const seen = new Map();
    function add(cell, previous, length) {
      const id = cell.join('/');
      if (seen.has(id) && seen.get(id).length <= length) return;
      const point = pointAt(cell);
      if (!segment(previous?.point ?? start,point,passable)) return;
      const node = {cell,point,previous,length,cost:length+distance(point,goal)/spacing};
      candidates.push(node);
      seen.set(id,node);
    }
    for (let x=-1;x<=1;x++) for (let z=-1;z<=1;z++) {
      add([startCell[0]+x,startCell[1]+z],null,Math.hypot(x,z));
    }
    while (candidates.length) {
      let best=0;
      for (let i=1;i<candidates.length;i++) if (candidates[i].cost<candidates[best].cost) best=i;
      let node=candidates.splice(best,1)[0];
      if (seen.get(node.cell.join('/')) !== node) continue;
      if (distance(node.cell,endCell) <= 2 && segment(node.point,goal,passable)) {
        const reversed=[goal];
        for (;node;node=node.previous) reversed.push(node.point);
        return reversed.reverse();
      }
      for (const offset of offsets) add(node.cell.map((v,i)=>v+offset[i]),node,node.length+Math.hypot(...offset));
    }
    return [];
  }

  function create(layout, reduced) {
    const from = id => {
      const [x,,z] = layout.waypoints[id];
      return [x,z];
    };
    let point=from('forwardInspection'), direction=.29, phase=0, time=0, gait=0;
    let state='CHECK_CONSOLE', previous=state, blend=1, seated=false;
    let ambient=0, route=[], routeSignature='', replan=0;
    let output=null;

    function advance(dt, intent, bridge) {
      time += dt;
      if (!intent.state) ambient=(ambient+dt)%48;
      const visitor = bridge.walking ? [bridge.eye[0],bridge.eye[2]] : null;
      let next = intent.state, goal = null, lookAt = null;
      if (next === 'SERVE_TEA') {
        goal=from('teaService');
        lookAt=visitor ?? [0,0];
      } else if (next === 'PREPARE_TEA') {
        goal=from('teaPreparation');
        lookAt=[3.6,1.9];
      } else if (next === 'CONTROL_DRONE' || next === 'ASSIST_NAVIGATION') {
        lookAt=[0,4.2];
      } else if (next === 'ALERT') {
        lookAt=[.2,5.7];
      } else if (next === 'REPORT') {
        lookAt=visitor ?? [0,0];
      } else if (next === 'FOLLOW' && visitor) {
        if (distance(point,visitor)>1.6) {
          const angle=Math.atan2(point[1]-visitor[1],point[0]-visitor[0]);
          for (const turn of [0,.65,-.65,1.3,-1.3,pi]) {
            const option=[visitor[0]+1.32*Math.cos(angle+turn),visitor[1]+1.32*Math.sin(angle+turn)];
            if (canWalk(option,bridge.hatch,visitor,layout)) {goal=option;break;}
          }
        }
        lookAt=visitor;
      } else {
        if (ambient<7) {next='CHECK_CONSOLE';goal=from('forwardInspection');lookAt=[.6,3.65];}
        else if (ambient<15) {next='PATROL';goal=from('aftInspection');}
        else if (ambient<22) {next='CHECK_CONSOLE';goal=from('aftInspection');lookAt=[3.9,-1.45];}
        else if (ambient<28) {next='OBSERVE';goal=from('sideObservation');lookAt=[5,3.5];}
        else if (ambient<34) {next='PATROL';goal=from('forwardInspection');}
        else if (ambient<40) {next='REST';goal=from('crewRest');}
        else {next='IDLE';goal=from('forwardInspection');lookAt=[0,0];}
      }

      const arrivedBefore = !goal || distance(point,goal)<.11;
      if (goal && !arrivedBefore && ['CHECK_CONSOLE','OBSERVE','REST','IDLE'].includes(next)) next='PATROL';
      if (next!==state) {
        previous=state;
        state=next;
        blend=reduced ? 1 : 0;
      }
      blend=Math.min(1,blend+dt*4);

      let traveled=0, toFace=lookAt;
      if (!reduced && goal && !arrivedBefore) {
        const signature=[...goal.map(v=>Math.round(v*4)),Number(bridge.hatch>.8)].join('/');
        const passable = pos => canWalk(pos,bridge.hatch,visitor,layout);
        replan-=dt;
        if (signature!==routeSignature || replan<=0 || (route.length && !segment(point,route[0],passable))) {
          route=path(point,goal,bridge.hatch,visitor,layout);
          routeSignature=signature;
          replan=visitor ? .34 : 1;
        }
        let remaining=dt*(intent.state==='FOLLOW' ? 1.55 : 1.48);
        while (remaining>0 && route.length) {
          const target=route[0], total=distance(point,target);
          if (total<.002) {route.shift();continue;}
          if (total>.05) toFace=target;
          const length=Math.min(remaining,total);
          const [candidateX,candidateZ]=point.map((v,i)=>v+(target[i]-v)*length/total);
          const candidate=[candidateX,candidateZ];
          if (!segment(point,candidate,passable)) break;
          point=candidate;
          remaining-=length;
          traveled+=length;
          if (total-length<.002) route.shift();
        }
      } else {
        route=[];
        routeSignature='';
      }
      const arrived=!goal || distance(point,goal)<.11;
      if (!reduced && toFace && distance(point,toFace)>.045) {
        const aim=Math.atan2(point[0]-toFace[0],point[1]-toFace[1]);
        direction+=Math.max(-dt*3.8,Math.min(dt*3.8,wrap(aim-direction)));
      }
      const nextGait=dt ? Math.min(1,traveled/dt/1.42) : 0;
      gait+= (nextGait-gait)*Math.min(1,dt*7);
      phase+=traveled*2*pi/1.05;
      seated=!reduced && state==='REST' && arrived;
      const tea=!!intent.tray;
      const revision = reduced ? [state,tea].join('/') : time;
      if (!output || output.revision!==revision) {
        output={point, direction, phase,gait,previous,state,blend,time,seated,reduced,tea,revision};
      }
      return arrived || reduced;
    }

    advance(0,{}, {walking:false,hatch:0,eye:[0,0,0]});
    return {advance, pose:()=>output};
  }

  return {create,path,canWalk};
})();

if (typeof module === 'object' && module.exports) module.exports = AsteriaMarieMotion;
