'use strict';

const AsteriaBridge = (() => {
  const origin = [0, 0, 0];

  function multiply([x, y, z, w], [a, b, c, d]) {
    return [w*a + x*d + y*c - z*b, w*b - x*c + y*d + z*a,
      w*c + x*b - y*a + z*d, w*d - x*a - y*b - z*c];
  }

  function orientation(yaw, pitch, roll) {
    const a = yaw / 2, b = -pitch / 2, c = roll / 2;
    return multiply(multiply([0, Math.sin(a), 0, Math.cos(a)], [Math.sin(b), 0, 0, Math.cos(b)]),
      [0, 0, Math.sin(c), Math.cos(c)]);
  }

  function turn(current, yaw, pitch, roll) {
    const next = multiply(current, orientation(yaw, pitch, roll));
    const length = Math.hypot(...next);
    return next.map(value => value / length);
  }

  function matrix([x, y, z, w]) {
    return new Float32Array([
      1 - 2*(y*y + z*z), 2*(x*y + z*w), 2*(x*z - y*w),
      2*(x*y - z*w), 1 - 2*(x*x + z*z), 2*(y*z + x*w),
      2*(x*z + y*w), 2*(y*z - x*w), 1 - 2*(x*x + y*y),
    ]);
  }

  function mesh() {
    const data = [];
    const panel = [0.18, 0.24, 0.31], trim = [0.32, 0.43, 0.52];
    const dark = [0.058, 0.09, 0.13], cyan = [0.20, 0.74, 0.85], amber = [0.89, 0.55, 0.24];
    function quad(a, b, c, d, color, light = 1, material = 0) {
      for (const point of [a, b, c, a, c, d]) data.push(...point, ...color.map(channel => channel * light), material);
    }
    function box([x, y, z], [X, Y, Z], color, material = 0) {
      const a = [x,y,z], b = [X,y,z], c = [X,y,Z], d = [x,y,Z];
      const A = [x,Y,z], B = [X,Y,z], C = [X,Y,Z], D = [x,Y,Z];
      quad(A, B, C, D, color, 1.07, material);
      quad(a, b, c, d, color, .64, material);
      quad(a, b, B, A, color, .83, material);
      quad(d, c, C, D, color, .83, material);
      quad(a, d, D, A, color, .73, material);
      quad(b, c, C, B, color, .73, material);
    }

    box([-4.9, -1.92, -5.1], [4.9, -1.8, 5.1], dark);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? [-4.9,-.83] : [.83,4.9];
      box([edge[0],2.5,-5.1],[edge[1],2.62,5.1],panel);
    }
    box([-.83,2.5,-5.1],[.83,2.62,1.8],panel);
    for (const z of [1.8, 3.15, 4.48, 5.04]) {
      box([-.86,2.45,z-.04],[.86,2.57,z+.04],trim);
    }
    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) {
        box([x-.489,-1.8,z-.489],[x+.489,-1.78,z+.489], x === 0 ? dark : panel);
      }
    }
    for (const x of [-1, 1]) {
      box([x-.027,-1.779,-4.95],[x+.027,-1.77,4.95], cyan);
    }
    for (const x of [-2.6, 0, 2.6]) {
      box([x-.12,2.39,-5],[x+.12,2.5,5], dark);
      for (const z of [-3.5,-1.2,1.2,3.5]) {
        box([x-.035,2.38,z-.71],[x+.035,2.39,z+.71], cyan);
      }
    }

    const perimeter = [
      [-3.5,5.1],[0,5.1],[3.5,5.1],[4.9,3.7],[4.9,0],[4.9,-3.7],
      [3.5,-5.1],[0,-5.1],[-3.5,-5.1],[-4.9,-3.7],[-4.9,0],[-4.9,3.7],
    ];
    perimeter.forEach(([x,z], index) => {
      const [X,Z] = perimeter[(index + 1) % perimeter.length];
      function strip(bottom, top, color, inset = 1) {
        quad([x*inset,bottom,z*inset],[X*inset,bottom,Z*inset],
          [X*inset,top,Z*inset],[x*inset,top,z*inset],color);
      }
      const rear = z === -5.1 && Z === -5.1;
      if (rear) {
        const side = x < 0 || X < 0 ? [-3.5,-1.2] : [1.2,3.5];
        box([side[0],-1.8,-5.1],[side[1],2.5,-4.98],panel);
        return;
      }
      strip(-1.8,-1.03,panel);
      strip(-1.12,-1.04,dark,.964);
      strip(1.91,1.99,trim,.963);
      strip(1.91, 2.5, panel);
      strip(-1.03,-.92,trim);
      strip(1.83,1.91,trim);
      strip(-1.34,-1.31,cyan,.998);
      strip(2.04,2.075,cyan,.998);
      if (x !== 0 || z !== 5.1) {
        box([x-.095,-1.08,z-.095],[x+.095,1.97,z+.095], trim);
      }
    });
    box([-1.22,1.36,-5.09],[1.22,2.5,-4.89],trim);
    for (const sign of [-1,1]) {
      const x=sign*1.18;
      box([x-.068,-1.8,-5.11],[x+.068,1.48,-4.81],trim);
    }
    for (const side of [-1, 1]) {
      const a = side * 1.12, b = side * 2.22;
      box([Math.min(a,b),-1.78,-4.87],[Math.max(a,b),1.36,-4.74], panel);
    }
    box([-.66,1.39,-4.93],[.66,1.45,-4.86], amber);

    function console(x, z, width, depth) {
      box([x-width*.26,-1.78,z-depth*.34],[x+width*.26,-1.13,z+depth*.34], panel);
      box([x-width/2,-1.14,z-depth/2],[x+width/2,-.88,z+depth/2], trim);
      box([x-width*.43,-.878,z-depth*.41],[x+width*.43,-.86,z+depth*.34], dark);
      for (const side of [-1,1]) {
        const rail = x + side*width*.45;
        box([rail-.027,-.88,z-depth*.46],[rail+.027,-.827,z+depth*.46],panel);
      }
      box([x-width*.34,-.856,z+depth*.23],[x+width*.34,-.843,z+depth*.31],cyan,2);
      for (let i = -3; i <= 3; i++) {
        const key = x + i*width*.11;
        box([key-.024,-.852,z+.065],[key+.024,-.827,z+.107],i === 3 ? amber : trim,i === 3 ? 2 : 0);
      }
      for (let i = -3; i <= 3; i++) {
        const offset = i * width * .105;
        const bar = .10 + .19 * (1 + Math.cos(i * 1.56)) / 2;
        box([x+offset-.025,-.859,z-depth*.31],[x+offset+.025,-.85,z-depth*.31+bar], cyan);
      }
      box([x-width*.43,-1.03,z-depth*.505],[x+width*.43,-.996,z-depth*.501], cyan);
    }
    for (const {x,z,width,depth} of AsteriaInterior.consoles) console(x,z,width,depth);

    const fabric = [.19,.29,.34];
    function chair({eye: [x,,z], heading}) {
      const sign = Math.cos(heading);
      const back = z - sign*.38;
      box([x-.27,-1.77,z-.26],[x+.27,-1.64,z+.26],dark);
      box([x-.11,-1.64,z-.11],[x+.11,-1.20,z+.11],trim);
      box([x-.40,-1.20,z-.40],[x+.40,-1.03,z+.40],fabric,1);
      box([x-.32,-1.14,back-.072],[x+.32,.16,back+.072],fabric,1);
      box([x-.21,.14,back-.066],[x+.21,.27,back+.066],dark,1);
      for (const side of [-1,1]) {
        const rail = x+side*.40;
        box([rail-.047,-1.15,z-.24],[rail+.047,-.80,z+.24],panel);
        box([rail-.055,-.84,z-.27],[rail+.055,-.79,z+.26],fabric,1);
      }
    }
    Object.values(AsteriaInterior.seats).forEach(chair);
    box([-3.26,-1.77,-3.405],[-2.32,-1.33,-2.955],dark);
    box([-3.25,-1.36,-3.42],[-2.33,-1.29,-2.63],fabric,1);
    box([-3.25,-1.31,-3.44],[-2.33,-.64,-3.28],fabric,1);

    // The pressure doorway opens into a separate aft viewing bay.
    box([-3.25,-1.91,-7.99],[3.25,-1.8,-5.06],dark);
    box([-3.25,2.03,-7.99],[3.25,2.14,-5.06],panel);
    for (const sign of [-1,1]) {
      const x=sign*3.19;
      box([x-.06,-1.8,-7.99],[x+.06,-1.04,-5.06],panel);
      box([x-.07,1.61,-7.99],[x+.07,2.03,-5.06],panel);
      for (const z of [-7.93,-6.5,-5.11]) {
        box([x-.062,-1.04,z-.05],[x+.062,1.62,z+.05],trim);
      }
      box([x-.063,-1.05,-7.93],[x+.063,-1.01,-5.12],amber,2);
    }
    box([-3.25,-1.8,-7.99],[3.25,-1.03,-7.88],panel);
    box([-3.25,1.59,-7.99],[3.25,2.03,-7.88],panel);
    for (const x of [-3.2,-1.62,1.62,3.2]) box([x-.055,-1.03,-7.99],[x+.055,1.59,-7.88],trim);
    box([-2.25,-1.77,-6.99],[-1.05,-1.55,-6.25],panel);
    box([-2.25,-1.56,-6.99],[-1.05,-1.27,-6.25],fabric,1);
    for (const x of [-.80,.80]) box([x-.02,-1.79,-7.68],[x+.02,-1.77,-4.91],amber,2);
    const frames = [data.length / 7];
    for (const side of [-1, 1]) {
      const inner = side * .025, outer = side * 1.09;
      box([Math.min(inner,outer),-1.77,-4.865],[Math.max(inner,outer),1.34,-4.81], dark);
      box([inner-.013,-1.7,-4.805],[inner+.013,1.22,-4.797], cyan);
      const x = side * .57;
      box([x-.33,.22,-4.806],[x+.33,.255,-4.798], trim);
      frames.push(data.length / 7);
    }
    return {vertices: new Float32Array(data), frames};
  }

  const vertex = `
attribute vec3 position;
attribute vec3 tint;
attribute float surface;
attribute float joint;
attribute vec3 vertexNormal;
uniform vec3 eye;
uniform mat3 basis;
uniform vec2 scale;
uniform float hatchOffset;
uniform vec4 actorPose;
uniform mat4 skin[16];
uniform bool drawActor;
varying vec3 color;
varying vec3 point;
varying float material;
varying vec3 actorNormal;
void main() {
  vec3 world = position + vec3(hatchOffset, 0.0, 0.0);
  actorNormal = vec3(0.0);
  if (drawActor) {
    float c = cos(actorPose.w), s = sin(actorPose.w);
    mat4 bone = skin[int(joint)];
    vec3 local = (bone * vec4(position,1.0)).xyz;
    vec3 n = (bone * vec4(vertexNormal,0.0)).xyz;
    actorNormal = vec3(c*n.x+s*n.z, n.y, -s*n.x+c*n.z);
    world = vec3(c*local.x + s*local.z, local.y, -s*local.x + c*local.z) + actorPose.xyz;
  }
  vec3 offset = world - eye;
  vec3 view = vec3(dot(basis[0], offset), dot(basis[1], offset), dot(basis[2], offset));
  gl_Position = vec4(view.xy / scale, view.z * 1.00753 - .15056, view.z);
  color = tint;
  point = world;
  material = surface;
}`;

  const fragment = `
precision mediump float;
varying vec3 color;
varying vec3 point;
varying float material;
varying vec3 actorNormal;
uniform vec3 windowTint;
uniform vec3 lightDirection;
uniform vec3 bridgeLighting;
void main() {
  float metal = .94 + .06*sin(point.x*76.0 + point.z*31.0 + point.y*61.0);
  float weave = .91 + .09*sin(point.x*95.0 + point.y*76.0)*sin(point.z*93.0 + point.y*91.0);
  float taskLight = mix(.44,.83,bridgeLighting.x);
  float fill = .25 / (1.0 + .13*dot(point.xz,point.xz));
  float spill = clamp(.37 + .095*dot(point,lightDirection) + .13*point.y, .05,.85);
  vec3 bounce = windowTint*spill*(.12 + .22*bridgeLighting.x);
  vec3 warpLight = vec3(.12,.29,.52)*bridgeLighting.y;
  vec3 hazard = vec3(.19,.075,.026)*bridgeLighting.z;
  vec3 lit = color * (taskLight + fill + bounce + warpLight + hazard);
  lit *= material > .5 ? weave : metal;
  if (material > 1.5) lit = mix(lit,color,.65);
  if (dot(actorNormal,actorNormal) > .15) {
    vec3 normal = normalize(actorNormal);
    float key = max(0.0,dot(normal,normalize(vec3(-.32,.60,-.72))));
    float rim = max(0.0,dot(normal,normalize(vec3(.52,.62,.43))));
    float exterior = max(0.0,dot(normal,lightDirection));
    lit = color*(.45 + .44*key + .19*rim + .13*bridgeLighting.x
      + windowTint*.23*exterior + warpLight + hazard);
  }
  gl_FragColor = vec4(lit, 1.0);
}`;

  function bind(gl, program, check) {
    const {vertices, frames} = mesh();
    const buffer = gl.createBuffer();
    if (!buffer) throw Error('WebGL bridge mesh allocation failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    try {
      check(gl, 'bridge mesh');
    } catch (error) {
      gl.deleteBuffer(buffer);
      throw error;
    }

    function actorBuffer(lod) {
      const {verts, props} = AsteriaMarieRig.build(lod);
      const data = new Float32Array(verts.length + props.length);
      data.set(verts);
      data.set(props, verts.length);
      const handle = gl.createBuffer();
      if (!handle) throw Error('WebGL crew mesh allocation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, handle);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      try {
        check(gl, 'crew mesh');
        return {handle, body: verts.length/10, tray: props.length/10};
      } catch (error) {
        gl.deleteBuffer(handle);
        throw error;
      }
    }

    let crew = null, crewLow = null;
    try {
      crewLow = actorBuffer(true);
    } catch (error) {
      console.warn('3D crew renderer unavailable:', error.message);
    }
    let highAttempted = false;
    let lastPose = null, skinData = null;
    const position = gl.getAttribLocation(program, 'position');
    const tint = gl.getAttribLocation(program, 'tint');
    const surface = gl.getAttribLocation(program, 'surface');
    const joint = gl.getAttribLocation(program, 'joint');
    const normal = gl.getAttribLocation(program, 'vertexNormal');
    const [eye, basis, scale, hatchOffset, actorPose, skin, drawActor, windowTint,
      lightDirection, bridgeLighting] =
      ['eye', 'basis', 'scale', 'hatchOffset', 'actorPose', 'skin[0]', 'drawActor', 'windowTint',
        'lightDirection', 'bridgeLighting']
        .map(name => gl.getUniformLocation(program, name));
    return {
      draw(matrix, camera, xScale, yScale, hatch, pose, light) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(position);
        gl.enableVertexAttribArray(tint);
        gl.enableVertexAttribArray(surface);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 28, 0);
        gl.vertexAttribPointer(tint, 3, gl.FLOAT, false, 28, 12);
        gl.vertexAttribPointer(surface, 1, gl.FLOAT, false, 28, 24);
        gl.uniform3fv(windowTint, light.tint);
        gl.uniform3fv(lightDirection, light.direction);
        gl.uniform3fv(bridgeLighting, light.levels);
        gl.uniform3fv(eye, camera);
        gl.uniformMatrix3fv(basis, false, matrix);
        gl.uniform2f(scale, xScale, yScale);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const [left, right, end] = frames;
        gl.uniform1i(drawActor, 0);
        gl.uniform1f(hatchOffset, 0);
        gl.drawArrays(gl.TRIANGLES, 0, left);
        gl.uniform1f(hatchOffset, -1.09*hatch);
        gl.drawArrays(gl.TRIANGLES, left, right - left);
        gl.uniform1f(hatchOffset, 1.09*hatch);
        gl.drawArrays(gl.TRIANGLES, right, end - right);
        if (pose && crewLow) {
          const [x,z] = pose.point;
          if (!highAttempted && yScale >= .32 && Math.hypot(x-camera[0],z-camera[2]) < 2.6) {
            highAttempted = true;
            try {
              crew = actorBuffer(false);
            } catch (error) {
              console.warn('Using compact crew mesh:', error.message);
            }
          }
          const mesh = Math.hypot(x-camera[0],z-camera[2]) < 2.6 ? crew ?? crewLow : crewLow;
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.handle);
          gl.disableVertexAttribArray(surface);
          gl.vertexAttrib1f(surface, 0);
          gl.enableVertexAttribArray(joint);
          gl.enableVertexAttribArray(normal);
          gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 40, 0);
          gl.vertexAttribPointer(tint, 3, gl.FLOAT, false, 40, 12);
          gl.vertexAttribPointer(joint, 1, gl.FLOAT, false, 40, 24);
          gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 40, 28);
          gl.uniform1i(drawActor, 1);
          gl.uniform4f(actorPose, x, -1.77, z, pose.direction);
          if (pose !== lastPose) {
            lastPose = pose;
            skinData = AsteriaMarieRig.transforms(pose);
          }
          gl.uniformMatrix4fv(skin, false, skinData);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.body + (pose.tea ? mesh.tray : 0));
          gl.disableVertexAttribArray(joint);
          gl.disableVertexAttribArray(normal);
        }
        gl.disable(gl.DEPTH_TEST);
        gl.disableVertexAttribArray(position);
        gl.disableVertexAttribArray(tint);
        gl.disableVertexAttribArray(surface);
      },
      release() {
        gl.deleteBuffer(buffer);
        if (crew) gl.deleteBuffer(crew.handle);
        if (crewLow) gl.deleteBuffer(crewLow.handle);
      },
    };
  }

  return { origin, orientation, turn, matrix, vertex, fragment, bind };
})();
