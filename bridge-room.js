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
    function quad(a, b, c, d, color, light = 1) {
      for (const point of [a, b, c, a, c, d]) data.push(...point, ...color.map(channel => channel * light));
    }
    function box([x, y, z], [X, Y, Z], color) {
      const a = [x,y,z], b = [X,y,z], c = [X,y,Z], d = [x,y,Z];
      const A = [x,Y,z], B = [X,Y,z], C = [X,Y,Z], D = [x,Y,Z];
      quad(A, B, C, D, color, 1.07);
      quad(a, b, c, d, color, .64);
      quad(a, b, B, A, color, .83);
      quad(d, c, C, D, color, .83);
      quad(a, d, D, A, color, .73);
      quad(b, c, C, B, color, .73);
    }

    box([-4.9, -1.92, -5.1], [4.9, -1.8, 5.1], dark);
    box([-4.9, 2.5, -5.1], [4.9, 2.62, 5.1], panel);
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
        strip(-1.8, 2.5, panel);
        return;
      }
      strip(-1.8, -1.03, panel);
      strip(1.91, 2.5, panel);
      strip(-1.03,-.92,trim);
      strip(1.83,1.91,trim);
      strip(-1.34,-1.31,cyan,.998);
      strip(2.04,2.075,cyan,.998);
      if (x !== 0 || z !== 5.1) {
        box([x-.095,-1.08,z-.095],[x+.095,1.97,z+.095], trim);
      }
    });
    box([-1.22,-1.78,-5.09],[1.22,1.45,-4.93], trim);
    box([-1.12,-1.78,-4.92],[1.12,1.36,-4.87], dark);
    box([-.012,-1.7,-4.866],[.012,1.22,-4.858], cyan);
    box([-.66,1.18,-4.866],[.66,1.23,-4.858], amber);

    function console(x, z, width, depth) {
      box([x-width*.26,-1.78,z-depth*.34],[x+width*.26,-1.13,z+depth*.34], panel);
      box([x-width/2,-1.14,z-depth/2],[x+width/2,-.88,z+depth/2], trim);
      box([x-width*.43,-.878,z-depth*.41],[x+width*.43,-.86,z+depth*.34], dark);
      for (let i = -3; i <= 3; i++) {
        const offset = i * width * .105;
        const bar = .10 + .19 * (1 + Math.cos(i * 1.56)) / 2;
        box([x+offset-.025,-.859,z-depth*.31],[x+offset+.025,-.85,z-depth*.31+bar], cyan);
      }
      box([x-width*.43,-1.03,z-depth*.505],[x+width*.43,-.996,z-depth*.501], cyan);
    }
    console(0,3.45,1.85,1.35);
    for (const x of [-3.93, 3.93]) {
      console(x,1.9,1.15,1.75);
      console(x,-1.45,1.15,1.75);
    }
    return new Float32Array(data);
  }

  const vertex = `
attribute vec3 position;
attribute vec3 tint;
uniform vec3 eye;
uniform mat3 basis;
uniform vec2 scale;
varying vec3 color;
varying vec3 point;
void main() {
  vec3 offset = position - eye;
  vec3 view = vec3(dot(basis[0], offset), dot(basis[1], offset), dot(basis[2], offset));
  gl_Position = vec4(view.xy / scale, view.z * 1.00753 - .15056, view.z);
  color = tint;
  point = position;
}`;

  const fragment = `
precision mediump float;
varying vec3 color;
varying vec3 point;
void main() {
  float grain = .96 + .04 * sin(point.x*66.0 + point.z*33.0 + point.y*42.0);
  float lighting = .72 + .28 / (1.0 + .12*dot(point.xz, point.xz));
  gl_FragColor = vec4(color * grain * lighting, 1.0);
}`;

  function bind(gl, program, check) {
    const vertices = mesh();
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

    const position = gl.getAttribLocation(program, 'position');
    const tint = gl.getAttribLocation(program, 'tint');
    const [eye, basis, scale] = ['eye', 'basis', 'scale'].map(name => gl.getUniformLocation(program, name));
    return {
      draw(matrix, camera, xScale, yScale) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(position);
        gl.enableVertexAttribArray(tint);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(tint, 3, gl.FLOAT, false, 24, 12);
        gl.uniform3fv(eye, camera);
        gl.uniformMatrix3fv(basis, false, matrix);
        gl.uniform2f(scale, xScale, yScale);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
        gl.disable(gl.DEPTH_TEST);
        gl.disableVertexAttribArray(position);
        gl.disableVertexAttribArray(tint);
      },
      release() { gl.deleteBuffer(buffer); },
    };
  }

  return { origin, orientation, turn, matrix, vertex, fragment, bind };
})();
