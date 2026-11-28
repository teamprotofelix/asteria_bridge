'use strict';

const AsteriaMarieAdapter = (() => {
  const snapshotFields = ['sectorId','sectorName','mode','warning','eventName'];
  const allowedReplies = new Set(['observe','report','guide','unavailable']);
  const maximum = 2048;

  function endpoint(value) {
    try {
      const url=new URL(value.trim());
      if (url.protocol!=='https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null;
      return url.href;
    } catch {return null;}
  }

  function payload(snapshot,text) {
    const safe=Object.fromEntries(snapshotFields.map(key=>{
      const value=snapshot[key];
      return [key,typeof value==='string' ? value.slice(0,100) : null];
    }));
    return {snapshot:safe,text:text.slice(0,180)};
  }

  async function limitedJSON(response) {
    const reader=response.body?.getReader();
    if (!reader) throw Error('응답 본문을 읽을 수 없습니다.');
    let size=0, text='';
    const decoder=new TextDecoder('utf-8',{fatal:true});
    try {
      while (true) {
        const {done,value}=await reader.read();
        if (done) break;
        size+=value.byteLength;
        if (size>maximum) throw Error('응답 길이 제한을 초과했습니다.');
        text+=decoder.decode(value,{stream:true});
      }
      return JSON.parse(text+decoder.decode());
    } finally {
      await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
  }

  function create(url,{fetcher=fetch,timeout=6500,now=Date.now}={}) {
    const address=endpoint(url);
    if (!address) return null;
    let retryAt=0;
    return {
      async respond(snapshot,text,signal) {
        if (signal?.aborted) throw signal.reason;
        if (now()<retryAt) throw Error('요청 제한으로 외부 응답을 잠시 쉬고 있습니다.');
        const request=new AbortController();
        const cancel=()=>request.abort(signal.reason);
        const timer=setTimeout(()=>request.abort(Error('응답 시간이 초과되었습니다.')),timeout);
        signal?.addEventListener('abort',cancel,{once:true});
        try {
          const response=await fetcher(address,{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(snapshot,text)),
            signal:request.signal, redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',
          });
          if (response.status===429) {
            const header=response.headers.get('Retry-After');
            const wait=header && /^\d+$/.test(header) ? Number(header)*1000
              : header ? Date.parse(header)-now() : 30000;
            retryAt=now()+Math.min(300000,Math.max(5000,Number.isFinite(wait)?wait:30000));
            throw Error('외부 응답 요청 한도에 도달했습니다.');
          }
          if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
            throw Error('외부 응답 형식을 확인할 수 없습니다.');
          }
          const answer=await limitedJSON(response);
          if (!answer || Array.isArray(answer) || typeof answer!=='object' ||
              Object.keys(answer).length!==1 || !Object.hasOwn(answer,'reply') || !allowedReplies.has(answer.reply)) {
            throw Error('승인된 응답 형식이 아닙니다.');
          }
          return answer.reply;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort',cancel);
        }
      },
    };
  }

  return {create, endpoint, payload};
})();
if (typeof module==='object' && module.exports) module.exports=AsteriaMarieAdapter;
