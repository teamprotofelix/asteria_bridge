'use strict';
(()=>{
const $=id=>document.getElementById(id), faces=['front','right','back','left','up','down'], base='assets/v2/';
const destinations=[['nereid','NEREID','네레이드 · 고리형 가스 행성','OR-07'],['selene','SELENE','셀레네 · 얼음 행성','PE-12'],['eos','EOS','이오스 · 붉은 암석 행성','CA-19'],['deep','DEEP SPACE','심우주 · 자유 항해','DS-00'],['gaia','GAIA','가이아 · 지구형 해양 행성','GA-21'],['solaris','SOLARIS','솔라리스 · 항성 근접 관측','SO-32'],['singularity','SINGULARITY','특이점 · 블랙홀 강착원반','BH-09'],['belt','ASTEROID BELT','소행성대 · 파편 구역','AB-17'],['nebula','NEBULA','성운 · 별 탄생 구역','NE-44']];
const groups = {legacy: '기존 탐사 구역', ...AsteriaSectors.groups};
for (const {group, id, name, description, code} of AsteriaSectors.additions) {
  destinations.push([id, name, description, code, group]);
}

const events = AsteriaEvents.catalog;
let eventOptionsKey = '';
let wasInRing = false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches, keys=new Set();
let yaw=0,pitch=0,roll=0,zoom=1,focal=500,w=1,h=1,dpr=1,throttle=35,auto=false,cinema=false,room=true,dest=0,warp=null,loading=false,event=null,random=false,nextEvent=0,drag=null,last=performance.now(),elapsed=0,toastTimer,clockSec=-1,sound=false,audioCtx=null,audioOsc=null,audioGain=null;
const wrap=a=>((a+180)%360+360)%360-180, clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), rad=Math.PI/180;
let walking = false;
let walkPosition = [...AsteriaBridge.origin];
let walkOrientation = AsteriaBridge.orientation(0, 0, 0);
let cameraMatrix = AsteriaBridge.matrix(walkOrientation);
let cameraDirty = false;
let drawnRoomPosition = null;

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
function urls(id) { return faces.map(face => `${base}${id}-${face}.webp`); }
const roomURLs=faces.map(f=>`${base}bridge-${f}.webp`);
let renderer=null,ready=false,revision=0,drawn='',lastDraw=0,lastSkyDraw=0,lastMotion=0,activeSky=null,activeRoom=null;
let backgroundCache = null;
let approach=0.30;
let routeMotion = null;
let drawnApproach = null;
let orbit = 0;
let drawnOrbit = null;
let tour = null;
const tourLegs = [
  {label: '접근', approach: .83, orbit: 0, seconds: 3.6},
  {label: '관측', approach: .83, orbit: 0, seconds: 2.4},
  {label: '선회', approach: .83, orbit: .62, seconds: 4.2},
  {label: '이탈', approach: 0, orbit: 0, seconds: 3.6},
];

function loadBackground(id, retry) {
  if (backgroundCache?.id === id) return backgroundCache.promise;
  const promise = loadImages(urls(id), retry);
  backgroundCache = {id, promise};
  promise.catch(() => {
    if (backgroundCache?.promise === promise) backgroundCache = null;
  });
  return promise;
}

async function loadSky(n, retry = '') {
  const [id] = destinations[n];
  const scene = AsteriaSpace.scenes[id];
  const legacy = loadImages(urls(scene?.fallback ?? id), retry);
  if (!renderer.sky.space || !scene) return {legacy: await legacy};
  const [fallback, geometry] = await Promise.all([
    legacy,
    Promise.all([
      loadBackground(scene.background ?? 'deep', retry),
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
  function linkProgram(vertexSource, fragmentSource) {
    const vs = compile(gl.VERTEX_SHADER, vertexSource);
    let fs;
    try {
      fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    } catch (error) {
      gl.deleteShader(vs);
      throw error;
    }
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
    return program;
  }

  function link(fragment) {
    const program = linkProgram(vertex, fragment);
    return {
      program,
      position: gl.getAttribLocation(program, 'a'),
      scale: gl.getUniformLocation(program, 'scale'),
      rotation: gl.getUniformLocation(program, 'rot'),
      sampler: gl.getUniformLocation(program, 'cube'),
    };
  }

  const cubeProgram = link(panorama);
  let bridgeMesh = null;
  let bridgeProgram = null;
  if (alpha) {
    try {
      bridgeProgram = linkProgram(AsteriaBridge.vertex, AsteriaBridge.fragment);
      bridgeMesh = AsteriaBridge.bind(gl, bridgeProgram, checkTextureUpload);
    } catch (error) {
      console.warn('3D bridge renderer unavailable:', error.message);
    }
  }
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

  function draw(matrix, width, height, moving) {
    if (!texture) return;
    const limit = bridgeMesh ? (moving ? 960 : 1720) : renderLimit;
    const pixelRatio = geometry || bridgeMesh ? Math.min(dpr, limit / Math.max(width, height, 1)) : dpr;
    const dw = Math.max(1, Math.round(width * pixelRatio));
    const dh = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== dw || canvas.height !== dh) {
      canvas.width = dw;
      canvas.height = dh;
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (bridgeMesh) {
      bridgeMesh.draw(matrix, walkPosition, width / (2*focal), height / (2*focal));
      return;
    }
    const shader = geometry ? spaceProgram : cubeProgram;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.useProgram(shader.program);
    gl.enableVertexAttribArray(shader.position);
    gl.vertexAttribPointer(shader.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(shader.scale, width / (2*focal), height / (2*focal));
    gl.uniformMatrix3fv(shader.rotation, false, matrix);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.uniform1i(shader.sampler, 0);
    const distance = geometry ? space.draw(reduced ? 0 : elapsed, approach, orbit) : null;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return distance;
  }

  return {
    upload, draw, space: !!space, interior: !!bridgeMesh,
    get geometry() { return geometry; },
    release() {
      if (texture) gl.deleteTexture(texture);
      space?.clear();
      bridgeMesh?.release();
      if (bridgeProgram) gl.deleteProgram(bridgeProgram);
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
function updateCamera() {
  if (!cameraDirty) return;
  const orientation = walking ? walkOrientation : AsteriaBridge.orientation(yaw * rad, pitch * rad, roll * rad);
  cameraMatrix = AsteriaBridge.matrix(orientation);
  if (walking) {
    yaw = Math.atan2(cameraMatrix[6], cameraMatrix[8]) / rad;
    pitch = Math.asin(clamp(cameraMatrix[7], -1, 1)) / rad;
    roll = Math.atan2(cameraMatrix[1], cameraMatrix[4]) / rad;
  }
  cameraDirty = false;
}

function turnView(horizontal, vertical, bank = 0) {
  if (!horizontal && !vertical && !bank) return;
  if (tour) stopRoute();
  if (walking) {
    walkOrientation = AsteriaBridge.turn(walkOrientation, horizontal * rad, vertical * rad, bank * rad);
  } else {
    yaw = wrap(yaw + horizontal);
    pitch = wrap(pitch + vertical);
    roll = wrap(roll + bank);
  }
  cameraDirty = true;
}

function moveInside(dt, inputs = keys) {
  const forward = Number(inputs.has('w')) - Number(inputs.has('s'));
  const sideways = Number(inputs.has('d')) - Number(inputs.has('a'));
  const vertical = Number(inputs.has(' ')) - Number(inputs.has('shift'));
  if (!forward && !sideways && !vertical) return;
  const distance = 2.15 * dt / Math.max(1, Math.hypot(forward, sideways, vertical));
  const bearing = yaw * rad;
  walkPosition = [
    clamp(walkPosition[0] + distance*(sideways*Math.cos(bearing) + forward*Math.sin(bearing)), -2.95, 2.95),
    clamp(walkPosition[1] + distance*vertical, -.65, .65),
    clamp(walkPosition[2] + distance*(forward*Math.cos(bearing) - sideways*Math.sin(bearing)), -3.05, 2.2),
  ];
}

function renderCamera(now, frameMs) {
  if (!ready) return;
  if (renderer.sky.geometry && !reduced) adaptQuality(now, frameMs);
  const angles = walking ? walkOrientation : [yaw, pitch, roll];
  const key = [...angles, zoom, w, h, room, revision].join('/');
  const roomPosition = walkPosition.join('/');
  const roomMoved = roomPosition !== drawnRoomPosition;
  const changed = key !== drawn && key + '/static' !== drawn;
  if (changed || roomMoved) lastMotion = now;
  const moving = now - lastMotion < 190;
  const redrawCamera = changed || (drawn !== key + '/static' && now - lastDraw >= 230);
  const animateSky = renderer.sky.geometry && !reduced && now - lastSkyDraw >= 32;
  const manualRouteChange = renderer.sky.geometry && !routeMotion && (approach !== drawnApproach || orbit !== drawnOrbit);
  if (redrawCamera || animateSky || manualRouteChange) {
    const distance = renderer.sky.draw(cameraMatrix, w, h, moving);
    drawnApproach = approach;
    drawnOrbit = orbit;
    if (distance != null) {
      const text = distance.toFixed(1) + ' SU';
      if ($('surfaceDistance').textContent !== text) $('surfaceDistance').textContent = text;
    }
    lastSkyDraw = now;
  }
  if (room && (redrawCamera || roomMoved)) {
    renderer.room.draw(cameraMatrix, w, h, moving);
  }
  drawnRoomPosition = roomPosition;
  if (redrawCamera) {
    drawn = moving ? key : key + '/static';
    lastDraw = now;
  } else if (roomMoved && drawn === key + '/static') {
    drawn = key;
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
  if (!renderer.room.interior && walking) setWalking(false);
  updateWalkControls();
  if (geometry) updateRouteControls();
  else stopRoute();
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
  backgroundCache = null;
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
  $('tourBtn').disabled = blocked || walking;
  $('tourBtn').textContent = tour ? '순회 정지' : '관측 순회';
  for (const [id, target, label] of [['approachNear', 1, '접근'], ['approachFar', 0, '이탈']]) {
    const button = $(id);
    const active = routeMotion?.target === target;
    button.textContent = active ? '정지' : label;
    button.setAttribute('aria-disabled', String(!active && approach === target));
  }
}

function stopRoute() {
  routeMotion = null;
  if (tour) {
    tour = null;
    $('tourPhase').textContent = '순회 중단';
  }
  updateRouteControls();
}

function startTour() {
  if ($('tourBtn').disabled) return;
  if (tour) {
    stopRoute();
    return;
  }
  stopRoute();
  setAuto(false);
  tour = {index: 0, elapsed: 0, start: approach, orbit};
  $('tourPhase').textContent = '1/4 접근';
  updateRouteControls();
}

function advanceTour(dt) {
  if (!tour || document.hidden) return;
  const leg = tourLegs[tour.index];
  tour.elapsed += dt;
  const fraction = reduced ? 1 : Math.min(1, tour.elapsed / leg.seconds);
  const easing = fraction * fraction * (3 - 2 * fraction);
  setApproach(tour.start + (leg.approach - tour.start)*easing);
  orbit = tour.orbit + (leg.orbit - tour.orbit)*easing;
  const scene = AsteriaSpace.scenes[destinations[dest][0]];
  const [bearing, elevation] = AsteriaSpace.lookAtRoute(scene, approach, orbit);
  yaw = bearing / rad;
  pitch = elevation / rad;
  roll = 0;
  cameraDirty = true;
  if (tour.elapsed < (reduced ? 1.2 : leg.seconds)) return;
  const next = tour.index + 1;
  if (next === tourLegs.length) {
    tour = null;
    $('tourPhase').textContent = '순회 완료';
    updateRouteControls();
    return;
  }
  tour = {index: next, elapsed: 0, start: approach, orbit};
  $('tourPhase').textContent = `${next + 1}/4 ${tourLegs[next].label}`;
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
  if (tour) stopRoute();
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
$('tourBtn').onclick = startTour;

function setDest(n, sky) {
  dest = n;
  const d = destinations[n];
  if (sky) {
    stopRoute();
    setApproach(0.30);
    orbit = 0;
    $('tourPhase').textContent = '';
    $('surfaceDistance').textContent = '—';
    const scene = AsteriaSpace.scenes[d[0]];
    $('rangeLabel').textContent = scene?.belt ? '가장 가까운 소행성'
      : scene?.structure ? '중심 구조물' : '천체 표면';
    uploadSky(sky);
  }
  $('destinationName').textContent = d[1];
  $('destinationDesc').textContent = d[2];
  $('tracking').textContent = d[1];
  $('sector').textContent = d[3];
  $('routeCode').textContent = d[3];
  $('destinationSelect').value = String(n);
}
$('sectorCount').textContent = destinations.length + '개';
const optionsByGroup = new Map(Object.entries(groups).map(([id, label]) => {
  const options = document.createElement('optgroup');
  options.label = label;
  $('destinationSelect').append(options);
  return [id, options];
}));
destinations.forEach(([, , description, , group = 'legacy'], index) => {
  optionsByGroup.get(group).append(new Option(description, index));
});

const navigationMap = AsteriaNavigationMap.create(destinations, groups, {
  select(index) {
    if (loading || warp) return;
    $('destinationSelect').value = String(index);
    navigationMap.select(index);
  },
  travel: index => engage(index),
});
$('mapOpen').onclick = () => {
  keys.clear();
  drag = null;
  navigationMap.open();
};
$('destinationSelect').addEventListener('change', event => navigationMap.select(Number(event.target.value)));

setDest(0);
let startupAttempt = 0;
async function startBridge() {
  if (ready || loading) return;
  loading = true;
  const retry = startupAttempt++ ? `?retry=${Date.now()}` : '';
  if (retry) backgroundCache = null;
  $('retryStartup').hidden = true;
  $('startupStatus').textContent = '관측창 에셋을 불러오는 중입니다.';
  $('flightStatus').textContent = '관측창 준비 중';
  try {
    const [sky, images] = await Promise.all([loadSky(0, retry), loadImages(roomURLs, retry)]);
    uploadSky(sky);
    uploadRoom(images);
    ready = true;
    navigationMap.arrive(dest);
    $('mapOpen').disabled = false;
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
    navigationMap.setBusy(!ready);
    updateWalkControls();
    updateRouteControls();
  }
}
$('retryStartup').addEventListener('click', startBridge);
startBridge();
function layoutControls(){const main=$('bridge').getBoundingClientRect(),consoleBox=document.querySelector('.console').getBoundingClientRect();if(consoleBox.height)$('bridge').style.setProperty('--console-clear',(main.bottom-consoleBox.top)+'px');}
function resize(){const r=$('view').getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(devicePixelRatio||1,1.6,2200/Math.max(w,h,1));const c=$('effects');c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);updateFocal();layoutControls();}
function updateFocal(){focal=Math.max(Math.min(w,h)*.74,h*.44)*zoom;revision++;}
function updateWalkControls() {
  const available = ready && renderer.room.interior;
  $('walkToggle').disabled = !available || loading || !!warp;
  $('walkToggle').title = available ? '함교 이동 모드' : '함교 이동에는 실시간 3D 렌더러가 필요합니다.';
  $('walkToggle').setAttribute('aria-pressed', String(walking));
  $('walkToggle').textContent = walking ? '항해 복귀' : '함교 이동';
  $('bridge').classList.toggle('walking', walking);
  $('viewMode').textContent = walking ? 'WALK' : cinema ? 'OBSERVE' : auto ? 'AUTO' : 'MANUAL';
  $('viewHint').textContent = walking ? 'WASD 이동 · 드래그 시야 · Q/E 롤 · Space/Shift 높이 · Esc 복귀'
    : 'W A S D · 드래그 · Q/E 롤 · R 정면 · C 관측';
}
function setAuto(on) {
  auto = on;
  $('autopilot').setAttribute('aria-pressed', String(on));
  updateWalkControls();
}
function reset() {
  if (tour) stopRoute();
  setAuto(false);
  yaw = pitch = roll = 0;
  walkOrientation = AsteriaBridge.orientation(0, 0, 0);
  walkPosition = [...AsteriaBridge.origin];
  cameraDirty = true;
  zoom = 1;
  updateFocal();
}
function setWalking(on) {
  if (on && (!ready || !renderer.room.interior || loading || warp)) return;
  if (walking === on) return;
  if (on) {
    setCinema(false);
    setRoom(true);
    stopRoute();
    walkOrientation = AsteriaBridge.orientation(yaw * rad, pitch * rad, roll * rad);
  } else {
    updateCamera();
  }
  walking = on;
  walkPosition = [...AsteriaBridge.origin];
  keys.clear();
  cameraDirty = true;
  setAuto(false);
  updateRouteControls();
  revision++;
}
function setCinema(on) {
  if (on && walking) setWalking(false);
  cinema = on;
  $('bridge').classList.toggle('cinematic', on);
  $('cinema').setAttribute('aria-pressed', String(on));
  $('exitCinema').hidden = !on;
  updateWalkControls();
}
function setRoom(on) {
  if (!on && walking) setWalking(false);
  room = on;
  $('roomView').classList.toggle('room-off', !on);
  $('roomToggle').textContent = '함교 ' + (on ? 'ON' : 'OFF');
  $('roomToggle').setAttribute('aria-pressed', String(on));
}
function zoomBy(delta){zoom=clamp(zoom+delta,.65,1.7);updateFocal();}
const c=$('effects'),ctx=c.getContext('2d'),radar=$('radar').getContext('2d');
const stars=Array.from({length:360},()=>({x:(Math.random()-.5)*24,y:(Math.random()-.5)*24,z:.3+Math.random()*25,b:.2+Math.random()*.8}));
function project(x, y, z) {
  const m = cameraMatrix;
  const depth = m[6]*x + m[7]*y + m[8]*z;
  if (depth <= .08) return null;
  const horizontal = m[0]*x + m[1]*y + m[2]*z;
  const vertical = m[3]*x + m[4]*y + m[5]*z;
  return [w/2 + focal*horizontal/depth, h/2 - focal*vertical/depth, depth];
}
function line(a,b,color,width){if(!a||!b)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}
function effectFrame(dt,wa){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);let v=reduced?0:throttle*.025+wa*45;for(let s of stars){let old=s.z;s.z-=dt*v;if(s.z<.3){s.z=25;s.x=(Math.random()-.5)*24;s.y=(Math.random()-.5)*24;}let p=project(s.x,s.y,s.z);if(!p||p[0]<-20||p[0]>w+20||p[1]<-20||p[1]>h+20)continue;if(wa>.03){let q=project(s.x,s.y,s.z+wa*3.5);line(p,q,`rgba(171,223,255,${s.b*wa*.85})`,clamp(3/s.z,.5,2.4));}else{ctx.fillStyle=`rgba(207,233,255,${s.b*.42})`;ctx.beginPath();ctx.arc(p[0],p[1],clamp(2/s.z,.35,1.4),0,Math.PI*2);ctx.fill();}}
if((dest===7&&!renderer.sky.geometry)||event?.type==='asteroid'){let n=dest===7&&!renderer.sky.geometry?18:8;for(let i=0;i<n;i++){let t=elapsed*.18+i*2.73,xx=Math.sin(t)*7,yy=Math.cos(i*2.4)*2.6,zz=5+((i*2.17+elapsed*.23)%8);let p=project(xx,yy,zz);if(!p)continue;let r=clamp(focal*(.15+(i%4)*.07)/p[2],2,60),g=ctx.createRadialGradient(p[0]-r*.35,p[1]-r*.38,r*.08,p[0],p[1],r);g.addColorStop(0,'#c3aa9b');g.addColorStop(.55,'#645a55');g.addColorStop(1,'#15151b');ctx.fillStyle=g;ctx.beginPath();for(let k=0;k<9;k++){let a=k/9*Math.PI*2+elapsed*.05,rr=r*(.73+.22*Math.sin(i*3+k*7));ctx.lineTo(p[0]+Math.cos(a)*rr,p[1]+Math.sin(a)*rr);}ctx.closePath();ctx.fill();}}
if(event){let e=event,eventState=AsteriaEvents.state(e,elapsed),p=reduced?.52:eventState.progress,fade=reduced?.8:Math.min(1,p*5,(1-p)*5);if(!reduced&&e.type==='meteor'){for(let i=0;i<22;i++){let phase=(p*2.8+i*.137)%1,a=project(8-16*phase+i*.2,4-i*.32-3*phase,8+i%3),b=project(8-16*(phase-.08)+i*.2,4-i*.32-3*(phase-.08),8+i%3);line(a,b,`rgba(200,232,255,${fade*.75})`,1.6);}}
if(e.type==='comet'||e.type==='flyby'){let a=project(-8+16*p,.85+Math.sin(p*Math.PI)*.5,6),b=project(-10+16*p,-.1,6.8);if(a){if(e.type==='comet'){line(a,b,`rgba(119,204,255,${fade*.56})`,9);line(a,b,`rgba(221,245,255,${fade*.9})`,2);let g=ctx.createRadialGradient(a[0],a[1],0,a[0],a[1],35);g.addColorStop(0,'#eefaff');g.addColorStop(1,'#95d9ff00');ctx.fillStyle=g;ctx.fillRect(a[0]-35,a[1]-35,70,70);}else{ctx.fillStyle='#90c6d5';ctx.fillRect(a[0]-9,a[1]-3,18,6);ctx.fillStyle='#3f708c';ctx.fillRect(a[0]-22,a[1]-5,11,10);ctx.fillRect(a[0]+11,a[1]-5,11,10);ctx.fillStyle='#e3faff';ctx.fillRect(a[0]-2,a[1]-2,4,4);}}}
if(e.type==='flare'){let a=project(.6,.2,1);if(a){let r=Math.max(w,h)*.75,g=ctx.createRadialGradient(a[0],a[1],0,a[0],a[1],r);g.addColorStop(0,`rgba(255,170,65,${fade*(e.responded ? .14 : .36)})`);g.addColorStop(1,'#ff652000');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}}
if(e.type==='signal'){let a=project(1.2,.7,3);if(a){ctx.strokeStyle=`rgba(110,255,214,${fade*.65})`;ctx.lineWidth=1.4;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(a[0],a[1],5+((p*130+i*20)%60),0,7);ctx.stroke();}}}}
  if (event) AsteriaEvents.draw(event, elapsed, {ctx, width: w, height: h, project, reduced});
}
function drawRadar(t){let r=radar;r.clearRect(0,0,160,160);r.save();r.translate(80,80);r.strokeStyle='#305166';r.lineWidth=1;for(let i=1;i<=4;i++){r.beginPath();r.arc(0,0,i*17,0,7);r.stroke();}r.beginPath();r.moveTo(-68,0);r.lineTo(68,0);r.moveTo(0,-68);r.lineTo(0,68);r.stroke();let a=t*.9;let g=r.createRadialGradient(0,0,0,0,0,68);g.addColorStop(0,'#6deeea00');g.addColorStop(1,'#6deeea15');r.fillStyle=g;r.beginPath();r.moveTo(0,0);r.arc(0,0,68,a-.65,a);r.closePath();r.fill();r.strokeStyle='#69e3df';r.beginPath();r.moveTo(0,0);r.lineTo(Math.cos(a)*68,Math.sin(a)*68);r.stroke();for(let i=0;i<5;i++){let angle=i*2.5+dest*.4-yaw*rad,dist=17+i*10;r.fillStyle=event&&i===0?'#ffbf76':'#79e2dc';r.beginPath();r.arc(Math.cos(angle)*dist,Math.sin(angle)*dist,i===0?3:1.8,0,7);r.fill();}r.fillStyle='#d8ffff';r.fillRect(-2,-2,4,4);r.restore();}
function updateSpeed(wa=0){$('throttlePct').textContent=Math.round(throttle)+'%';$('power').textContent=Math.round(throttle)+'%';$('powerBar').style.width=throttle+'%';$('speedRead').textContent=wa>.2?(1+wa*8).toFixed(2):(throttle*.0068).toFixed(2);if(audioGain){audioGain.gain.setTargetAtTime(sound?.015+throttle*.0003+wa*.035:0,audioCtx.currentTime,.2);audioOsc.frequency.setTargetAtTime(39+throttle*.3+wa*40,audioCtx.currentTime,.2);}}
async function engage(n = null) {
  if (warp || loading) return;
  if (!ready) {
    notify('초기 우주 에셋 준비 중입니다.');
    return;
  }
  setWalking(false);
  loading = true;
  navigationMap.setBusy(true);
  updateWalkControls();
  stopRoute();
  $('warp').disabled = $('travel').disabled = $('destinationSelect').disabled = true;
  $('flightStatus').textContent = '항로 계산 중';
  try {
    const images = n !== null && n !== dest ? await loadSky(n) : null;
    if (event) endEvent();
    warp = {start: performance.now(), next: n, changed: false, images};
    navigationMap.begin(n);
    $('warp').classList.add('engaged');
    $('warp').querySelector('b').textContent = '워프 진행 중';
    $('flightStatus').textContent = '워프 항해 중';
    $('modeLabel').textContent = 'WARP DRIVE';
    notify(n === null ? '워프 드라이브 가동' : destinations[n][1] + ' 항로 설정 · 워프 개시');
  } catch (error) {
    const message = '목적지 이미지 로드 실패. 현재 구역 유지.';
    navigationMap.fail(message);
    notify(message);
    $('warp').disabled = $('travel').disabled = $('destinationSelect').disabled = false;
    $('flightStatus').textContent = '순항 항해 중';
  } finally {
    loading = false;
    navigationMap.setBusy(!!warp);
    updateWalkControls();
    updateRouteControls();
  }
}

function eventContext() {
  const [id, , , , group] = destinations[dest];
  const scene = AsteriaSpace.scenes[id];
  const deep = group === 'deep' || id === 'deep' || id === 'nebula';
  const world = group === 'world' || ['nereid', 'selene', 'eos', 'gaia'].includes(id);
  return {
    id, deep, world,
    moon: world && !!scene?.moon,
    star: group === 'star' || id === 'solaris',
    belt: !!scene?.belt,
    relic: group === 'relic',
    portal: id === 'halogate' || id === 'palimpsest',
    ring: !!(scene && renderer.sky.geometry && AsteriaSpace.nearRing(scene, approach, orbit)),
  };
}

function setEventHud(shield) {
  const text = shield + '%';
  if ($('shield').textContent !== text) {
    $('shield').textContent = text;
    $('shieldBar').style.width = text;
  }
}

function endEvent(returnFocus = true) {
  const hadFocus = $('eventBanner').contains(document.activeElement);
  event = null;
  $('eventBanner').hidden = true;
  $('environment').textContent = 'STABLE';
  setEventHud(100);
  if (returnFocus && hadFocus) $('eventBtn').focus({preventScroll: true});
}

function startEvent(type, context = eventContext()) {
  if (!ready || warp || loading) {
    notify('순항 중 우주 상황을 실행할 수 있습니다.');
    return;
  }
  const next = AsteriaEvents.start(type, context, elapsed);
  if (!next) {
    if (Object.hasOwn(events, type)) notify('발생 조건 · ' + events[type].requirement);
    return;
  }
  if (event) endEvent(false);
  event = next;
  const entry = events[type];
  $('eventName').textContent = entry.name;
  $('eventDescription').textContent = entry.description;
  $('eventAction').textContent = entry.action[0];
  $('eventAction').hidden = false;
  $('eventTime').textContent = entry.seconds + '초';
  $('eventBanner').hidden = false;
  $('environment').textContent = entry.code;
  notify(entry.name + ' · 관측 상황 개시');
}

for (const [type, entry] of Object.entries(events)) {
  $('eventSelect').append(new Option(entry.name, type));
}

$('eventAction').onclick = () => {
  const next = AsteriaEvents.respond(event, elapsed);
  if (!next || next === event) return;
  event = next;
  $('eventDescription').textContent = events[event.type].action[1];
  $('eventAction').hidden = true;
  $('eventDismiss').focus({preventScroll: true});
};
$('eventDismiss').onclick = () => endEvent();

function updateEvents() {
  if (!ready) return;
  if (event) {
    if (elapsed >= event.end) endEvent();
    else {
      const state = AsteriaEvents.state(event, elapsed);
      const time = state.remaining + '초';
      if ($('eventTime').textContent !== time) $('eventTime').textContent = time;
      setEventHud(state.shield);
    }
  }

  const context = eventContext();
  const key = context.id + '/' + context.ring;
  if (eventOptionsKey !== key) {
    eventOptionsKey = key;
    for (const option of $('eventSelect').options) {
      const entry = events[option.value];
      option.disabled = !AsteriaEvents.eligible(option.value, context);
      option.textContent = option.disabled ? entry.name + ' · ' + entry.requirement : entry.name;
    }
  }
  const enteredRing = context.ring && !wasInRing;
  wasInRing = context.ring;
  if (!random || event || warp || loading) return;
  if (enteredRing || elapsed >= nextEvent) {
    const available = Object.keys(events).filter(type => AsteriaEvents.eligible(type, context));
    const type = enteredRing ? 'ring' : available[Math.floor(Math.random() * available.length)];
    startEvent(type, context);
    nextEvent = elapsed + 30 + Math.random() * 30;
  }
}
$('travel').onclick=()=>engage(+$('destinationSelect').value);$('warp').onclick=()=>engage();$('speed').oninput=e=>{throttle=+e.target.value;updateSpeed();};$('autopilot').onclick=()=>{if(tour)stopRoute();setWalking(false);setAuto(!auto);};$('walkToggle').onclick=()=>{setWalking(!walking);$('view').focus({preventScroll:true});};$('reset').onclick=reset;$('cinema').onclick=()=>setCinema(true);$('exitCinema').onclick=()=>setCinema(false);$('roomToggle').onclick=()=>setRoom(!room);$('eventBtn').onclick=()=>startEvent($('eventSelect').value);$('randomEvent').onclick=()=>{random=!random;nextEvent=elapsed+6;$('randomEvent').textContent='자동 상황 '+(random?'ON':'OFF');$('randomEvent').setAttribute('aria-pressed',String(random));};$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('전체 화면을 지원하지 않거나 차단되었습니다.');}};
$('sound').onclick=async()=>{try{if(!audioCtx){let AC=window.AudioContext||window.webkitAudioContext;audioCtx=new AC();audioOsc=audioCtx.createOscillator();audioOsc.type='sine';audioGain=audioCtx.createGain();audioGain.gain.value=0;audioOsc.connect(audioGain).connect(audioCtx.destination);audioOsc.start();}await audioCtx.resume();sound=!sound;$('sound').setAttribute('aria-pressed',String(sound));$('sound').querySelector('span').textContent='음향 '+(sound?'ON':'OFF');updateSpeed();}catch{notify('음향을 사용할 수 없습니다.');}};
const view=$('view');view.addEventListener('pointerdown',e=>{if(e.button!==0)return;setAuto(false);view.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,id:e.pointerId};view.setPointerCapture(e.pointerId);});view.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;turnView(-(e.clientX-drag.x)*.19,(e.clientY-drag.y)*.19);drag.x=e.clientX;drag.y=e.clientY;});for(let ev of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(ev,()=>drag=null);view.addEventListener('dblclick',reset);view.addEventListener('wheel',e=>{e.preventDefault();zoomBy(-Math.sign(e.deltaY)*.08);},{passive:false});
const map={arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d'}, editable=el=>el&&['INPUT','SELECT','TEXTAREA'].includes(el.tagName);
window.addEventListener('keydown', e => {
  if ($('mapDialog').open) return;
  if (e.key === 'Escape') {
    if (cinema) setCinema(false);
    if (walking) setWalking(false);
    keys.clear();
    return;
  }
  if ($('helpDialog').open || editable(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = map[e.key.toLowerCase()] || e.key.toLowerCase();
  const vertical = walking && [' ', 'shift'].includes(k) && document.activeElement === view;
  if ((k.length === 1 && 'wasdqe'.includes(k)) || vertical) {
    e.preventDefault();
    keys.add(k);
    if (auto) setAuto(false);
  } else if (!e.repeat) {
    if (k === 'r') reset();
    else if (k === 'c') setCinema(!cinema);
    else if (k === 'v') {
      setWalking(!walking);
      if (walking) view.focus({preventScroll:true});
    }
    else if (k === '+' || k === '=') zoomBy(.1);
    else if (k === '-') zoomBy(-.1);
  }
});
window.addEventListener('keyup',e=>keys.delete(map[e.key.toLowerCase()]||e.key.toLowerCase()));
window.addEventListener('blur',()=>{keys.clear();drag=null;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();resetQualitySamples();}});
document.querySelectorAll('[data-key]').forEach(button => {
  const key = button.dataset.key;
  button.addEventListener('click', e => {
    if (e.detail !== 0 || !walking) return;
    if (key === 'q' || key === 'e') turnView(0, 0, key === 'e' ? 12 : -12);
    else moveInside(.12, new Set([key]));
  });
  button.addEventListener('pointerdown', e => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    if (auto) setAuto(false);
    keys.add(key);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(event, () => keys.delete(key));
  }
});
function frame(now){const frameMs=now-last;let dt=Math.min(.12,frameMs/1000);last=now;elapsed+=dt;const step = 92*dt;
const bank = step*(Number(keys.has('e')) - Number(keys.has('q')));
if (walking) {
  turnView(0, 0, bank);
  updateCamera();
  moveInside(dt);
} else {
  const automatic = auto && !reduced ? 9*dt : 0;
  turnView(step*(Number(keys.has('d')) - Number(keys.has('a'))) + automatic,
    step*(Number(keys.has('w')) - Number(keys.has('s'))), bank);
}
let wa=0;if(warp){let p=(now-warp.start)/3800;navigationMap.progress(clamp(p,0,1));wa=reduced?0:clamp(Math.min(p*5,(1-p)*4),0,1);if(p>.48&&!warp.changed){warp.changed=true;if(warp.next!==null)setDest(warp.next,warp.images);reset();}if(p>=1){warp=null;wa=0;navigationMap.arrive(dest);navigationMap.setBusy(false);updateWalkControls();updateRouteControls();$('warp').classList.remove('engaged');$('warp').querySelector('b').textContent='워프 항해';$('warp').disabled=$('travel').disabled=$('destinationSelect').disabled=false;$('flightStatus').textContent='순항 항해 중';$('modeLabel').textContent='SUBLIGHT DRIVE';notify('워프 종료 · 관측 구역 도착');}updateSpeed(wa);}$('warpGlow').style.opacity=wa*.8;
advanceTour(dt);updateCamera();advanceRoute(dt);updateEvents();renderCamera(now,frameMs);effectFrame(dt,wa);drawRadar(elapsed);let bearing=(yaw+360)%360;$('heading').textContent=bearing.toFixed(1).padStart(5,'0')+'°';$('pitchRead').textContent=(pitch>=0?'+':'')+pitch.toFixed(1)+'°';$('rollRead').textContent=(roll>=0?'+':'')+roll.toFixed(1)+'°';$('compassText').textContent=['FWD','STBD','AFT','PORT'][Math.round(bearing/90)%4]+' · '+Math.round(bearing).toString().padStart(3,'0')+'°';let sec=Math.floor(Date.now()/1000);if(sec!==clockSec){clockSec=sec;$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC';}requestAnimationFrame(frame);}
window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(layoutControls).observe(document.querySelector('.console'));resize();updateSpeed();requestAnimationFrame(frame);
})();
