'use strict';
(()=>{
const $=id=>document.getElementById(id), faces=['front','right','back','left','up','down'], base='assets/v2/';
const destinations=[['nereid','NEREID','네레이드 · 고리형 가스 행성','OR-07'],['selene','SELENE','셀레네 · 얼음 행성','PE-12'],['eos','EOS','이오스 · 붉은 암석 행성','CA-19'],['deep','DEEP SPACE','심우주 · 자유 항해','DS-00'],['gaia','GAIA','가이아 · 지구형 해양 행성','GA-21'],['solaris','SOLARIS','솔라리스 · 항성 근접 관측','SO-32'],['singularity','SINGULARITY','특이점 · 블랙홀 강착원반','BH-09'],['belt','ASTEROID BELT','소행성대 · 파편 구역','AB-17'],['nebula','NEBULA','성운 · 별 탄생 구역','NE-44']];
const events={meteor:['유성우','미세 유성체 흐름 감지 · 관측 보호막 작동','METEOR SHOWER'],asteroid:['소행성 통과','암석 천체가 인접 항로를 가로지릅니다.','NEAR FLYBY'],comet:['혜성 조우','청백색 이온 꼬리와 먼지 꼬리를 관측합니다.','COMET'],flare:['태양 폭풍','고에너지 입자 흐름 · 보호막 모의 부하','SOLAR STORM'],signal:['미확인 신호','원거리 공명 신호를 레이더에서 추적합니다.','SIGNAL DETECTED'],flyby:['탐사선 조우','무인 탐사선이 시야를 가로지릅니다.','PROBE CONTACT']};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches, keys=new Set();
let yaw=0,pitch=0,roll=0,zoom=1,focal=500,w=1,h=1,dpr=1,throttle=35,auto=false,cinema=false,room=true,dest=0,warp=null,loading=false,event=null,random=false,nextEvent=0,drag=null,last=performance.now(),elapsed=0,toastTimer,clockSec=-1,sound=false,audioCtx=null,audioOsc=null,audioGain=null;
const wrap=a=>((a+180)%360+360)%360-180, clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), rad=Math.PI/180;
function loadImg(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(fail, 15000);
    function fail() {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      reject(Error('이미지 로드 실패: ' + url));
    }
    image.onload = () => {
      clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = fail;
    image.src = url;
  });
}
function loadImages(paths, retry = '') {
  return Promise.all(paths.map(path => loadImg(path + retry)));
}
function urls(n){return faces.map(f=>`${base}${destinations[n][0]}-${f}.webp`);}
const roomURLs=faces.map(f=>`${base}bridge-${f}.webp`);
let renderer=null,ready=false,revision=0,drawn='',lastDraw=0,lastSkyDraw=0,lastMotion=0,activeSky=null,activeRoom=null;
let deepSky=null;
let approach=0.30;
let routeMotion = null;
let drawnApproach = null;

async function loadSky(n, retry = ''){
  const legacy = loadImages(urls(n), retry);
  const scene = AsteriaSpace.scenes[destinations[n][0]];
  if (!renderer.sky.space || !scene) return {legacy: await legacy};
  if (!deepSky) {
    const background = loadImages(urls(3), retry);
    deepSky = background;
    background.catch(() => {
      if (deepSky === background) deepSky = null;
    });
  }
  const [fallback, geometry] = await Promise.all([
    legacy,
    Promise.all([
      deepSky,
      scene.surface ? loadImg(`${base}${scene.surface}-4k.webp${retry}`) : null,
    ]).then(([background, surface]) => ({scene, background, surface})).catch(() => null),
  ]);
  return {legacy: fallback, geometry};
}

function checkTextureUpload(gl, label) {
  const error = gl.getError();
  if (error !== gl.NO_ERROR || gl.isContextLost()) {
    throw Error(`WebGL ${label} upload failed (0x${error.toString(16)})`);
  }
}
function gpuLayer(canvas, alpha) {
  const gl = canvas.getContext('webgl', {
    alpha, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true,
  });
  if (!gl) throw Error('WebGL not available');
  const vertex = 'attribute vec2 a; varying vec2 uv; void main(){uv=a;gl_Position=vec4(a,0.,1.);}';
  const panorama = 'precision mediump float;varying vec2 uv;uniform vec2 scale;uniform mat3 rot;uniform samplerCube cube;void main(){gl_FragColor=textureCube(cube,rot*vec3(uv*scale,1.));}';
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw Error(error);
    }
    return shader;
  }
  function link(fragment) {
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw Error(error);
    }
    return {
      program,
      position: gl.getAttribLocation(program, 'a'),
      scale: gl.getUniformLocation(program, 'scale'),
      rotation: gl.getUniformLocation(program, 'rot'),
      sampler: gl.getUniformLocation(program, 'cube'),
    };
  }

  const cubeProgram = link(panorama);
  let spaceProgram = null;
  let space = null;
  if (!alpha) {
    try {
      spaceProgram = link(AsteriaSpace.fragment);
      space = AsteriaSpace.bind(gl, spaceProgram.program, checkTextureUpload);
    } catch (error) {
      console.warn('3D space renderer unavailable:', error.message);
    }
  }
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const targets = [
    gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
    gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
  ];
  let texture = null;
  let currentImages = null;
  let geometry = false;

  function upload(images, scene) {
    geometry = false;
    if (scene) space.upload(scene.surface, scene.scene);
    else space?.clear();
    if (images !== currentImages) uploadCube(images);
    geometry = !!scene;
  }

  function uploadCube(images) {
    currentImages = null;
    if (texture) gl.deleteTexture(texture);
    texture = gl.createTexture();
    if (!texture) throw Error('WebGL cube texture allocation failed');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    const max = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
    images.forEach((image, index) => {
      let source = image;
      if (image.naturalWidth > max) {
        source = document.createElement('canvas');
        source.width = source.height = max;
        source.getContext('2d').drawImage(image, 0, 0, max, max);
      }
      gl.texImage2D(targets[index], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    });
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    checkTextureUpload(gl, 'cube texture');
    currentImages = images;
  }

  function draw(matrix, width, height) {
    if (!texture) return;
    const pixelRatio = geometry ? Math.min(dpr, renderLimit / Math.max(width, height, 1)) : dpr;
    const dw = Math.max(1, Math.round(width * pixelRatio));
    const dh = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== dw || canvas.height !== dh) {
      canvas.width = dw;
      canvas.height = dh;
    }
    const shader = geometry ? spaceProgram : cubeProgram;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(shader.program);
    gl.enableVertexAttribArray(shader.position);
    gl.vertexAttribPointer(shader.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(shader.scale, width / (2*focal), height / (2*focal));
    gl.uniformMatrix3fv(shader.rotation, false, matrix);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.uniform1i(shader.sampler, 0);
    const distance = geometry ? space.draw(reduced ? 0 : elapsed, approach) : null;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return distance;
  }

  return {
    upload, draw, space: !!space,
    get geometry() { return geometry; },
    release() {
      if (texture) gl.deleteTexture(texture);
      space?.clear();
      gl.deleteBuffer(vertices);
      gl.deleteProgram(cubeProgram.program);
      if (spaceProgram) gl.deleteProgram(spaceProgram.program);
    },
  };
}
function cpuLayer(canvas,alpha){const ctx=canvas.getContext('2d',{alpha});let data=null,size=0;return {upload(images){size=Math.min(images[0].naturalWidth,1536);const tmp=document.createElement('canvas');tmp.width=tmp.height=size;let c=tmp.getContext('2d',{willReadFrequently:true});data=images.map(img=>{c.clearRect(0,0,size,size);c.drawImage(img,0,0,size,size);return new Uint32Array(c.getImageData(0,0,size,size).data.buffer);});},draw(mat,ww,hh,moving){if(!data)return;const scale=Math.min(1,(moving?740:1700)/Math.max(ww,hh), (moving?480:1050)/Math.min(ww,hh));let cw=Math.max(1,Math.round(ww*scale)),ch=Math.max(1,Math.round(hh*scale));if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}const im=ctx.createImageData(cw,ch),out=new Uint32Array(im.data.buffer),sx=ww/(focal*cw),sy=hh/(focal*ch),half=(size-1)*.5;let k=0;
 for(let j=0;j<ch;j++){const Y=(ch*.5-j-.5)*sy,xb=mat[3]*Y+mat[6],yb=mat[4]*Y+mat[7],zb=mat[5]*Y+mat[8];for(let i=0;i<cw;i++){let X=(i+.5-cw*.5)*sx,x=mat[0]*X+xb,y=mat[1]*X+yb,z=mat[2]*X+zb,ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z),f,u,v,m;if(az>=ax&&az>=ay){m=az;f=z>0?0:2;u=z>0?x:-x;v=-y;}else if(ax>=ay){m=ax;f=x>0?1:3;u=x>0?-z:z;v=-y;}else{m=ay;f=y>0?4:5;u=x;v=y>0?z:-z;}let px=Math.max(0,Math.min(size-1,Math.round((u/m+1)*half))),py=Math.max(0,Math.min(size-1,Math.round((v/m+1)*half)));out[k++]=data[f][py*size+px];}}
 ctx.putImageData(im,0,0);}};}
function replaceCanvas(id){const old=$(id),fresh=old.cloneNode(false);old.replaceWith(fresh);return fresh;}
function canvasRenderer() {
  return {
    sky: cpuLayer(replaceCanvas('skyView'), false),
    room: cpuLayer(replaceCanvas('roomView'), true),
    gpu: false,
  };
}
function initRenderer() {
  let sky;
  try {
    sky = gpuLayer($('skyView'), false);
    renderer = {sky, room: gpuLayer($('roomView'), true), gpu: true};
  } catch {
    sky?.release();
    renderer = canvasRenderer();
  }
}

// Lower the pixel budget after sustained slow frames, and recover only after
// several smooth windows to keep the drawing buffer from oscillating.
let renderLimit = 1080;
let qualityStart = null, qualityFrames = 0, smoothWindows = 0;
function resetQualitySamples() {
  qualityStart = null;
  qualityFrames = smoothWindows = 0;
}
function adaptQuality(now, frameMs) {
  if (document.hidden || frameMs > 250) {
    resetQualitySamples();
    return;
  }
  if (qualityStart === null) {
    qualityStart = now;
    return;
  }
  qualityFrames++;
  if (now - qualityStart < 750) return;
  const average = (now - qualityStart) / qualityFrames;
  const max = Math.round(dpr * Math.max(w, h));
  const min = Math.min(480, max);
  const current = Math.min(renderLimit, max);
  let next = current;
  if (average > 24) {
    next = Math.max(min, Math.floor(current * 0.8));
    smoothWindows = 0;
  } else if (average < 19) {
    if (++smoothWindows >= 3) {
      next = Math.min(max, Math.ceil(current * 1.25));
      smoothWindows = 0;
    }
  } else {
    smoothWindows = 0;
  }
  qualityStart = now;
  qualityFrames = 0;
  if (next !== current) {
    renderLimit = next;
    revision++;
  }
}
function rotation(){let a=yaw*rad,b=pitch*rad,r=roll*rad,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cr=Math.cos(r),sr=Math.sin(r);return new Float32Array([ca*cr-sa*sb*sr,cb*sr,-sa*cr-ca*sb*sr,-ca*sr-sa*sb*cr,cb*cr,sa*sr-ca*sb*cr,sa*cb,sb,ca*cb]);}
function renderCamera(now, frameMs) {
  if (!ready) return;
  if (renderer.sky.geometry && !reduced) adaptQuality(now, frameMs);
  const key = [yaw, pitch, roll, zoom, w, h, room, revision].join('/');
  const changed = key !== drawn && key + '/static' !== drawn;
  if (changed) lastMotion = now;
  const moving = now - lastMotion < 190;
  const redrawCamera = changed || (drawn !== key + '/static' && now - lastDraw >= 230);
  const animateSky = renderer.sky.geometry && !reduced && now - lastSkyDraw >= 32;
  const manualRouteChange = renderer.sky.geometry && !routeMotion && approach !== drawnApproach;
  if (!redrawCamera && !animateSky && !manualRouteChange) return;
  const view = rotation();
  const distance = renderer.sky.draw(view, w, h, moving);
  drawnApproach = approach;
  if (distance != null) {
    const text = distance.toFixed(1) + ' SU';
    if ($('surfaceDistance').textContent !== text) $('surfaceDistance').textContent = text;
  }
  lastSkyDraw = now;
  if (redrawCamera) {
    if (room) renderer.room.draw(view, w, h, moving);
    drawn = moving ? key : key + '/static';
    lastDraw = now;
  }
}
initRenderer();
function updateRendererLabel() {
  const geometry = !!renderer.sky.geometry;
  $('renderMode').textContent = geometry ? 'RENDER / WEBGL 3D'
    : renderer.gpu ? 'RENDER / WEBGL 360°' : 'RENDER / CANVAS 360°';
  $('approachControl').hidden = !geometry;
  $('bridge').classList.toggle('route-available', geometry);
  if (!geometry) routeMotion = null;
  updateRouteControls();
}
function uploadSky(sky) {
  activeSky = sky.legacy;
  try {
    const geometry = renderer.sky.space ? sky.geometry : null;
    renderer.sky.upload(geometry ? geometry.background : sky.legacy, geometry);
  } catch (error) {
    if (!renderer.gpu) throw error;
    fallbackToCanvas('GPU 텍스처 오류', error);
  }
  resetQualitySamples();
  if (ready) updateRendererLabel();
  revision++;
}

function uploadRoom(images) {
  activeRoom = images;
  try {
    renderer.room.upload(images);
  } catch (error) {
    if (!renderer.gpu) throw error;
    fallbackToCanvas('GPU 텍스처 오류', error);
  }
}

function fallbackToCanvas(reason, error) {
  if (!renderer.gpu) return;
  if (error) console.warn(reason, error);
  const previous = renderer;
  renderer = canvasRenderer();
  previous.sky.release();
  previous.room.release();
  if (activeSky) renderer.sky.upload(activeSky);
  if (activeRoom) renderer.room.upload(activeRoom);
  deepSky = null;
  if (ready) updateRendererLabel();
  revision++;
  notify(reason + ' · Canvas 360° 모드 전환');
}

for (const id of ['skyView', 'roomView']) {
  $(id).addEventListener('webglcontextlost', event => {
    event.preventDefault();
    fallbackToCanvas('GPU 연결 중단');
  });
}
function notify(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800);}
function updateRouteControls() {
  const blocked = !ready || !renderer.sky.geometry || loading || !!warp;
  $('approach').disabled = $('approachNear').disabled = $('approachFar').disabled = blocked;
  for (const [id, target, label] of [['approachNear', 1, '접근'], ['approachFar', 0, '이탈']]) {
    const button = $(id);
    const active = routeMotion?.target === target;
    button.textContent = active ? '정지' : label;
    button.setAttribute('aria-disabled', String(!active && approach === target));
  }
}

function stopRoute() {
  routeMotion = null;
  updateRouteControls();
}

function setApproach(position) {
  approach = position;
  const percent = Math.round(position * 100);
  if (Number($('approach').value) !== percent) $('approach').value = percent;
  const label = percent + '%';
  if ($('approachRead').textContent !== label) $('approachRead').textContent = label;
}

function moveRoute(target) {
  if ($('approach').disabled) return;
  if (routeMotion?.target === target) {
    stopRoute();
  } else if (approach !== target) {
    if (reduced) {
      setApproach(target);
      updateRouteControls();
      return;
    }
    routeMotion = {start: approach, target, time: 0, duration: Math.max(0.5, Math.abs(target - approach) * 7)};
    updateRouteControls();
  }
}

function advanceRoute(dt) {
  if (!routeMotion || document.hidden) return;
  routeMotion.time += dt;
  const {start, target, time, duration} = routeMotion;
  const fraction = Math.min(1, time / duration);
  const eased = fraction * fraction * (3 - 2 * fraction);
  setApproach(fraction === 1 ? target : start + (target - start) * eased);
  if (fraction === 1) stopRoute();
}

$('approach').addEventListener('input', event => {
  setApproach(Number(event.target.value) / 100);
  stopRoute();
});
$('approachNear').onclick = () => moveRoute(1);
$('approachFar').onclick = () => moveRoute(0);

function setDest(n, sky) {
  dest = n;
  const d = destinations[n];
  if (sky) {
    stopRoute();
    setApproach(0.30);
    $('surfaceDistance').textContent = '—';
    $('rangeLabel').textContent = d[0] === 'belt' ? '가장 가까운 소행성' : '천체 표면';
    uploadSky(sky);
  }
  $('destinationName').textContent = d[1];
  $('destinationDesc').textContent = d[2];
  $('tracking').textContent = d[1];
  $('sector').textContent = d[3];
  $('routeCode').textContent = d[3];
  $('destinationSelect').value = String(n);
}
destinations.forEach((d,i)=>{let op=document.createElement('option');op.value=i;op.textContent=d[2];$('destinationSelect').append(op);});
setDest(0);
let startupAttempt = 0;
async function startBridge() {
  if (ready || loading) return;
  loading = true;
  const retry = startupAttempt++ ? `?retry=${Date.now()}` : '';
  if (retry) deepSky = null;
  $('retryStartup').hidden = true;
  $('startupStatus').textContent = '관측창 에셋을 불러오는 중입니다.';
  $('flightStatus').textContent = '관측창 준비 중';
  try {
    const [sky, images] = await Promise.all([loadSky(0, retry), loadImages(roomURLs, retry)]);
    uploadSky(sky);
    uploadRoom(images);
    ready = true;
    updateRendererLabel();
    $('startupPanel').hidden = true;
    $('warp').disabled = $('travel').disabled = $('destinationSelect').disabled = false;
    $('flightStatus').textContent = '순항 항해 중';
    if (retry) $('travel').focus({preventScroll: true});
  } catch (error) {
    console.warn('Bridge initialization failed:', error);
    $('startupStatus').textContent = '관측창 에셋을 불러오지 못했습니다.';
    $('retryStartup').hidden = false;
    $('flightStatus').textContent = '관측창 로딩 실패';
  } finally {
    loading = false;
    updateRouteControls();
  }
}
$('retryStartup').addEventListener('click', startBridge);
startBridge();
function layoutControls(){const main=$('bridge').getBoundingClientRect(),consoleBox=document.querySelector('.console').getBoundingClientRect();if(consoleBox.height)$('bridge').style.setProperty('--console-clear',(main.bottom-consoleBox.top)+'px');}
function resize(){const r=$('view').getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(devicePixelRatio||1,1.6,2200/Math.max(w,h,1));const c=$('effects');c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);updateFocal();layoutControls();}
function updateFocal(){focal=Math.max(Math.min(w,h)*.74,h*.44)*zoom;revision++;}
function setAuto(on){auto=on;$('autopilot').setAttribute('aria-pressed',String(on));$('viewMode').textContent=on?'AUTO':'MANUAL';}
function reset(){setAuto(false);yaw=pitch=roll=0;zoom=1;updateFocal();}
function setCinema(on){cinema=on;$('bridge').classList.toggle('cinematic',on);$('cinema').setAttribute('aria-pressed',String(on));$('exitCinema').hidden=!on;}
function setRoom(on){room=on;$('roomView').classList.toggle('room-off',!on);$('roomToggle').textContent='함교 '+(on?'ON':'OFF');$('roomToggle').setAttribute('aria-pressed',String(on));}
function zoomBy(delta){zoom=clamp(zoom+delta,.65,1.7);updateFocal();}
const c=$('effects'),ctx=c.getContext('2d'),radar=$('radar').getContext('2d');
const stars=Array.from({length:360},()=>({x:(Math.random()-.5)*24,y:(Math.random()-.5)*24,z:.3+Math.random()*25,b:.2+Math.random()*.8}));
function project(x,y,z){const a=yaw*rad,b=pitch*rad,r=roll*rad,cy=Math.cos(a),sy=Math.sin(a),cp=Math.cos(b),sp=Math.sin(b),cr=Math.cos(r),sr=Math.sin(r);let X=cy*x-sy*z,Z=sy*x+cy*z,Y=cp*y-sp*Z;Z=sp*y+cp*Z;if(Z<=.08)return null;let xx=cr*X+sr*Y,yy=-sr*X+cr*Y;return [w/2+focal*xx/Z,h/2-focal*yy/Z,Z];}
function line(a,b,color,width){if(!a||!b)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}
function effectFrame(dt,wa){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);let v=reduced?0:throttle*.025+wa*45;for(let s of stars){let old=s.z;s.z-=dt*v;if(s.z<.3){s.z=25;s.x=(Math.random()-.5)*24;s.y=(Math.random()-.5)*24;}let p=project(s.x,s.y,s.z);if(!p||p[0]<-20||p[0]>w+20||p[1]<-20||p[1]>h+20)continue;if(wa>.03){let q=project(s.x,s.y,s.z+wa*3.5);line(p,q,`rgba(171,223,255,${s.b*wa*.85})`,clamp(3/s.z,.5,2.4));}else{ctx.fillStyle=`rgba(207,233,255,${s.b*.42})`;ctx.beginPath();ctx.arc(p[0],p[1],clamp(2/s.z,.35,1.4),0,Math.PI*2);ctx.fill();}}
if((dest===7&&!renderer.sky.geometry)||event?.type==='asteroid'){let n=dest===7&&!renderer.sky.geometry?18:8;for(let i=0;i<n;i++){let t=elapsed*.18+i*2.73,xx=Math.sin(t)*7,yy=Math.cos(i*2.4)*2.6,zz=5+((i*2.17+elapsed*.23)%8);let p=project(xx,yy,zz);if(!p)continue;let r=clamp(focal*(.15+(i%4)*.07)/p[2],2,60),g=ctx.createRadialGradient(p[0]-r*.35,p[1]-r*.38,r*.08,p[0],p[1],r);g.addColorStop(0,'#c3aa9b');g.addColorStop(.55,'#645a55');g.addColorStop(1,'#15151b');ctx.fillStyle=g;ctx.beginPath();for(let k=0;k<9;k++){let a=k/9*Math.PI*2+elapsed*.05,rr=r*(.73+.22*Math.sin(i*3+k*7));ctx.lineTo(p[0]+Math.cos(a)*rr,p[1]+Math.sin(a)*rr);}ctx.closePath();ctx.fill();}}
if(event){let e=event,p=(elapsed-e.start)/e.duration,fade=Math.min(1,p*5,(1-p)*5);if(!reduced&&e.type==='meteor'){for(let i=0;i<22;i++){let phase=(p*2.8+i*.137)%1,a=project(8-16*phase+i*.2,4-i*.32-3*phase,8+i%3),b=project(8-16*(phase-.08)+i*.2,4-i*.32-3*(phase-.08),8+i%3);line(a,b,`rgba(200,232,255,${fade*.75})`,1.6);}}
if(e.type==='comet'||e.type==='flyby'){let a=project(-8+16*p,.85+Math.sin(p*Math.PI)*.5,6),b=project(-10+16*p,-.1,6.8);if(a){if(e.type==='comet'){line(a,b,`rgba(119,204,255,${fade*.56})`,9);line(a,b,`rgba(221,245,255,${fade*.9})`,2);let g=ctx.createRadialGradient(a[0],a[1],0,a[0],a[1],35);g.addColorStop(0,'#eefaff');g.addColorStop(1,'#95d9ff00');ctx.fillStyle=g;ctx.fillRect(a[0]-35,a[1]-35,70,70);}else{ctx.fillStyle='#90c6d5';ctx.fillRect(a[0]-9,a[1]-3,18,6);ctx.fillStyle='#3f708c';ctx.fillRect(a[0]-22,a[1]-5,11,10);ctx.fillRect(a[0]+11,a[1]-5,11,10);ctx.fillStyle='#e3faff';ctx.fillRect(a[0]-2,a[1]-2,4,4);}}}
if(e.type==='flare'){let a=project(.6,.2,1);if(a){let r=Math.max(w,h)*.75,g=ctx.createRadialGradient(a[0],a[1],0,a[0],a[1],r);g.addColorStop(0,`rgba(255,170,65,${fade*.36})`);g.addColorStop(1,'#ff652000');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}}
if(e.type==='signal'){let a=project(1.2,.7,3);if(a){ctx.strokeStyle=`rgba(110,255,214,${fade*.65})`;ctx.lineWidth=1.4;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(a[0],a[1],5+((p*130+i*20)%60),0,7);ctx.stroke();}}}}
}
function drawRadar(t){let r=radar;r.clearRect(0,0,160,160);r.save();r.translate(80,80);r.strokeStyle='#305166';r.lineWidth=1;for(let i=1;i<=4;i++){r.beginPath();r.arc(0,0,i*17,0,7);r.stroke();}r.beginPath();r.moveTo(-68,0);r.lineTo(68,0);r.moveTo(0,-68);r.lineTo(0,68);r.stroke();let a=t*.9;let g=r.createRadialGradient(0,0,0,0,0,68);g.addColorStop(0,'#6deeea00');g.addColorStop(1,'#6deeea15');r.fillStyle=g;r.beginPath();r.moveTo(0,0);r.arc(0,0,68,a-.65,a);r.closePath();r.fill();r.strokeStyle='#69e3df';r.beginPath();r.moveTo(0,0);r.lineTo(Math.cos(a)*68,Math.sin(a)*68);r.stroke();for(let i=0;i<5;i++){let angle=i*2.5+dest*.4-yaw*rad,dist=17+i*10;r.fillStyle=event&&i===0?'#ffbf76':'#79e2dc';r.beginPath();r.arc(Math.cos(angle)*dist,Math.sin(angle)*dist,i===0?3:1.8,0,7);r.fill();}r.fillStyle='#d8ffff';r.fillRect(-2,-2,4,4);r.restore();}
function updateSpeed(wa=0){$('throttlePct').textContent=Math.round(throttle)+'%';$('power').textContent=Math.round(throttle)+'%';$('powerBar').style.width=throttle+'%';$('speedRead').textContent=wa>.2?(1+wa*8).toFixed(2):(throttle*.0068).toFixed(2);if(audioGain){audioGain.gain.setTargetAtTime(sound?.015+throttle*.0003+wa*.035:0,audioCtx.currentTime,.2);audioOsc.frequency.setTargetAtTime(39+throttle*.3+wa*40,audioCtx.currentTime,.2);}}
async function engage(n=null){if(warp||loading)return;if(!ready){notify('초기 우주 에셋 준비 중입니다.');return;}loading=true;stopRoute();$('warp').disabled=$('travel').disabled=$('destinationSelect').disabled=true;$('flightStatus').textContent='항로 계산 중';try{let images=n!==null&&n!==dest?await loadSky(n):null;warp={start:performance.now(),next:n,changed:false,images};$('warp').classList.add('engaged');$('warp').querySelector('b').textContent='워프 진행 중';$('flightStatus').textContent='워프 항해 중';$('modeLabel').textContent='WARP DRIVE';notify(n===null?'워프 드라이브 가동':destinations[n][1]+' 항로 설정 · 워프 개시');}catch(e){notify('목적지 이미지 로드 실패. 현재 구역 유지.');$('warp').disabled=$('travel').disabled=$('destinationSelect').disabled=false;$('flightStatus').textContent='순항 항해 중';}finally{loading=false;updateRouteControls();}}
function endEvent(){event=null;$('eventBanner').hidden=true;$('environment').textContent='STABLE';$('shield').textContent='100%';$('shieldBar').style.width='100%';}
function startEvent(type){if(warp||loading){notify('순항 중 우주 상황을 실행할 수 있습니다.');return;}const e=events[type];if(!e)return;if(event)endEvent();event={type,start:elapsed,duration:12};$('eventName').textContent=e[0];$('eventDescription').textContent=e[1];$('eventBanner').hidden=false;$('environment').textContent=e[2];notify(e[0]+' · 관측 상황 개시');}
$('travel').onclick=()=>engage(+$('destinationSelect').value);$('warp').onclick=()=>engage();$('speed').oninput=e=>{throttle=+e.target.value;updateSpeed();};$('autopilot').onclick=()=>setAuto(!auto);$('reset').onclick=reset;$('cinema').onclick=()=>setCinema(true);$('exitCinema').onclick=()=>setCinema(false);$('roomToggle').onclick=()=>setRoom(!room);$('eventBtn').onclick=()=>startEvent($('eventSelect').value);$('randomEvent').onclick=()=>{random=!random;nextEvent=elapsed+6;$('randomEvent').textContent='자동 상황 '+(random?'ON':'OFF');$('randomEvent').setAttribute('aria-pressed',String(random));};$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('전체 화면을 지원하지 않거나 차단되었습니다.');}};
$('sound').onclick=async()=>{try{if(!audioCtx){let AC=window.AudioContext||window.webkitAudioContext;audioCtx=new AC();audioOsc=audioCtx.createOscillator();audioOsc.type='sine';audioGain=audioCtx.createGain();audioGain.gain.value=0;audioOsc.connect(audioGain).connect(audioCtx.destination);audioOsc.start();}await audioCtx.resume();sound=!sound;$('sound').setAttribute('aria-pressed',String(sound));$('sound').querySelector('span').textContent='음향 '+(sound?'ON':'OFF');updateSpeed();}catch{notify('음향을 사용할 수 없습니다.');}};
const view=$('view');view.addEventListener('pointerdown',e=>{if(e.button!==0)return;setAuto(false);view.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,id:e.pointerId};view.setPointerCapture(e.pointerId);});view.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;yaw=wrap(yaw-(e.clientX-drag.x)*.19);pitch=wrap(pitch+(e.clientY-drag.y)*.19);drag.x=e.clientX;drag.y=e.clientY;});for(let ev of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(ev,()=>drag=null);view.addEventListener('dblclick',reset);view.addEventListener('wheel',e=>{e.preventDefault();zoomBy(-Math.sign(e.deltaY)*.08);},{passive:false});
const map={arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d'}, editable=el=>el&&['INPUT','SELECT','TEXTAREA'].includes(el.tagName);
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(cinema)setCinema(false);keys.clear();return;}if($('helpDialog').open||editable(document.activeElement)||e.ctrlKey||e.metaKey||e.altKey)return;let k=map[e.key.toLowerCase()]||e.key.toLowerCase();if('wasdqe'.includes(k)&&k.length===1){e.preventDefault();keys.add(k);setAuto(false);}else if(!e.repeat){if(k==='r')reset();else if(k==='c')setCinema(!cinema);else if(k==='+'||k==='=')zoomBy(.1);else if(k==='-')zoomBy(-.1);}});window.addEventListener('keyup',e=>keys.delete(map[e.key.toLowerCase()]||e.key.toLowerCase()));window.addEventListener('blur',()=>{keys.clear();drag=null;});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();resetQualitySamples();}});document.querySelectorAll('[data-key]').forEach(b=>{const k=b.dataset.key;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);setAuto(false);keys.add(k);});for(let ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>keys.delete(k));});
function frame(now){const frameMs=now-last;let dt=Math.min(.12,frameMs/1000);last=now;elapsed+=dt;let step=92*dt;yaw=wrap(yaw+step*((keys.has('d')?1:0)-(keys.has('a')?1:0)));pitch=wrap(pitch+step*((keys.has('w')?1:0)-(keys.has('s')?1:0)));roll=wrap(roll+step*((keys.has('e')?1:0)-(keys.has('q')?1:0)));if(auto&&!reduced)yaw=wrap(yaw+9*dt);let wa=0;if(warp){let p=(now-warp.start)/3800;wa=reduced?0:clamp(Math.min(p*5,(1-p)*4),0,1);if(p>.48&&!warp.changed){warp.changed=true;if(warp.next!==null)setDest(warp.next,warp.images);reset();}if(p>=1){warp=null;wa=0;updateRouteControls();$('warp').classList.remove('engaged');$('warp').querySelector('b').textContent='워프 항해';$('warp').disabled=$('travel').disabled=$('destinationSelect').disabled=false;$('flightStatus').textContent='순항 항해 중';$('modeLabel').textContent='SUBLIGHT DRIVE';notify('워프 종료 · 관측 구역 도착');}updateSpeed(wa);}$('warpGlow').style.opacity=wa*.8;
if(event&&elapsed-event.start>=event.duration)endEvent();if(random&&!event&&!warp&&!loading&&elapsed>=nextEvent){let ids=Object.keys(events);startEvent(ids[Math.floor(Math.random()*ids.length)]);nextEvent=elapsed+30+Math.random()*30;}if(event&&(event.type==='flare'||event.type==='meteor')){let p=(elapsed-event.start)/event.duration,val=Math.round(100-12*Math.sin(p*Math.PI));$('shield').textContent=val+'%';$('shieldBar').style.width=val+'%';}
advanceRoute(dt);renderCamera(now,frameMs);effectFrame(dt,wa);drawRadar(elapsed);let bearing=(yaw+360)%360;$('heading').textContent=bearing.toFixed(1).padStart(5,'0')+'°';$('pitchRead').textContent=(pitch>=0?'+':'')+pitch.toFixed(1)+'°';$('rollRead').textContent=(roll>=0?'+':'')+roll.toFixed(1)+'°';$('compassText').textContent=['FWD','STBD','AFT','PORT'][Math.round(bearing/90)%4]+' · '+Math.round(bearing).toString().padStart(3,'0')+'°';let sec=Math.floor(Date.now()/1000);if(sec!==clockSec){clockSec=sec;$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC';}requestAnimationFrame(frame);}
window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(layoutControls).observe(document.querySelector('.console'));resize();updateSpeed();requestAnimationFrame(frame);
})();
