'use strict';

// Update this version whenever the shell changes. All caches are scoped to this deployment path.
const version='14.1';
const scope=new URL(self.registration.scope);
const prefix='asteria:'+scope.pathname+':';
const shellName=prefix+'shell:'+version;
const packPrefix=prefix+'pack:'+version+':';
const faces=['front','right','back','left','up','down'];
const shell=[
  'index.html','style.css','app.js','manifest.webmanifest','assets/mark.svg',
  'assets/icons/bridge-192.png','assets/icons/bridge-512.png',
  'sectors.js','space.js','flight.js','bridge-layout.js','marie-rig.js','marie-motion.js','marie.js',
  'marie-command.js','marie-adapter.js','marie-console.js','bridge-room.js','events.js',
  'navigation-map.js','bridge-audio.js','sky-assets.js','voyage-store.js','watch-plan.js','voyage-panel.js',
  'assets/v4/manifest.json','assets/v4/nereid-low.cube','assets/v4/nereid-medium.cube',
  'assets/v4/nereid-surface.webp','assets/v2/gas-4k.webp',
  ...faces.flatMap(face=>['assets/v2/bridge-'+face+'.webp','assets/v2/nereid-'+face+'.webp']),
];
const shellPaths=new Set(shell.map(path=>new URL(path,scope).pathname));
const address=path=>new URL(path,scope).href;
const metadata=address('__asteria_pack_meta__');
const packLimit=24*1024*1024;
const perPackLimit=8*1024*1024;
let operations=Promise.resolve();

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(shellName).then(cache=>cache.addAll(shell.map(path=>
    new Request(address(path),{cache:'reload'})))));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await Promise.all((await caches.keys()).filter(name=>name.startsWith(prefix) &&
      name!==shellName && !name.startsWith(packPrefix)).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

function relative(url) {
  if (url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  return url.pathname.slice(scope.pathname.length);
}
const validAsset=path=>typeof path==='string' && /^assets\/(?:v2\/[a-z0-9-]+\.webp|v4\/[a-z0-9-]+\.(?:webp|cube))$/.test(path);
async function packs() {
  const items=[];
  for (const name of await caches.keys()) {
    if (!name.startsWith(packPrefix)) continue;
    const cache=await caches.open(name);
    const response=await cache.match(metadata);
    if (!response) continue;
    items.push({...await response.json(),name,cache});
  }
  return items;
}
async function saveMeta(cache,item) {
  await cache.put(metadata,new Response(JSON.stringify({id:item.id,bytes:item.bytes,touched:item.touched})));
}
function serialize(work) {
  const running=operations.then(work,work);
  operations=running.catch(()=>{});
  return running;
}

async function fetchFromCache(request,path) {
  const core=await caches.open(shellName);
  const key=address(path);
  const basic=await core.match(key);
  if (basic) return basic;
  for (const item of await packs()) {
    const hit=await item.cache.match(key);
    if (hit) {
      if (Date.now()-item.touched>60000) {
        // Rewrite only a still-present entry. A concurrent eviction stays evicted.
        await serialize(async()=>{
          const response=await item.cache.match(metadata);
          if (!response) return;
          const latest=await response.json();
          await saveMeta(item.cache,{...latest,touched:Date.now()});
        }).catch(()=>{});
      }
      return hit;
    }
  }
  return fetch(request);
}

self.addEventListener('fetch',event=>{
  const {request}=event;
  if (request.method!=='GET') return;
  const url=new URL(request.url), path=relative(url);
  if (path===null) return;
  if (request.mode==='navigate' && (path==='' || path==='index.html')) {
    event.respondWith(caches.open(shellName).then(async cache=>
      await cache.match(address('index.html')) || fetch(request)));
  } else if (shellPaths.has(url.pathname) || validAsset(path)) {
    event.respondWith(fetchFromCache(request,path));
  }
});

async function download(id,paths) {
  if (!/^[a-z0-9]{2,24}$/.test(id) || !Array.isArray(paths) || paths.length<1 || paths.length>24
      || !paths.every(validAsset)) throw Error('요청한 에셋 목록이 올바르지 않습니다.');
  const catalog=await (await (await caches.open(shellName)).match(address('assets/v4/manifest.json'))).json();
  if (!Object.hasOwn(catalog,id)) throw Error('구역이 올바르지 않습니다.');
  const row=catalog[id];
  const additions=[row.faces.low.path,row.faces.medium.path,row.surface?.path].filter(Boolean);
  const unique=[...new Set([...paths.filter(path=>path.startsWith('assets/v2/')),...additions])];
  const saved=await packs();
  const old=saved.find(item=>item.id===id);
  if (old) {
    old.touched=Date.now();
    await saveMeta(old.cache,old);
    return;
  }
  const name=packPrefix+id;
  const cache=await caches.open(name);
  let bytes=0;
  const items=[];
  try {
    for (const path of unique) {
      const response=await fetch(address(path),{cache:'no-store',redirect:'error'});
      if (!response.ok) throw Error('구역 에셋을 다운로드할 수 없습니다.');
      const length=Number(response.headers.get('Content-Length'));
      if (length>perPackLimit-bytes) throw Error('구역 다운로드 크기 한도를 초과했습니다.');
      bytes+=(await response.clone().arrayBuffer()).byteLength;
      if (bytes>perPackLimit) throw Error('구역 다운로드 크기 한도를 초과했습니다.');
      items.push([path,response]);
    }
    let used=saved.reduce((sum,item)=>sum+item.bytes,0);
    for (const item of saved.sort((a,b)=>a.touched-b.touched)) {
      if (used+bytes<=packLimit) break;
      await caches.delete(item.name);
      used-=item.bytes;
    }
    for (const [path,response] of items) await cache.put(address(path),response);
    await saveMeta(cache,{id,bytes,touched:Date.now()});
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

self.addEventListener('message',event=>{
  const port=event.ports[0], data=event.data;
  if (!port || !event.source?.url || relative(new URL(event.source.url))===null) return;
  const reply=async()=>{
    try {
      if (data?.type==='activate') {
        const clients=(await self.clients.matchAll({type:'window',includeUncontrolled:true}))
          .filter(client=>relative(new URL(client.url))!==null);
        if (clients.some(client=>client.id!==event.source.id)) throw Error('다른 함교 탭을 닫은 뒤 업데이트하십시오.');
        port.postMessage({ok:true});
        await self.skipWaiting();
        return;
      }
      await serialize(async()=>{
        if (data?.type==='download') await download(data.id,data.paths);
        else if (data?.type==='remove' && /^[a-z0-9]{2,24}$/.test(data.id)) await caches.delete(packPrefix+data.id);
        else if (data?.type!=='list') throw Error('지원하지 않는 요청입니다.');
        const items=(await packs()).map(({id,bytes})=>({id,bytes}));
        port.postMessage({ok:true,items});
      });
    } catch (error) {
      port.postMessage({ok:false,error:error.name==='QuotaExceededError'
        ? '오프라인 저장 공간이 부족합니다.' : error.message});
    }
  };
  event.waitUntil(reply());
});
