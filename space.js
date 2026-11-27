'use strict';

const AsteriaSpace = (() => {
  const center = [0.12, 0.18, 9.5];
  const scenes = {
    nereid: {
      surface: 'gas', radius: 2.65, spin: 0.036, atmosphere: [0.53, 0.69, 1],
      ring: { normal: [0.20, 0.94, 0.27], inner: 3.25, outer: 5.35 },
      moon: { distance: 5.9, radius: 0.6, speed: 0.06 },
      route: [[-1, -0.25, -5], [2.9, 1.35, 8]],
    },
    selene: {
      surface: 'ice', radius: 2.5, spin: 0.025, atmosphere: [0.30, 0.68, 0.95],
      moon: { distance: 4.55, radius: 0.45, speed: 0.055 },
    },
    eos: { surface: 'rock', radius: 2.55, spin: 0.03, atmosphere: [0.92, 0.32, 0.12] },
    gaia: {
      surface: 'earth', radius: 2.65, spin: 0.032, atmosphere: [0.19, 0.52, 1],
      moon: { distance: 4.95, radius: 0.56, speed: 0.064 },
    },
    solaris: { surface: 'star', radius: 2.8, spin: 0.04, atmosphere: [1, 0.39, 0.065], emissive: true },
    singularity: {
      radius: 0.88, blackHole: true,
      ring: { normal: [-0.17, 0.94, 0.31], inner: 1.10, outer: 3.5 },
    },
    belt: { surface: 'rock', belt: true, route: [[-1, 0, -5], [1.5, 0.45, 4.4]] },
  };
  for (const {id, scene} of AsteriaSectors.additions) scenes[id] = scene;
  const defaultRoute = [[-1, 0, -5], [1.3, 0.45, 4.2]];
  const bodyCount = 8;

  function sample(scene, elapsed, approach, orbit = 0) {
    const spheres = new Float32Array(bodyCount * 4);
    const put = (index, x, y, z, radius) => spheres.set([x, y, z, radius], index * 4);
    if (scene.radius) put(0, ...center, scene.radius);
    if (scene.moon) {
      const { distance, radius, speed } = scene.moon;
      const angle = -0.38 + elapsed * speed;
      put(1, center[0] + Math.cos(angle) * distance, center[1] + 0.72 * Math.sin(angle),
        center[2] + Math.sin(angle) * distance, radius);
    }
    if (scene.belt) {
      const [offset, width, spread, spacing] = scene.swarm ?? [0, 2.7, 1.65, 1.74];
      for (let i = 0; i < bodyCount; i++) {
        const phase = offset + i * 2.39996 + elapsed * (0.05 + 0.008 * i);
        put(i, Math.cos(phase) * (width + i * 0.43), Math.sin(phase) * spread,
          6.3 + i * spacing + Math.sin(phase) * 0.8, 0.26 + (i % 4) * 0.19);
      }
    }
    return {spheres, eye: cameraPoint(scene, approach, orbit), spin: elapsed * (scene.spin ?? 0.08)};
  }

  function cameraPoint(scene, approach, orbit) {
    const [far, near] = scene.route ?? defaultRoute;
    const [x, y, z] = far.map((value, axis) => value + (near[axis] - value) * approach);
    const dx = x - center[0], dz = z - center[2];
    const c = Math.cos(orbit), s = Math.sin(orbit);
    return [center[0] + c*dx + s*dz, y, center[2] - s*dx + c*dz];
  }

  function nearRing(scene, approach, orbit) {
    const {ring} = scene;
    if (!ring || scene.structure || scene.blackHole) return false;
    const point = cameraPoint(scene, approach, orbit);
    const delta = point.map((value, axis) => value - center[axis]);
    const normalLength = Math.hypot(...ring.normal);
    const plane = delta.reduce((sum, value, axis) => sum + value * ring.normal[axis], 0) / normalLength;
    const radial = Math.sqrt(Math.max(0, delta.reduce((sum, value) => sum + value * value, 0) - plane * plane));
    return Math.abs(plane) <= .32 && radial >= ring.inner && radial <= ring.outer;
  }

  function lookAtRoute(scene, approach, orbit) {
    const eye = cameraPoint(scene, approach, orbit);
    const [x, y, z] = center.map((value, axis) => value - eye[axis]);
    return [Math.atan2(x, z), Math.atan2(y, Math.hypot(x, z))];
  }

  function surfaceDistance(scene, { spheres, eye }) {
    let distance = Infinity;
    const count = scene.belt ? bodyCount : 1;
    for (let i = 0; i < count * 4; i += 4) {
      const radius = spheres[i + 3];
      if (radius <= 0) continue;
      const centerDistance = Math.hypot(eye[0] - spheres[i], eye[1] - spheres[i + 1], eye[2] - spheres[i + 2]);
      distance = Math.min(distance, centerDistance - radius);
    }
    return Math.max(0, distance);
  }

  const fragment = `
precision highp float;
varying vec2 uv;
uniform vec2 scale;
uniform mat3 rot;
uniform samplerCube cube;
uniform sampler2D surface;
uniform vec4 bodies[${bodyCount}];
uniform vec3 eye;
uniform float spin;
uniform vec3 atmosphere;
uniform vec4 ring;
uniform float ringInner;
uniform int kind;
uniform vec3 tint;
uniform vec3 skyTone;
uniform float structureStyle;
uniform vec3 keyLight;
uniform float oceanWorld;
uniform float cloudTime;
uniform vec2 presentation;

const float PI = 3.14159265;
const float FAR = 10000.0;

vec2 sphereRoots(vec3 origin, vec3 ray, vec3 center, float radius) {
  vec3 offset = origin - center;
  float b = dot(offset, ray);
  float disc = b*b - dot(offset, offset) + radius*radius;
  if (disc < 0.0) return vec2(FAR, -1.0);
  float h = sqrt(disc);
  return vec2(-b-h, -b+h);
}

float hitSphere(vec3 origin, vec3 ray, vec4 body) {
  if (body.w <= 0.0) return FAR;
  vec2 roots = sphereRoots(origin, ray, body.xyz, body.w);
  if (roots.x > 0.001) return roots.x;
  return roots.y > 0.001 ? roots.y : FAR;
}

float hitBelt(vec3 origin, vec3 ray, vec4 body) {
  vec3 aspect = vec3(.82, 1.19 + .13*sin(body.z*2.13), .94 + .12*cos(body.x*2.6));
  vec3 p = (origin - body.xyz) * aspect;
  vec3 d = ray * aspect;
  float a = dot(d,d), b = dot(p,d);
  float disc = b*b - a*(dot(p,p) - body.w*body.w);
  if (disc < 0.0) return FAR;
  float q = (-b-sqrt(disc))/a;
  return q > .001 ? q : FAR;
}

// Low-cost shading functions use the same direction space on both sides of the longitude seam.
float surfaceDetail(vec3 n) {
  return .55*sin(dot(n,vec3(51.,47.,-44.))) + .3*sin(dot(n,vec3(-113.,129.,105.)))
    + .15*cos(dot(n,vec3(209.,-241.,181.)));
}
float cloudCover(vec3 n) {
  float a = cloudTime*.027;
  vec3 m = vec3(cos(a)*n.x+sin(a)*n.z,n.y,cos(a)*n.z-sin(a)*n.x);
  float cloud = sin(dot(m,vec3(8.1,13.5,-6.2))) + .5*sin(dot(m,vec3(-18.3,26.3,11.)));
  return smoothstep(.42,1.2,cloud + .22*surfaceDetail(m))*smoothstep(.02,.24,1.0-abs(m.y));
}

float ringHit(vec3 origin, vec3 ray) {
  if (ring.w == 0.0) return FAR;
  float tilt = dot(ray, ring.xyz);
  if (abs(tilt) < 0.0001) return FAR;
  vec3 offset = origin - bodies[0].xyz;
  float depth = -dot(offset, ring.xyz) / tilt;
  float radius = length(offset + depth * ray);
  if (depth <= 0.001 || radius < ringInner || radius > ring.w) return FAR;
  return depth;
}

float ringBands(float radius) {
  float x = (radius - ringInner) / (ring.w - ringInner);
  return smoothstep(0.0, 0.035, x) * (1.0 - smoothstep(0.88, 1.0, x))
    * (0.56 + 0.16*sin(x*122.0) + 0.12*sin(x*47.0))
    * (0.20 + 0.80*smoothstep(0.018, 0.039, abs(x-0.66)));
}

vec3 surfaceColor(vec3 n, float angle) {
  float u = fract(0.5 + atan(n.z, n.x) / (2.0*PI) + angle/(2.0*PI));
  float v = 0.5 - asin(clamp(n.y, -1.0, 1.0))/PI;
  return texture2D(surface, vec2(u, v)).rgb;
}

void main() {
  vec3 ray = normalize(rot * vec3(uv * scale, 1.0));
  float nearest = FAR;
  int index = -1;
  vec4 body = vec4(0.0);
  for (int i = 0; i < ${bodyCount}; i++) {
    float depth = kind == 3 ? hitBelt(eye, ray, bodies[i]) : hitSphere(eye, ray, bodies[i]);
    if (depth < nearest) {
      nearest = depth;
      index = i;
      body = bodies[i];
    }
  }

  if (kind == 4) {
    vec3 u = normalize(cross(ring.xyz,vec3(1.,0.,0.)));
    vec3 v = cross(ring.xyz,u);
    for (int i = 0; i < 5; i++) {
      float angle = float(i)*1.25664+structureStyle*.57;
      float span = ring.w*(.59+.12*sin(float(i)*2.0+structureStyle));
      float elevation = .16 + .08*structureStyle;
      vec3 center = bodies[0].xyz + span*(u*cos(angle)+v*sin(angle)) +
        ring.xyz*elevation*cos(angle*2.0);
      vec4 module = vec4(center,.17+.04*structureStyle+.045*sin(angle*3.0));
      float d = hitSphere(eye,ray,module);
      if (d < nearest) {
        nearest = d;
        index = 8;
        body = module;
      }
    }
  }

  vec3 skyRay = ray;
  float lensArc = 0.0;
  if (kind == 2) {
    vec3 axis = normalize(bodies[0].xyz - eye);
    float alignment = dot(axis, ray);
    if (alignment > 0.0) {
      vec3 offset = ray - alignment*axis;
      float impact = length(offset) * length(bodies[0].xyz - eye);
      float bend = 0.22 * (1.0-smoothstep(0.8, 5.2, impact)) / max(0.47, impact);
      skyRay = normalize(ray - normalize(offset + vec3(0.00001)) * bend);
      lensArc = exp(-18.0*abs(impact-0.92));
    }
  }
  float backdropCos=cos(presentation.x), backdropSin=sin(presentation.x);
  vec3 viewDir=vec3(backdropCos*skyRay.x+backdropSin*skyRay.z,skyRay.y,backdropCos*skyRay.z-backdropSin*skyRay.x);
  vec3 color=textureCube(cube,viewDir).rgb*skyTone;
  if(presentation.y>.5) color=pow(max(color-vec3(.006),vec3(0.)),vec3(.76));
  color += lensArc * vec3(0.53, 0.24, 0.095);

  if (index >= 0) {
    vec3 point = eye + nearest*ray;
    vec3 n = normalize(point - body.xyz);
    float sunlight = max(dot(n, keyLight), 0.0);
    if (sunlight > 0.0 && kind != 2) {
      vec3 start = point + n*0.003;
      for (int i = 0; i < ${bodyCount}; i++) {
        if (i != index && hitSphere(start, keyLight, bodies[i]) < FAR) sunlight *= 0.12;
      }
      float shadow = ringHit(start, keyLight);
      if (shadow < FAR) sunlight *= 1.0 - 0.75*ringBands(length(start + shadow*keyLight - bodies[0].xyz));
    }
    vec3 albedo = surfaceColor(n, spin + float(index)*1.9) * tint;
    if (kind == 2) {
      color = vec3(0.002, 0.002, 0.004);
    } else if (kind == 1) {
      float granules = surfaceDetail(n);
      float flare = pow(max(0.0, sin(6.*n.x+3.*n.y+cloudTime*.32)), 8.0)*.11;
      color = min(vec3(1.0), albedo*(1.16+.12*granules) + vec3(.25+flare,.06,.008)*tint);
    } else if (kind == 4) {
      float grid = smoothstep(.74, .96, cos(26.0*atan(n.z, n.x))*cos(20.0*n.y));
      color = vec3(.10, .15, .20) * (.64 + sunlight) + tint*(.16 + .61*grid);
    } else {
      if (index != 0 && kind != 3) albedo = vec3(dot(albedo, vec3(0.30, 0.55, 0.15))) * vec3(0.85, 0.85, 0.91);
      float rough = surfaceDetail(n);
      color = albedo * (0.075 + (0.93 + .08*rough)*sunlight);
      if (kind == 3) color *= .84 + .18*rough;
      if (index == 0 && oceanWorld > .5) {
        float ocean = smoothstep(.025,.15,albedo.b-albedo.g);
        float specular = pow(max(0.0,dot(reflect(-keyLight,n),-ray)),72.0)*ocean;
        float clouds = cloudCover(n);
        float night = (1.0-smoothstep(-.32,.04,dot(n,keyLight)))*(1.0-ocean);
        float lights = smoothstep(.70,.95,surfaceDetail(n*7.3))*max(0.0,.63-abs(n.y));
        color += vec3(.59,.75,.88)*specular*.48 + vec3(.91,.53,.21)*night*lights*.24;
        color = mix(color, vec3(.87,.92,1.)*(.11+.83*sunlight),clouds*.53);
      }
      if (index == 0) color += atmosphere * pow(1.0-max(dot(n, -ray), 0.0), 3.0)
        * (0.05 + 0.40*max(dot(n, keyLight)+0.2, 0.0));
    }
  }

  if (length(atmosphere) > 0.0 && index != 0) {
    vec4 planet = bodies[0];
    vec2 shell = sphereRoots(eye, ray, planet.xyz, planet.w * (kind == 1 ? 1.11 : 1.05));
    if (shell.x < nearest && shell.x > 0.0) {
      vec3 n = normalize(eye + shell.x*ray - planet.xyz);
      float daylight = kind == 1 ? 1.0 : max(0.12, dot(n, keyLight)+0.22);
      float density = smoothstep(0.0, planet.w*0.55, min(shell.y, nearest)-shell.x);
      color += atmosphere * density * daylight * (kind == 1 ? 0.72 : 0.46);
    }
  }

  float disk = ringHit(eye, ray);
  if (disk < nearest) {
    vec3 point = eye + disk*ray;
    vec3 offset = point - bodies[0].xyz;
    float radius = length(offset);
    float bands = ringBands(radius);
    if (kind == 2) {
      float heat = 1.0 - (radius - ringInner)/(ring.w - ringInner);
      float flow = sin(11.0*radius + 4.0*atan(offset.z, offset.x) - spin*17.0);
      vec3 light = mix(vec3(0.75, 0.18, 0.055), vec3(1.0, 0.87, 0.64), heat*heat);
      color = mix(color, light*tint*(0.80 + 0.20*flow), smoothstep(0.0, 0.18, bands)*(0.4 + 0.5*heat));
    } else if (kind == 4) {
      vec3 axis = normalize(cross(ring.xyz, vec3(1.0, 0.0, 0.0)));
      float angle = atan(dot(offset, axis), dot(offset, cross(axis, ring.xyz)));
      float radial = (radius - ringInner) / (ring.w - ringInner);
      float rim = step(.39, radial) * (1.0 - step(.54, radial))
        + step(.80, radial) * (1.0 - step(.88, radial));
      float segment = step(.13 + .09*structureStyle, cos(angle*(5.0 + structureStyle)));
      float spoke = step(.94, cos(angle*(6.0 + 2.0*structureStyle)));
      float solid = max(spoke, rim*segment);
      float strips = step(.83, cos(58.0*angle)) * step(.78, radial);
      color = mix(color, vec3(.12, .18, .23) + tint*(.35 + .55*strips), solid);
    } else {
      float light = hitSphere(point + keyLight*0.003, keyLight, bodies[0]) < FAR ? 0.20 : 1.0;
      color = mix(color, mix(vec3(0.63, 0.72, 0.79), vec3(0.91, 0.76, 0.55), bands)*light*tint,
        clamp(bands / (0.42 + abs(dot(ray, ring.xyz))), 0.0, 0.94));
    }
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

  function bind(gl, program, checkTextureUpload) {
    const names = ['surface', 'bodies[0]', 'eye', 'spin', 'atmosphere', 'ring', 'ringInner', 'kind', 'tint', 'skyTone', 'structureStyle', 'keyLight', 'oceanWorld', 'cloudTime', 'presentation'];
    const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
    let texture = null;
    let activeScene = null;

    function clear() {
      if (texture) gl.deleteTexture(texture);
      texture = activeScene = null;
    }

    function upload(image, scene) {
      clear();
      texture = gl.createTexture();
      if (!texture) throw Error('WebGL surface texture allocation failed');
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (image) {
        const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), scene.textureCap ?? 4096);
        let source = image;
        if (image.naturalWidth > max) {
          source = document.createElement('canvas');
          source.width = max;
          source.height = Math.round(image.naturalHeight * max / image.naturalWidth);
          source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 255]));
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      checkTextureUpload(gl, 'surface texture');
      activeScene = scene;
    }

    function draw(elapsed, approach, orbit) {
      const scene = activeScene;
      const position = sample(scene, elapsed, approach, orbit);
      const { spheres, eye, spin } = position;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.surface, 1);
      gl.uniform4fv(uniforms['bodies[0]'], spheres);
      gl.uniform3fv(uniforms.eye, eye);
      gl.uniform1f(uniforms.spin, spin);
      gl.uniform3fv(uniforms.atmosphere, scene.atmosphere ?? [0, 0, 0]);
      const { ring } = scene;
      const normal = ring?.normal ?? [0, 1, 0];
      const length = Math.hypot(...normal);
      gl.uniform4f(uniforms.ring, ...normal.map(value => value / length), ring?.outer ?? 0);
      gl.uniform1f(uniforms.ringInner, ring?.inner ?? 0);
      gl.uniform1i(uniforms.kind, scene.blackHole ? 2 : scene.emissive ? 1 : scene.belt ? 3 : scene.structure ? 4 : 0);
      gl.uniform3fv(uniforms.tint, scene.tint ?? [1, 1, 1]);
      gl.uniform3fv(uniforms.skyTone, scene.newSky ? [1,1,1] : scene.skyTone ?? [1,1,1]);
      const light = scene.keyLight ?? [-.61,.53,-.59];
      const magnitude = Math.hypot(...light) || 1;
      gl.uniform3fv(uniforms.keyLight, light.map(value => value/magnitude));
      gl.uniform1f(uniforms.oceanWorld, Number(!!scene.ocean));
      gl.uniform1f(uniforms.cloudTime, elapsed);
      gl.uniform2f(uniforms.presentation, scene.skyHeading ?? 0, Number(!!scene.newSky));
      gl.uniform1f(uniforms.structureStyle, scene.structureStyle ?? 0);
      return surfaceDistance(scene, position);
    }

    return { upload, draw, clear };
  }

  return { scenes, sample, lookAtRoute, nearRing, fragment, bind };
})();
