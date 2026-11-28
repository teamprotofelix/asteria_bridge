'use strict';

const AsteriaWatch = (() => {
  function create(route,current,legacy=false) {
    return {route,index:legacy ? route.stops.findIndex(stop=>stop.sectorId===current) : -1,
      remaining:legacy ? 45 : 0, repeat:0, paused:false, failures:0, skipFrame:false};
  }
  function candidate(session) {
    const {index,route,repeat}=session;
    const next=(index+1)%route.stops.length;
    const cycle=next===0 && index>=0 ? repeat+1 : repeat;
    if (route.repeat && cycle>=route.repeat) return null;
    return {index:next,repeat:cycle,...route.stops[next]};
  }
  function arrive(session,leg) {
    session.index=leg.index;
    session.repeat=leg.repeat;
    session.remaining=leg.seconds;
    session.failures=0;
  }
  return {create,candidate,arrive};
})();
if (typeof module==='object' && module.exports) module.exports=AsteriaWatch;
