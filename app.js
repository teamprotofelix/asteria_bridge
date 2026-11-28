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
const eventCooldown = new Map();
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches, keys=new Set();
let yaw=0,pitch=0,roll=0,zoom=1,focal=500,w=1,h=1,dpr=1,throttle=35,auto=false,cinema=false,room=true,dest=0,warp=null,loading=false,event=null,random=false,nextEvent=0,drag=null,last=performance.now(),elapsed=0,toastTimer,clockSec=-1;
const wrap=a=>((a+180)%360+360)%360-180, clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), rad=Math.PI/180;
const soundscape = AsteriaAudio.create();
const flight = AsteriaFlight.create();
let independentView = null, flightTravel = null, flightRecovery = '', activeFlightScene = null;
const flightKeys = new Set();
const sticks = {rotation:[0,0], translation:[0,0]};
const flightStatusNames = {IDLE:'수동 조종',PLAN:'항로 계산',ALIGN:'기수 정렬',LOAD:'에셋 준비',
  WARP:'워프',ARRIVE:'도착',APPROACH:'접근 보조',ORBIT:'공전 보조',OBSERVE:'관측 거리 유지',
  DEPART:'이탈 보조',ABORT:'출항 취소',RECOVER:'현재 구역 유지'};
const flightKeyNames = new Set(['w','a','s','d','q','e','i','k','j','l','u','o','shift','control',' ']);
let watch = null, audioWarp = null, nextAudioUpdate = 0, nextRadarCue = 0;
let hatchOpen = false, hatchSlide = 0, hatchOverride = null;
let seat = null, standingPose = null, stepDistance = 0;
let nightBridge = false, bridgeAlert = 0, bridgeWarp = 0;
const safeBridgeEvents = new Set(['meteor','asteroid','flare','ring','dust','stellarFlare','pulsar','nebulaTurbulence']);
let drawnMariePose = null, lastMarieDraw = 0, crewClockReset = false;
const watchRoute = ['nereid','gaia','halogate','nebula','cryon','helion','undertow','hush'];
const defaultWatch={stops:watchRoute.map(sectorId=>({sectorId,seconds:45})),repeat:0,view:'bridge',audio:'inherit'};

let walking = false;
let walkPosition = [...AsteriaBridge.origin];
let walkOrientation = AsteriaBridge.orientation(0, 0, 0);
let cameraMatrix = AsteriaBridge.matrix(walkOrientation);
let cameraDirty = false;
let drawnRoomPosition = null, drawnRoomFrame = null;

function loadImg(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const image = new Image();
    const fail = () => finish(Error('이미지 로드 실패: ' + url));
    const abort = () => finish(signal.reason);
    const timeout = setTimeout(fail, 15000);
    function finish(error) {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      if (error) {
        image.removeAttribute('src');
        reject(error);
      } else resolve(image);
    }
    signal?.addEventListener('abort', abort, {once: true});
    image.onload = () => finish();
    image.onerror = fail;
    image.src = url;
  });
}
async function loadImages(paths, retry = '', signal) {
  const images = [];
  for (let first = 0; first < paths.length; first += 3) {
    images.push(...await Promise.all(paths.slice(first, first+3).map(path => loadImg(path + retry, signal))));
  }
  return images;
}
function urls(id) { return faces.map(face => `${base}${id}-${face}.webp`); }
const roomURLs=faces.map(f=>`${base}bridge-${f}.webp`);
let renderer=null,ready=false,revision=0,drawn='',lastDraw=0,lastSkyDraw=0,lastMotion=0,activeSky=null,activeRoom=null;
let qualityMode = 'auto', activeQuality = null, assetRequest = null, displayFps = 0, hudUpdatedAt = 0;
const qualityNames = {auto: 'Auto', ultra: 'Ultra', high: 'High', medium: 'Medium', low: 'Low', compatibility: 'Compatibility'};
const constrained = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) < 6;
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

async function loadSky(n, retry = '', signal, mode = qualityMode) {
  const [id] = destinations[n];
  if (!navigator.onLine && !await persistence.availableOffline(id)) throw Error('Offline sector unavailable');
  if (signal?.aborted) throw signal.reason;
  const oldScene = AsteriaSpace.scenes[id];
  const legacy = loadImages(urls(oldScene?.fallback ?? id), retry, signal);
  if (!renderer.gpu || mode === 'compatibility') {
    return {legacy: await legacy, quality: {tier: 'compatibility', reason: '기존 360° 파노라마'}};
  }
  const preparation = (async () => {
    const sky = renderer.sky;
    const record = await AsteriaSkyAssets.record(id, signal).catch(error => {
      if (signal?.aborted) throw error;
      return null;
    });
    const preferred = mode === 'auto' ? constrained ? 'low' : 'medium' : mode;
    const cap = Math.min(sky.textureLimits.cube, constrained ? 1024 : 4096);
    const packed = await AsteriaSkyAssets.loadBackground(record, preferred, cap, signal, loadImg);
    if (packed) packed.heading = Number.isFinite(record.skyHeading) ? record.skyHeading * rad : 0;
    const quality = packed || {tier: 'compatibility', reason: '신규 배경 사용 불가 · 기존 배경'};
    if (!sky.space || !oldScene) return {panorama: packed?.images, quality};

    const background = packed?.images ?? await loadImages(urls(oldScene.background ?? 'deep'), retry, signal);
    let surface = null;
    if (oldScene.surface) {
      const limit = Math.min(sky.textureLimits.surface, constrained && preferred === 'low' ? 2048 : 4096);
      surface = await AsteriaSkyAssets.loadSurface(record, limit, signal, loadImg)
        ?? await loadImg(`${base}${oldScene.surface}-4k.webp${retry}`, signal);
    }
    const light = record?.keyLight;
    const keyLight = Array.isArray(light) && light.length === 3 && light.every(Number.isFinite) ? light : null;
    const scene = {...oldScene, keyLight, ocean: id === 'gaia' || id === 'thalassa' || id === 'verdant',
      textureCap: preferred === 'low' ? 2048 : 4096, newSky: !!packed, skyHeading: packed?.heading ?? 0};
    return {geometry: {scene, background, surface}, quality};
  })().catch(error => {
    if (signal?.aborted) throw error;
    return {quality: {tier: 'compatibility', reason: '천체 에셋 오류 · 기존 파노라마'}};
  });
  const [fallback, visual] = await Promise.all([legacy, preparation]);
  return {legacy: fallback, ...visual};
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
  const panorama = `
    precision mediump float;
    varying vec2 uv;
    uniform vec2 scale;
    uniform mat3 rot;
    uniform samplerCube cube;
    uniform vec2 presentation;
    void main(){
      vec3 ray=rot*vec3(uv*scale,1.);
      float c=cos(presentation.x), s=sin(presentation.x);
      vec4 texel=textureCube(cube,vec3(c*ray.x+s*ray.z,ray.y,c*ray.z-s*ray.x));
      vec3 rgb=texel.rgb;
      if(presentation.y>.5) rgb=pow(max(rgb-vec3(.006),vec3(0.)),vec3(.76));
      gl_FragColor=vec4(rgb,texel.a);
    }`;
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
  const presentation = gl.getUniformLocation(cubeProgram.program, 'presentation');
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
  const textureLimits = {cube: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
    surface: gl.getParameter(gl.MAX_TEXTURE_SIZE)};
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

  let skyStyle = null;
  function upload(images, scene, style = null) {
    skyStyle = style;
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
    currentImages = alpha ? images : null;
  }

  function draw(matrix, width, height, moving) {
    if (!texture) return;
    const limit = bridgeMesh ? (moving ? 960 : 1720) : qualityMode === 'auto' ? renderLimit
      : AsteriaSkyAssets.caps[activeQuality?.tier] ?? 1080;
    const pixelRatio = !alpha || bridgeMesh ? Math.min(dpr, limit / Math.max(width, height, 1)) : dpr;
    const dw = Math.max(1, Math.round(width * pixelRatio));
    const dh = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== dw || canvas.height !== dh) {
      canvas.width = dw;
      canvas.height = dh;
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (bridgeMesh) {
      bridgeMesh.draw(matrix, walkPosition, width / (2*focal), height / (2*focal), hatchSlide, marie.pose(), bridgeLight());
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
    if (!geometry) gl.uniform2f(presentation, skyStyle?.heading ?? 0, Number(!!skyStyle?.width));
    const distance = geometry ? space.draw(reduced ? 0 : elapsed, approach, orbit, flight.state?.position) : null;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return distance;
  }

  return {
    upload, draw, space: !!space, interior: !!bridgeMesh, textureLimits,
    get textureCount() { return Number(!!texture) + Number(geometry); },
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
  const orientation = flight.state ? independentView ?? flight.state.orientation : watchingPose() ?? (walking ? walkOrientation : AsteriaBridge.orientation(yaw * rad, pitch * rad, roll * rad));
  cameraMatrix = AsteriaBridge.matrix(orientation);
  cameraDirty = false;
}

function turnView(horizontal, vertical, bank = 0) {
  if (!horizontal && !vertical && !bank) return;
  if (tour) stopRoute();
  if (flight.state) {
    if (!independentView) return;
    independentView = AsteriaBridge.turn(independentView,horizontal*rad,vertical*rad,bank*rad);
  } else if (walking) {
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
  if (seat || (!forward && !sideways && !vertical)) return;
  const distance = 2.15 * dt / Math.max(1, Math.hypot(forward, sideways, vertical));
  const bearing = Math.atan2(cameraMatrix[6], cameraMatrix[8]);
  const before = walkPosition;
  walkPosition = AsteriaInterior.move(before, [
    distance*(sideways*Math.cos(bearing) + forward*Math.sin(bearing)),
    distance*vertical,
    distance*(forward*Math.cos(bearing) - sideways*Math.sin(bearing)),
  ], hatchSlide, marie.pose().point);
  stepDistance += Math.hypot(walkPosition[0]-before[0], walkPosition[2]-before[2]);
  if (stepDistance >= .79) {
    stepDistance = 0;
    soundscape.cue('step', walkPosition);
  }
  updateBridgeAction();
}

function renderCamera(now, frameMs) {
  if (!ready) return;
  if (renderer.sky.geometry && !reduced && qualityMode === 'auto') adaptQuality(now, frameMs);
  const angles = watchingPose() ?? (flight.state ? [...(independentView ?? flight.state.orientation),...flight.state.position] : walking ? walkOrientation : [yaw, pitch, roll]);
  const key = [...angles, zoom, w, h, room, revision].join('/');
  const roomFrame = [hatchSlide, nightBridge, !!watch, bridgeWarp, bridgeAlert].join('/');
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
  if (room) {
    const pose = renderer.room.interior ? marie.pose() : null;
    const poseKey = pose?.revision;
    const marieMoved = poseKey !== drawnMariePose && now - lastMarieDraw >= 50;
    if (redrawCamera || roomMoved || marieMoved || roomFrame !== drawnRoomFrame) {
      renderer.room.draw(cameraMatrix, w, h, moving || marieMoved);
      drawnMariePose = poseKey;
      drawnRoomFrame = roomFrame;
      lastMarieDraw = now;
    }
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
  if (!geometry && event?.type==='stellarFlare') endEvent();
  if (!geometry && flight.state) {
    cancelFlightTravel();
    if (event) endEvent();
    setPilot(false);
    notify('자유 조종 종료 · 기존 360° 관측으로 복귀');
  }
  updateWalkControls();
  if (geometry) updateRouteControls();
  else stopRoute();
}
function uploadSky(sky) {
  activeSky = sky.legacy;
  try {
    const geometry = renderer.sky.space ? sky.geometry : null;
    renderer.sky.upload(geometry ? geometry.background : sky.panorama ?? sky.legacy, geometry, {width: sky.quality.width, heading: sky.quality.heading});
    activeFlightScene=geometry?.scene ?? null;
    const {tier, width, reason} = sky.quality;
    activeQuality = {tier, width, reason};
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
  activeQuality = {tier: 'compatibility', reason};
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
  const blocked = !ready || !renderer.sky.geometry || loading || !!warp || !!flight.state;
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
    journal('observation');
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

let commandEpoch=0;
const sectorIds=new Set(destinations.map(([id])=>id));
const voyage=AsteriaVoyage.create(sectorIds,new Set(Object.keys(events)),{
  storage:{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)},
  withLock:navigator.locks ? task=>navigator.locks.request(AsteriaVoyage.key,task) : null,
  makeId:()=>globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),
});
window.addEventListener('storage',event=>voyage.reconcile(event.key));
function journal(kind,sectorId=destinations[dest][0],eventId=null) {
  void voyage.record(kind,sectorId,elapsed,eventId);
}
const marie = AsteriaMarie.create(destinations,reduced,kind=>journal(kind));
const navigationMap = AsteriaNavigationMap.create(destinations, groups, {
  voyage,
  select(index) {
    if (loading || warp) return;
    $('destinationSelect').value = String(index);
    navigationMap.select(index);
    marie.plan(index);
  },
  travel: index => engage(index),
});
$('mapOpen').onclick = () => {
  keys.clear();
  neutralFlightInput();
  drag = null;
  navigationMap.open();
};
$('destinationSelect').addEventListener('change', event => {
  const index = Number(event.target.value);
  navigationMap.select(index);
  marie.plan(index);
});
$('marieOpen').onclick = () => {
  keys.clear();
  neutralFlightInput();
  drag = null;
  marie.open();
};

const commandCenter=AsteriaMarieConsole.create(destinations,{
  purgeVoyageMemory:voyage.purgeMarieCopy,
  snapshot() {
    const [sectorId,sectorName]=destinations[dest];
    return {sectorId,sectorName,ready,epoch:commandEpoch,busy:!!(loading||warp||flightTravel),
      mode:warp?'워프':watch?'자동 관측':flight.state?'자유 조종':walking?'함교 이동':'순항',
      eventName:event ? events[event.type].name : null,watch:!!watch,visited:navigationMap.visits(),
      ...marie.reportSnapshot()};
  },
  execute({intent,sectorId,enabled}) {
    const index=sectorId ? destinations.findIndex(([id])=>id===sectorId) : -1;
    switch(intent) {
      case 'plan_route':
        $('destinationSelect').value=String(index);
        $('destinationSelect').dispatchEvent(new Event('change'));
        return destinations[index][1]+' 항로를 지정했습니다. 워프는 별도 명령과 승인이 필요합니다.';
      case 'warp':
        $('destinationSelect').value=String(index);
        $('destinationSelect').dispatchEvent(new Event('change'));
        void engage(index);
        return destinations[index][1]+' 출항 준비를 시작합니다.';
      case 'start_watch':
        setCinema(true);
        startWatch();
        return '8개 구역 자동 관측을 시작했습니다. 종료할 때까지 순회합니다.';
      case 'stop':
        if (flightTravel && !warp) cancelFlightTravel();
        else if (flightTravel) flightTravel=null;
        if (assetRequest && !warp) assetRequest.abort();
        if (watch) setCinema(false);
        if (flight.state) {flight.assist('IDLE');flight.brake();}
        stopRoute();
        setAuto(false);
        keys.clear();
        neutralFlightInput();
        return warp ? '이미 시작한 워프는 도착까지 계속합니다. 자동 관측과 후속 이동을 중지했습니다.'
          : '자동 관측과 이동 보조를 중지했습니다.';
      case 'stop_watch':
        if (!watch) return '자동 관측이 진행되고 있지 않습니다.';
        setCinema(false);
        return warp ? '자동 관측을 종료했습니다. 현재 워프는 도착까지 진행합니다.' : '자동 관측을 종료했습니다.';
      case 'prepare_tea': return marie.requestTea(false);
      case 'receive_tea': return marie.requestTea(true);
      case 'launch_drone': return marie.launchDrone();
      case 'recall_drone': return marie.recallDrone();
      case 'follow': return marie.setFollow(enabled);
    }
    return '함교에서 지원하지 않는 명령입니다.';
  },
});
function openCommand(trigger) {
  if (!ready) return;
  keys.clear();
  neutralFlightInput();
  drag=null;
  commandCenter.open(trigger);
}
$('marieCommand').onclick=()=>{
  $('marieDialog').close();
  openCommand($('marieOpen'));
};
$('watchCommand').onclick=()=>openCommand($('watchCommand'));

const persistence=AsteriaVoyagePanel.create(destinations,events,voyage,{
  busy:()=>!ready || !!(loading || warp || watch || flightTravel),
  start(plan) {
    if (!ready || loading || warp || watch || flightTravel) return false;
    setCinema(true);
    startWatch(plan);
    return true;
  },
  restore(index) {
    if (!ready || loading || warp || watch || flightTravel || index===dest) return false;
    void restoreSafe(index);
    return true;
  },
  assetPaths:offlineSectorPaths,
});
setDest(0);
let startupAttempt = 0;
async function startBridge() {
  if (ready || loading) return;
  loading = true;
  const retry = startupAttempt++ ? `?retry=${Date.now()}` : '';
  $('retryStartup').hidden = true;
  $('startupStatus').textContent = '관측창 에셋을 불러오는 중입니다.';
  $('flightStatus').textContent = '관측창 준비 중';
  try {
    const stored=voyage.data.preferences.persist ? voyage.data.safeFlightState?.sectorId : null;
    let initial=Math.max(0,destinations.findIndex(([id])=>id===stored));
    const firstSky=loadSky(initial,retry).catch(error=>{
      if (!initial) throw error;
      initial=0;
      notify('저장 구역의 에셋을 사용할 수 없어 네레이드에서 시작합니다.');
      return loadSky(0,retry);
    });
    const [sky,images]=await Promise.all([firstSky,loadImages(roomURLs,retry)]);
    setDest(initial,sky);
    navigationMap.select(initial);
    uploadRoom(images);
    ready = true;
    navigationMap.arrive(dest);
    marie.arrive(dest);
    journal('arrival');
    $('marieOpen').disabled = false;
    $('mapOpen').disabled = false;
    $('qualityOpen').disabled = false;
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
    updateWatchControls();
    updateWalkControls();
    updateRouteControls();
    persistence.refresh();
  }
}
$('retryStartup').addEventListener('click', startBridge);
startBridge();
function layoutControls(){const main=$('bridge').getBoundingClientRect(),consoleBox=document.querySelector('.console').getBoundingClientRect();if(consoleBox.height)$('bridge').style.setProperty('--console-clear',(main.bottom-consoleBox.top)+'px');}
function resize(){const r=$('view').getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(devicePixelRatio||1,1.6,2200/Math.max(w,h,1));const c=$('effects');c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);updateFocal();layoutControls();}
function updateFocal(){focal=Math.max(Math.min(w,h)*.74,h*.44)*zoom;revision++;}
function updateWalkControls() {
  const pilot = !!flight.state;
  const canPilot = ready && renderer.sky.geometry;
  $('flightToggle').disabled = !canPilot || loading || !!warp || !!flightTravel;
  $('flightToggle').setAttribute('aria-pressed',String(pilot));
  $('flightToggle').textContent = pilot ? '조종 종료' : '자유 조종';
  $('flightCapability').hidden = !ready || canPilot;
  $('flightPanel').hidden = !pilot && !flightTravel;
  $('bridge').classList.toggle('piloting',pilot);
  const available = ready && renderer.room.interior;
  $('walkToggle').disabled = !available || loading || !!warp;
  $('walkToggle').title = available ? '함교 이동 모드' : '함교 이동에는 실시간 3D 렌더러가 필요합니다.';
  $('walkToggle').setAttribute('aria-pressed', String(walking));
  $('walkToggle').textContent = walking ? '항해 복귀' : '함교 이동';
  $('bridge').classList.toggle('walking', walking);
  $('viewMode').textContent = pilot ? 'PILOT' : seat ? 'SEATED' : walking ? 'WALK' : cinema ? 'OBSERVE' : auto ? 'AUTO' : 'MANUAL';
  updateBridgeAction();
  $('viewHint').textContent = walking ? 'WASD 이동 · Space/Shift 높이 · F 상호작용 · Esc 복귀'
    : 'W A S D · 드래그 · Q/E 롤 · R 정면 · C 관측';
}
function setAuto(on) {
  auto = on;
  $('autopilot').setAttribute('aria-pressed', String(on));
  updateWalkControls();
}
function reset() {
  if (flight.state) {
    flight.assist('IDLE');
    flight.brake();
    const orientation = AsteriaBridge.orientation(0,0,0);
    if (independentView) independentView=orientation;
    else flight.state.orientation=orientation;
    cameraDirty=true;
    return;
  }
  if (tour) stopRoute();
  setAuto(false);
  yaw = pitch = roll = 0;
  walkOrientation = AsteriaBridge.orientation(0, 0, 0);
  walkPosition = [...AsteriaBridge.origin];
  seat = standingPose = null;
  hatchOverride = null;
  updateWalkControls();
  cameraDirty = true;
  zoom = 1;
  updateFocal();
}
function setWalking(on) {
  if (on && (!ready || !renderer.room.interior || loading || warp)) return;
  if (walking === on) return;
  if (on) {
    cancelFlightTravel();
    setPilot(false);
    setCinema(false);
    setRoom(true);
    stopRoute();
    walkOrientation = AsteriaBridge.orientation(yaw * rad, pitch * rad, roll * rad);
  }
  walking = on;
  seat = standingPose = null;
  hatchOverride = null;
  stepDistance = 0;
  walkPosition = [...AsteriaBridge.origin];
  keys.clear();
  cameraDirty = true;
  setAuto(false);
  updateRouteControls();
  revision++;
}
function setCinema(on) {
  const active = document.activeElement;
  const restoreFocus = active === $('exitCinema') || $('observationControls').contains(active);
  if (on && walking) setWalking(false);
  if (on && flight.state) {cancelFlightTravel();setPilot(false);}
  if (!on && watch) stopWatch();
  cinema = on;
  $('bridge').classList.toggle('cinematic', on);
  $('cinema').setAttribute('aria-pressed', String(on));
  $('exitCinema').hidden = !on;
  updateWatchControls();
  updateWalkControls();
  if (!on && restoreFocus) $('cinema').focus({preventScroll: true});
}

function updateWatchControls() {
  $('bridge').classList.toggle('watching', !!watch);
  $('observationControls').hidden = !cinema;
  $('watchStart').hidden = !!watch;
  $('watchStart').disabled = !ready || loading || !!warp;
  $('watchNext').hidden = !watch;
  $('watchNext').disabled = loading || !!warp;
  $('watchPause').hidden = !watch;
  $('watchPause').textContent = watch?.paused ? '재개' : '일시정지';
  $('watchEditor').hidden = !!watch;
  $('watchSound').disabled = watch?.route.audio==='mute';
  $('exitCinema').textContent = watch ? '자동 관측 종료' : '▣ 함교 조작 복귀';
  updateWatchReadout();
}
function updateWatchReadout() {
  const text=!watch ? '' : watch.failures>=2 && watch.paused ? '로드 실패 · 재개로 재시도하거나 다음 구역으로 건너뛰기'
    : watch.paused ? '일시정지' : loading ? '구역 준비 중' : warp ? '워프 진행 중'
      : '다음 구역까지 '+Math.max(0,Math.ceil(watch.remaining))+'초';
  if ($('watchStatus').textContent!==text) $('watchStatus').textContent=text;
}
function watchingPose() {
  const place=watch && AsteriaInterior.seats[watch.route.view];
  return place && room && renderer.room.interior ? AsteriaBridge.orientation(place.heading,0,0) : null;
}
function watchPreset() {
  if (!watch) return;
  const place=AsteriaInterior.seats[watch.route.view];
  walkPosition=place && renderer.room.interior ? [...place.eye] : [...AsteriaBridge.origin];
  setRoom(watch.route.view!=='exterior');
  cameraDirty=true;
  revision++;
}
function startWatch(plan=defaultWatch) {
  if (!cinema || !ready || loading || warp || watch) return;
  stopRoute();
  if (event) endEvent();
  const prior={auto,room};
  watch={...AsteriaWatch.create(plan,destinations[dest][0],plan===defaultWatch),prior};
  setAuto(false);
  watchPreset();
  updateWatchControls();
  updateAudio();
  $('exitCinema').focus({preventScroll:true});
}
function stopWatch() {
  assetRequest?.abort();
  const {prior}=watch;
  watch=null;
  walkPosition=[...AsteriaBridge.origin];
  cameraDirty=true;
  revision++;
  setAuto(prior.auto);
  setRoom(prior.room);
  updateAudio();
}
function settleObservation(session,leg) {
  AsteriaWatch.arrive(session,leg);
  session.pendingLeg=null;
  watchPreset();
  journal('observation',leg.sectorId);
  updateWatchControls();
}
function advanceWatch(dt) {
  if (!watch || watch.paused || loading || warp || document.hidden) return;
  watch.remaining-=watch.skipFrame ? 0 : dt;
  watch.skipFrame=false;
  if (watch.remaining>0) {updateWatchReadout();return;}
  const session=watch;
  const leg=AsteriaWatch.candidate(session);
  if (!leg) {
    setCinema(false);
    notify('지정한 자동 관측을 마쳤습니다.');
    return;
  }
  if (leg.sectorId===destinations[dest][0]) settleObservation(session,leg);
  else {
    session.pendingLeg=leg;
    void engage(destinations.findIndex(([id])=>id===leg.sectorId),session);
  }
}
function offlineSectorPaths(id) {
  const scene=AsteriaSpace.scenes[id];
  const paths=urls(scene?.fallback ?? id);
  if (scene) {
    paths.push(...urls(scene.background ?? 'deep'));
    if (scene.surface) paths.push(base+scene.surface+'-4k.webp');
  }
  return [...new Set(paths)];
}
async function restoreSafe(index) {
  loading=true;
  setTravelBusy(true);
  try {
    const sky=await loadSky(index);
    endEvent();
    setPilot(false);
    setWalking(false);
    setDest(index,sky);
    reset();
    navigationMap.select(index);
    navigationMap.arrive(index);
    marie.arrive(index);
    journal('arrival');
    notify('저장된 관측 구역을 열었습니다.');
  } catch {
    notify('저장 구역을 열 수 없습니다. 현재 구역을 유지합니다.');
  } finally {
    loading=false;
    setTravelBusy(false);
  }
}

function updateAudio() {
  soundscape.mix({throttle, warp: audioWarp, ambient: !!watch, hidden: document.hidden || watch?.route.audio==='mute' || !!watch?.paused,
    listener: walkPosition, right: Array.from(cameraMatrix.slice(0, 3)),
    volume: Number($('bridgeVolume').value) / 100});
}

function refreshSoundControls() {
  const enabled = soundscape.enabled;
  const label = '음향 ' + (enabled ? 'ON' : 'OFF');
  $('sound').setAttribute('aria-pressed', String(enabled));
  $('sound').querySelector('span').textContent = label;
  $('watchSound').setAttribute('aria-pressed', String(enabled));
  $('watchSound').textContent = label;
}

async function toggleSound() {
  try {
    await soundscape.toggle();
  } catch {
    notify('음향을 사용할 수 없습니다.');
  }
  refreshSoundControls();
}

function advanceAudio(now) {
  if (!soundscape.enabled || document.hidden || now < nextAudioUpdate) return;
  nextAudioUpdate = now + 85;
  updateAudio();
  if (!watch && !warp && now >= nextRadarCue) {
    soundscape.cue('radar');
    nextRadarCue = now + 12500;
  }
}

function bridgeEvent(type, detail) {
  $('bridge').dispatchEvent(new CustomEvent('asteria:bridge', {detail: {type, ...detail}}));
}

function updateBridgeAction() {
  const bar = $('bridgeInterior');
  bar.hidden = !walking;
  if (!walking) return;
  const action = $('bridgeAction');
  const target = seat ? null : AsteriaInterior.nearby(walkPosition);
  const label = seat ? AsteriaInterior.seats[seat].label + '에서 일어나기'
    : target?.id === 'hatch' ? (hatchOpen ? '후방 출입문 닫기' : '후방 출입문 열기')
    : target?.label ?? '좌석이나 콘솔에 접근';
  if (action.textContent !== label) action.textContent = label;
  action.disabled = !seat && !target;
}

function interactBridge() {
  if (!walking || loading || warp) return;
  if (seat) {
    const previous = seat;
    ({position: walkPosition, orientation: walkOrientation} = standingPose);
    seat = standingPose = null;
    bridgeEvent('stand', {id: previous});
  } else {
    const target = AsteriaInterior.nearby(walkPosition);
    if (!target) return;
    const place = AsteriaInterior.seats[target.id];
    if (place) {
      standingPose = {position: [...walkPosition], orientation: walkOrientation};
      seat = target.id;
      walkPosition = [...place.eye];
      walkOrientation = AsteriaBridge.orientation(place.heading, 0, 0);
      bridgeEvent('seat', {id: seat});
    } else if (target.id === 'hatch') {
      if (hatchOpen && AsteriaInterior.nearHatch(walkPosition)) {
        notify('출입문 통로가 비면 닫을 수 있습니다.');
        return;
      }
      hatchOverride = !hatchOpen;
    } else if (target.id === 'science') {
      $('mapOpen').click();
    } else {
      void toggleSound();
    }
  }
  keys.clear();
  cameraDirty = true;
  updateWalkControls();
  if (!$('mapDialog').open) $('view').focus({preventScroll: true});
}

function updateHatch(dt) {
  const sensor = walking && !seat && AsteriaInterior.hatchSensor(walkPosition, hatchOpen);
  if (!walking || Math.abs(walkPosition[2] + 4.86) > 2.7 || Math.abs(walkPosition[0]) > 1.6) hatchOverride = null;
  const [crewX,crewZ] = marie.pose().point;
  const crewInDoor = hatchSlide >= .45 && AsteriaInterior.nearHatch([crewX,0,crewZ]);
  const next = (hatchOverride ?? sensor) || crewInDoor || (walking && AsteriaInterior.nearHatch(walkPosition));
  if (hatchOpen !== next) {
    hatchOpen = next;
    soundscape.cue('hatch');
    bridgeEvent('hatch', {open: hatchOpen});
    updateBridgeAction();
  }
  hatchSlide = reduced ? Number(hatchOpen) : clamp(hatchSlide + (hatchOpen ? 1 : -1)*dt*2, 0, 1);
}

function bridgeLight() {
  const id = destinations[dest][0];
  const scene = AsteriaSpace.scenes[id];
  const tint = scene?.atmosphere ?? (id === 'nebula' ? [.46,.38,.96] : [.43,.63,.87]);
  const source = scene?.keyLight ?? [-.61,.53,-.59];
  const magnitude = Math.hypot(...source) || 1;
  return {tint, direction: source.map(component => component/magnitude),
    levels: [nightBridge || watch ? .24 : 1, bridgeWarp, bridgeAlert]};
}

function updateBridgeLight(dt, warpGlow) {
  const warpLevel = warp ? Math.sin(Math.PI * (audioWarp ?? 0)) : warpGlow;
  const hazardLevel = Number(safeBridgeEvents.has(event?.type));
  function approachLight(value, target) {
    if (Math.abs(value-target) < .01) return target;
    return value + (target-value)*Math.min(1, dt*4);
  }
  bridgeWarp = reduced ? 0 : approachLight(bridgeWarp, warpLevel);
  bridgeAlert = reduced ? hazardLevel : approachLight(bridgeAlert, hazardLevel);
}

$('bridgeAction').onclick = interactBridge;
$('bridgeLights').onclick = () => {
  nightBridge = !nightBridge;
  $('bridgeLights').setAttribute('aria-pressed', String(nightBridge));
  $('bridgeLights').textContent = nightBridge ? '야간 조명' : '일반 조명';
};
$('bridgeVolume').oninput = updateAudio;
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
  if (event) {
    const context=event.type==='moonTransit' ? eventContext() : null;
    const projection=context?.moonPosition ? (...world)=>{
      const eye=flight.state?.position ?? AsteriaSpace.cameraPoint(sectorScene(),approach,orbit);
      return project(...world.map((value,i)=>value-eye[i]));
    } : project;
    AsteriaEvents.draw(context ? {...event,position:context.moonPosition} : event,elapsed,
      {ctx,width:w,height:h,project:projection,reduced});
  }
  const drone = marie.droneView();
  if (drone) {
    const t = reduced ? .82 : drone.progress;
    const point = project(.55+t*1.30,.12+t*.69,2.7+t*4.8);
    if (point) {
      const [x,y,depth] = point, r = clamp(focal*.073/depth,3,14);
      ctx.fillStyle='#a5ede6';
      ctx.beginPath();
      ctx.moveTo(x-r*1.55,y+r*.43);
      ctx.lineTo(x,y-r*.7);
      ctx.lineTo(x+r*1.55,y+r*.43);
      ctx.lineTo(x,y+r*.20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle='#edfffb';
      ctx.fillRect(x-r*.17,y-r*.15,r*.34,r*.45);
    }
  }
}
function drawRadar(t){let r=radar;r.clearRect(0,0,160,160);r.save();r.translate(80,80);r.strokeStyle='#305166';r.lineWidth=1;for(let i=1;i<=4;i++){r.beginPath();r.arc(0,0,i*17,0,7);r.stroke();}r.beginPath();r.moveTo(-68,0);r.lineTo(68,0);r.moveTo(0,-68);r.lineTo(0,68);r.stroke();let a=t*.9;let g=r.createRadialGradient(0,0,0,0,0,68);g.addColorStop(0,'#6deeea00');g.addColorStop(1,'#6deeea15');r.fillStyle=g;r.beginPath();r.moveTo(0,0);r.arc(0,0,68,a-.65,a);r.closePath();r.fill();r.strokeStyle='#69e3df';r.beginPath();r.moveTo(0,0);r.lineTo(Math.cos(a)*68,Math.sin(a)*68);r.stroke();for(let i=0;i<5;i++){let angle=i*2.5+dest*.4-yaw*rad,dist=17+i*10;r.fillStyle=event&&i===0?'#ffbf76':'#79e2dc';r.beginPath();r.arc(Math.cos(angle)*dist,Math.sin(angle)*dist,i===0?3:1.8,0,7);r.fill();}r.fillStyle='#d8ffff';r.fillRect(-2,-2,4,4);r.restore();}
function updateSpeed(wa = 0) {
  $('throttlePct').textContent = Math.round(throttle) + '%';
  $('power').textContent = Math.round(throttle) + '%';
  $('powerBar').style.width = throttle + '%';
  $('speedRead').textContent = wa > .2 ? (1 + wa*8).toFixed(2) : (throttle*.0068).toFixed(2);
}

function sectorScene() {
  return activeFlightScene ?? AsteriaSpace.scenes[destinations[dest][0]];
}
function localBodies() {
  const scene=sectorScene();
  return scene ? AsteriaSpace.flightBodies(scene,reduced ? 0 : elapsed) : [];
}
function neutralFlightInput() {
  flightKeys.clear();
  sticks.rotation=[0,0];
  sticks.translation=[0,0];
  for (const element of document.querySelectorAll('[data-stick]')) {
    element.style.removeProperty('--stick-x');
    element.style.removeProperty('--stick-y');
  }
}
function setPilot(on) {
  if (on===!!flight.state) return;
  if (on && (!ready || !renderer.sky.geometry || warp || loading)) return;
  if (on) {
    setWalking(false);
    setCinema(false);
    setAuto(false);
    stopRoute();
    const point=AsteriaSpace.cameraPoint(sectorScene(),approach,orbit);
    flight.begin(destinations[dest][0],point,AsteriaBridge.orientation(yaw*rad,pitch*rad,roll*rad),localBodies());
    flightRecovery='';
  } else {
    flight.stop();
    navigationMap.flightStatus('IDLE',dest,false);
  }
  independentView=null;
  keys.clear();
  neutralFlightInput();
  cameraDirty=true;
  revision++;
  updateWalkControls();
  updateRouteControls();
}
function flightControls(dt) {
  const state=flight.state;
  if (!state || document.hidden) return;
  const axis=(a,b)=>Number(flightKeys.has(a))-Number(flightKeys.has(b));
  const rotation=[axis('s','w')+sticks.rotation[1],axis('d','a')+sticks.rotation[0],axis('e','q')];
  const translation=[axis('l','j')+sticks.translation[0],axis('u','o'),axis('i','k')-sticks.translation[1]];
  const throttle=axis('shift','control'), brake=flightKeys.has(' ');
  const manual=rotation.some(Boolean)||translation.some(Boolean)||throttle||brake;
  if (manual) {
    if (flightTravel) cancelFlightTravel();
    if (!loading && !warp && flightRecovery) flightRecovery='';
  }
  if (loading || warp) return;
  const bodies=localBodies();
  if (flightTravel?.phase==='ALIGN') {
    // Map axes are fictional. This is a local forward alignment before the existing warp transition.
    const basis=AsteriaBridge.matrix(state.orientation);
    rotation[0]=-Math.atan2(basis[5],basis[8])*2;
    rotation[1]=-Math.atan2(basis[6],basis[8])*2;
    rotation[2]=-Math.atan2(basis[1],basis[0])*2;
    if (Math.hypot(...rotation)<.12 || flightTravel.deadline<=performance.now()) {
      const plan=flightTravel;
      plan.phase='LOAD';
      void engage(plan.target,null,plan);
    }
  }
  flight.advance(dt,{rotation,translation,throttle,brake},bodies,
    point=>AsteriaSpace.nearRing(sectorScene(),0,0,point));
  cameraDirty=true;
}
function updateFlightHud() {
  const state=flight.state, plan=flightTravel;
  if (!state && !plan) return;
  const value=state ? state.position.map(n=>n.toFixed(2)).join(' / ') : '—';
  const speed=state ? Math.hypot(...state.velocity).toFixed(2) : '0.00';
  const coordinates=state ? state.sectorId.toUpperCase()+' · '+value+' SU' : value;
  const readout=coordinates+' · '+speed+' SU/s'+(state ? ' · 추력 '+Math.round(state.throttle*100)+'%' : '');
  if ($('flightReadout').textContent!==readout) $('flightReadout').textContent=readout;
  const phase=plan?.phase ?? state?.assist ?? 'IDLE';
  const ring=state && AsteriaSpace.nearRing(sectorScene(),0,0,state.position);
  const guidance=state?.hazard || flightRecovery || (flightStatusNames[phase]+(ring?' · 고리 파편 감속':''));
  if ($('flightGuidance').textContent!==guidance) $('flightGuidance').textContent=guidance;
  $('flightAssist').value=state?.assist ?? 'IDLE';
  $('flightAssist').disabled=!state || !!plan;
  $('flightCamera').disabled=!state || !!plan;
  $('flightCamera').textContent=independentView ? '독립 시점' : '기수 시점';
  $('flightCamera').setAttribute('aria-pressed',String(!!independentView));
  $('flightNavigate').disabled=!!warp || (!plan && (loading || Number($('destinationSelect').value)===dest));
  $('flightNavigate').textContent=warp ? '워프 진행 중' : plan ? '자동 항법 취소' : '목적지 자동 항법';
  $('flightExit').disabled=!!warp;
  navigationMap.flightStatus(phase,plan?.target ?? dest,ring,state?.position);
}

function recoverFlightTravel(plan, cancelled) {
  if (flightTravel!==plan) return;
  plan.phase=cancelled ? 'ABORT' : 'RECOVER';
  if (flight.state?.sectorId===plan.sectorId) {
    flight.state.orientation=plan.orientation;
    flight.brake();
    cameraDirty=true;
  }
  flightTravel=null;
  flightRecovery=cancelled ? '출항 취소 · 현재 구역 유지' : '항로 복구 · 현재 구역 유지';
  updateWalkControls();
}

function cancelFlightTravel() {
  if (!flightTravel || warp) return;
  if (flightTravel.phase==='LOAD') assetRequest?.abort();
  recoverFlightTravel(flightTravel,true);
}
function startFlightTravel() {
  if (flightTravel) {cancelFlightTravel();return;}
  const target=Number($('destinationSelect').value);
  if (!flight.state || loading || warp || target===dest) return;
  flightRecovery='';
  flight.assist('IDLE');
  flight.brake();
  flightTravel={phase:'PLAN',target,deadline:performance.now()+1400,
    sectorId:flight.state.sectorId,orientation:[...flight.state.orientation]};
  updateWalkControls();
}
function enterFlight() {
  if (flightTravel) cancelFlightTravel();
  else setPilot(!flight.state);
  if (flight.state) $('view').focus({preventScroll:true});
}
$('flightToggle').onclick=enterFlight;
$('flightExit').onclick=enterFlight;
$('flightNavigate').onclick=startFlightTravel;
$('flightCamera').onclick=()=>{
  if (!flight.state) return;
  independentView=independentView ? null : [...flight.state.orientation];
  cameraDirty=true;
  $('view').focus({preventScroll:true});
};
$('flightAssist').onchange=event=>{
  flightRecovery='';
  flight.assist(event.target.value);
  $('view').focus({preventScroll:true});
};
for (const stick of document.querySelectorAll('[data-stick]')) {
  let pointer=null;
  function move(event) {
    if (event.pointerId!==pointer) return;
    const rect=stick.getBoundingClientRect(), radius=rect.width*.36;
    const x=clamp((event.clientX-(rect.left+rect.width/2))/radius,-1,1);
    const y=clamp((event.clientY-(rect.top+rect.height/2))/radius,-1,1);
    sticks[stick.dataset.stick]=[x,y];
    stick.style.setProperty('--stick-x',x*radius+'px');
    stick.style.setProperty('--stick-y',y*radius+'px');
  }
  stick.onpointerdown=event=>{
    if (pointer!==null) return;
    pointer=event.pointerId;
    stick.setPointerCapture(pointer);
    move(event);
  };
  stick.onpointermove=move;
  stick.onlostpointercapture=()=>{
    pointer=null;
    sticks[stick.dataset.stick]=[0,0];
    stick.style.removeProperty('--stick-x');
    stick.style.removeProperty('--stick-y');
  };
}
for (const button of document.querySelectorAll('[data-flight-key]')) {
  const key=button.dataset.flightKey;
  button.onpointerdown=event=>{button.setPointerCapture(event.pointerId);flightKeys.add(key);};
  button.onlostpointercapture=()=>flightKeys.delete(key);
  button.onclick=event=>{
    if (event.detail===0 && flight.state && key===' ') {
      flight.assist('IDLE');
      flight.brake();
    }
  };
}
function setTravelBusy(busy) {
  commandEpoch++;
  navigationMap.setBusy(busy);
  $('warp').disabled = $('travel').disabled = $('destinationSelect').disabled = busy;
  $('qualitySelect').disabled = $('qualityRetry').disabled = busy;
  $('cancelAssets').hidden = !assetRequest;
  updateWalkControls();
  updateRouteControls();
  updateWatchControls();
  persistence.refresh();
}

async function engage(n = null, session = null, plan = null) {
  if (warp || loading) return;
  if (!ready) {
    notify('초기 우주 에셋 준비 중입니다.');
    return;
  }
  setWalking(false);
  if (!plan) {
    cancelFlightTravel();
    setPilot(false);
  }
  loading = true;
  const request = new AbortController();
  assetRequest = request;
  stopRoute();
  setTravelBusy(true);
  $('flightStatus').textContent = '항로 계산 중';
  if (n !== null) marie.plan(n);
  try {
    const images = n !== null && n !== dest ? await loadSky(n, '', request.signal) : null;
    if (request.signal.aborted || (plan && flightTravel!==plan) || (session && watch !== session)) return;
    if (event) endEvent();
    if (plan) {
      plan.phase='WARP';
      setPilot(false);
    }
    warp = {start: performance.now(), next: n, changed: false, images, plan,
      watch:session,leg:session?.pendingLeg};
    journal('departure');
    audioWarp = 0;
    navigationMap.begin(n);
    marie.depart(n);
    $('warp').classList.add('engaged');
    $('warp').querySelector('b').textContent = '워프 진행 중';
    $('flightStatus').textContent = '워프 항해 중';
    $('modeLabel').textContent = 'WARP DRIVE';
    if (!watch) notify(n === null ? '워프 드라이브 가동' : destinations[n][1] + ' 항로 설정 · 워프 개시');
  } catch {
    if (!request.signal.aborted && (!session || watch === session)) {
      const message = navigator.onLine ? '목적지 이미지 로드 실패. 현재 구역 유지.'
        : '오프라인에 없는 구역입니다. 현재 구역을 유지합니다.';
      if (session) {
        session.failures++;
        session.remaining=1.5;
        if (session.failures>=2) session.paused=true;
        updateAudio();
      }
      navigationMap.fail(message);
      marie.failed();
      notify(message);
      request.abort();
    }
  } finally {
    loading = false;
    assetRequest = null;
    setTravelBusy(!!warp);
    if (!warp) {
      $('flightStatus').textContent = '순항 항해 중';
      if (plan) recoverFlightTravel(plan,false);
    }
  }
}

function advanceWarp(now) {
  if (!warp) return 0;
  const p = clamp((now - warp.start) / 3800, 0, 1);
  audioWarp = p;
  navigationMap.progress(p);
  if (p > .48 && !warp.changed) {
    warp.changed = true;
    if (warp.next !== null) setDest(warp.next, warp.images);
    warp.images = null;
    reset();
  }
  if (p < 1) return reduced ? 0 : clamp(Math.min(p*5, (1-p)*4), 0, 1);

  const {plan,watch:session,leg}=warp;
  warp = null;
  audioWarp = null;
  navigationMap.arrive(dest);
  marie.arrive(dest);
  journal('arrival');
  if (session && watch===session && leg) settleObservation(session,leg);
  if (plan && plan===flightTravel) {
    plan.phase='ARRIVE';
    flightTravel=null;
    setPilot(true);
    if (flight.state) flight.assist('APPROACH');
  }
  setTravelBusy(false);
  $('warp').classList.remove('engaged');
  $('warp').querySelector('b').textContent = '워프 항해';
  $('flightStatus').textContent = '순항 항해 중';
  $('modeLabel').textContent = 'SUBLIGHT DRIVE';
  if (!watch) notify('워프 종료 · 관측 구역 도착');
  return 0;
}

function eventContext() {
  const [id, , , , group] = destinations[dest];
  const scene = sectorScene();
  const deep = group === 'deep' || id === 'deep' || id === 'nebula';
  const world = group === 'world' || ['nereid', 'selene', 'eos', 'gaia'].includes(id);
  const star = group === 'star' || id === 'solaris';
  const time = reduced ? 0 : elapsed;
  const sample = scene && renderer.sky.geometry ? AsteriaSpace.sample(scene,time,approach,orbit) : null;
  const eye = flight.state?.position ?? sample?.eye;
  const alignment = sample && world ? AsteriaSpace.alignments(scene,time,eye) : null;
  const primary=flight.state && star ? localBodies()[0] : null;
  const nearStar=primary ? Math.hypot(...eye.map((value,i)=>value-primary.center[i])) < primary.radius+6 : approach>=.55;
  return {
    id, deep, world, alignment, nearStar:star && !!sample && nearStar,
    moon: world && !!scene?.moon, star,
    moonPosition: sample && scene.moon ? Array.from(sample.spheres.slice(4,7)) : null,
    pulsar:['hush','undertow'].includes(id), nebula:['nebula','hush','eirene','velaris'].includes(id),
    station:['halogate','silentarray'].includes(id),
    belt: !!scene?.belt,
    relic: group === 'relic',
    portal: id === 'halogate' || id === 'palimpsest',
    ring: !!(scene && renderer.sky.geometry && AsteriaSpace.nearRing(scene, approach, orbit,flight.state?.position)),
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
  commandEpoch++;
  const hadFocus = $('eventBanner').contains(document.activeElement);
  event = null;
  marie.event(null);
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
  commandEpoch++;
  journal('event',destinations[dest][0],type);
  marie.event(type);
  const entry = events[type];
  $('eventName').textContent = entry.name;
  $('eventDescription').textContent = entry.description;
  $('eventAction').textContent = entry.action[0];
  $('eventAction').hidden = false;
  $('eventTime').textContent = entry.seconds + '초';
  $('eventBanner').hidden = false;
  $('environment').textContent = entry.code;
  notify(entry.name + ' · 관측 상황 개시');
  if (!watch && ['signal', 'distress', 'flyby'].includes(type)) soundscape.cue('contact');
}

for (const [type, entry] of Object.entries(events)) {
  $('eventSelect').append(new Option(entry.name, type));
}

$('eventAction').onclick = () => {
  const next = AsteriaEvents.respond(event, elapsed);
  if (!next || next === event) return;
  event = next;
  if (flight.state && ['asteroid','ring','stellarFlare','docking'].includes(event.type)) {
    flight.assist(event.type==='docking' ? 'OBSERVE' : 'IDLE');
    if (event.type!=='docking') flight.brake();
  }
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
  const key = [context.id,context.ring,context.nearStar].join('/');
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
  if (!random || event || warp || loading || watch) return;
  if (enteredRing || elapsed >= nextEvent) {
    const available = Object.keys(events).filter(type=>AsteriaEvents.eligible(type,context)
      && (eventCooldown.get(context.id+'/'+type) ?? 0)<=elapsed);
    const aligned = {sunrise:context.alignment?.horizon,sunset:context.alignment?.horizon,
      eclipse:context.alignment?.eclipse,moonTransit:context.alignment?.transit};
    const preferred = available.filter(type=>aligned[type]);
    const candidates = preferred.length ? preferred : available.filter(type=>!Object.hasOwn(aligned,type) || aligned[type]);
    const type = enteredRing ? 'ring' : candidates[Math.floor(Math.random()*candidates.length)];
    if (type) {
      startEvent(type, context);
      eventCooldown.set(context.id+'/'+type,elapsed+events[type].seconds+45);
    }
    nextEvent = elapsed + 30 + Math.random() * 30;
  }
}
$('travel').onclick=()=>engage(+$('destinationSelect').value);$('warp').onclick=()=>engage();$('speed').oninput=e=>{throttle=+e.target.value;updateSpeed();updateAudio();};$('autopilot').onclick=()=>{if(tour)stopRoute();cancelFlightTravel();setPilot(false);setWalking(false);setAuto(!auto);};$('walkToggle').onclick=()=>{setWalking(!walking);$('view').focus({preventScroll:true});};$('reset').onclick=reset;$('cinema').onclick=()=>setCinema(true);$('exitCinema').onclick=()=>setCinema(false);$('roomToggle').onclick=()=>setRoom(!room);$('eventBtn').onclick=()=>startEvent($('eventSelect').value);$('randomEvent').onclick=()=>{random=!random;nextEvent=elapsed+6;$('randomEvent').textContent='자동 상황 '+(random?'ON':'OFF');$('randomEvent').setAttribute('aria-pressed',String(random));};$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('전체 화면을 지원하지 않거나 차단되었습니다.');}};
$('sound').onclick = $('watchSound').onclick = toggleSound;
$('watchStart').onclick=()=>startWatch();
$('watchNext').onclick=()=>{
  if (!watch) return;
  if (watch.paused && watch.failures>=2 && watch.pendingLeg) {
    AsteriaWatch.arrive(watch,watch.pendingLeg);
    watch.pendingLeg=null;
  }
  watch.paused=false;
  watch.remaining=0;
  watch.skipFrame=true;
  updateWatchControls();
  updateAudio();
};
$('watchPause').onclick=()=>{
  if (!watch) return;
  watch.paused=!watch.paused;
  if (watch.paused && loading && watch.pendingLeg) assetRequest?.abort();
  if (!watch.paused) {watch.failures=0;watch.skipFrame=true;}
  updateWatchControls();
  updateAudio();
};
const view=$('view');view.addEventListener('pointerdown',e=>{if(e.button!==0)return;setAuto(false);view.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,id:e.pointerId};view.setPointerCapture(e.pointerId);});view.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;turnView(-(e.clientX-drag.x)*.19,(e.clientY-drag.y)*.19);drag.x=e.clientX;drag.y=e.clientY;});for(let ev of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(ev,()=>drag=null);view.addEventListener('dblclick',reset);view.addEventListener('wheel',e=>{e.preventDefault();zoomBy(-Math.sign(e.deltaY)*.08);},{passive:false});
const map={arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d'}, editable=el=>el&&['INPUT','SELECT','TEXTAREA'].includes(el.tagName);
window.addEventListener('keydown', e => {
  if ($('mapDialog').open || $('marieDialog').open || $('commandDialog').open || $('qualityDialog').open || $('voyageDialog').open) return;
  if (e.key==='Escape' && flightTravel) {
    cancelFlightTravel();
    return;
  }
  if (e.key === 'Escape' && assetRequest && !cinema) {
    assetRequest.abort();
    return;
  }
  if (e.key === 'Escape') {
    if (cinema) setCinema(false);
    if (flight.state) setPilot(false);
    if (walking) setWalking(false);
    keys.clear();
    return;
  }
  if ($('helpDialog').open || editable(document.activeElement) || e.metaKey || e.altKey) return;
  const k = map[e.key.toLowerCase()] || e.key.toLowerCase();
  if (k==='p' && !e.ctrlKey && !e.repeat) {
    e.preventDefault();
    enterFlight();
    return;
  }
  if (flight.state && flightKeyNames.has(k) && (!e.ctrlKey || k==='control')) {
    e.preventDefault();
    flightKeys.add(k);
    return;
  }
  if (e.ctrlKey) return;
  const vertical = walking && [' ', 'shift'].includes(k) && document.activeElement === view;
  if ((k.length === 1 && 'wasdqe'.includes(k)) || vertical) {
    e.preventDefault();
    keys.add(k);
    if (auto) setAuto(false);
  } else if (!e.repeat) {
    if (k === 'f' && walking) { e.preventDefault(); interactBridge(); }
    else if (k === 'r') reset();
    else if (k === 'c') setCinema(!cinema);
    else if (k === 'v') {
      setWalking(!walking);
      if (walking) view.focus({preventScroll:true});
    }
    else if (k === '+' || k === '=') zoomBy(.1);
    else if (k === '-') zoomBy(-.1);
  }
});
window.addEventListener('keyup',e=>{
  const key=map[e.key.toLowerCase()]||e.key.toLowerCase();
  keys.delete(key);
  flightKeys.delete(key);
});
window.addEventListener('blur',()=>{keys.clear();neutralFlightInput();drag=null;});
document.addEventListener('visibilitychange', () => {
  if (watch) watch.skipFrame = true;
  crewClockReset = true;
  if (document.hidden) {
    keys.clear();
    neutralFlightInput();
    flight.brake();
    resetQualitySamples();
  }
  updateAudio();
});
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
if (flightTravel?.phase==='PLAN') flightTravel.phase='ALIGN';
if (flight.state) {
  flightControls(dt);
} else if (walking) {
  turnView(0, 0, bank);
  updateCamera();
  moveInside(dt);
} else {
  const automatic = reduced || drag ? 0 : watch ? 1.2*dt : auto ? 9*dt : 0;
  turnView(step*(Number(keys.has('d')) - Number(keys.has('a'))) + automatic,
    step*(Number(keys.has('w')) - Number(keys.has('s'))), bank);
}
const wasWarping = !!warp;
const wa = advanceWarp(now);
if (wasWarping) updateSpeed(wa);
$('warpGlow').style.opacity = wa * .8;
if (!wasWarping) advanceWatch(clamp(frameMs / 1000, 0, 1));
updateHatch(dt);
updateBridgeLight(dt, wa);
advanceAudio(now);
advanceTour(dt);updateCamera();advanceRoute(dt);updateEvents();if (ready && !document.hidden) {
  marie.advance(crewClockReset ? 0 : clamp(frameMs / 1000, 0, 1),
    {walking, eye:walkPosition, hatch:hatchSlide, loading});
  crewClockReset = false;
}
updateFlightHud();
commandCenter.sync();
renderCamera(now,frameMs);effectFrame(dt,wa);drawRadar(elapsed);const displayYaw = walking || flight.state ? Math.atan2(cameraMatrix[6],cameraMatrix[8])/rad : yaw;
const displayPitch = walking || flight.state ? Math.asin(clamp(cameraMatrix[7],-1,1))/rad : pitch;
const displayRoll = walking || flight.state ? Math.atan2(cameraMatrix[1],cameraMatrix[4])/rad : roll;
let bearing=(displayYaw+360)%360;$('heading').textContent=bearing.toFixed(1).padStart(5,'0')+'°';$('pitchRead').textContent=(displayPitch>=0?'+':'')+displayPitch.toFixed(1)+'°';$('rollRead').textContent=(displayRoll>=0?'+':'')+displayRoll.toFixed(1)+'°';$('compassText').textContent=['FWD','STBD','AFT','PORT'][Math.round(bearing/90)%4]+' · '+Math.round(bearing).toString().padStart(3,'0')+'°';let sec=Math.floor(Date.now()/1000);if(sec!==clockSec){clockSec=sec;$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC';}updateQualityHud(now,frameMs);requestAnimationFrame(frame);}
function updateQualityHud(now, frameMs) {
  if (frameMs > 0 && frameMs < 200 && !document.hidden) {
    displayFps += (1000 / frameMs - displayFps)*.06;
  }
  if (!$('qualityDialog').open || now - hudUpdatedAt < 300) return;
  hudUpdatedAt = now;
  const {tier, width, reason} = activeQuality ?? {};
  const sky = $('skyView');
  $('qualityApplied').textContent = qualityNames[tier] ?? '준비 중';
  $('qualityAssetSize').textContent = width ? width + ' px / 면' : '기존 파노라마';
  $('qualityResolution').textContent = `${sky.width} × ${sky.height}`;
  $('qualityFps').textContent = displayFps ? Math.round(displayFps) + ' fps' : '측정 중';
  $('qualityTextures').textContent = (renderer.sky.textureCount ?? 0) + (renderer.room.textureCount ?? 0);
  $('qualityReason').textContent = loading ? '에셋 로드 중'
    : reason || (qualityMode === 'auto' ? '프레임 시간에 맞춰 렌더 해상도 조정 중' : '선택 품질 적용');
}

$('qualityOpen').onclick = () => {
  keys.clear();
  neutralFlightInput();
  $('qualityDialog').showModal();
  hudUpdatedAt = -Infinity;
  updateQualityHud(performance.now(), 0);
};
$('qualityClose').onclick = () => $('qualityDialog').close();
$('cancelAssets').onclick = () => assetRequest?.abort();
async function applyQuality(desired, retry = '') {
  if (loading || warp || !ready || !Object.hasOwn(qualityNames, desired)) return;
  if (!retry && desired === qualityMode) return;
  const request = new AbortController();
  assetRequest = request;
  loading = true;
  setTravelBusy(true);
  try {
    const sky = await loadSky(dest, retry, request.signal, desired);
    if (request.signal.aborted) return;
    qualityMode = desired;
    renderLimit = 1080;
    uploadSky(sky);
  } catch (error) {
    if (!request.signal.aborted) {
      notify('품질 변경 실패. 현재 화면을 유지합니다.');
      request.abort();
    }
  } finally {
    $('qualitySelect').value = qualityMode;
    assetRequest = null;
    loading = false;
    setTravelBusy(false);
  }
}
$('qualitySelect').onchange = event => void applyQuality(event.target.value);
$('qualityRetry').onclick = () => void applyQuality(qualityMode, '?retry=' + Date.now());

window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(layoutControls).observe(document.querySelector('.console'));resize();updateSpeed();requestAnimationFrame(frame);
})();
