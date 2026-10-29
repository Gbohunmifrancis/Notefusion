/* The 3D reward moments, drawn with WebGL2: a level reached spins its emblem in on a bevelled hexagonal coin, a badge
 * earned pops in as a puffy sticker lit through its normal map. A port of design/rive/practice (emblem.luau + coin.wgsl,
 * sticker.luau + puff.wgsl): the same mesh, light and motion. The faces are the 2D art rasterised by design/rive/faces.mjs
 * and written here by design/rive/live.py (/assets/practice-3d/: emblem-<n>.webp, <badge>.webp + <badge>-normal.webp),
 * fetched when the moment plays. Played by assets/moments.js; the Practice view asks for `levelup-<n>` or a badge.
 * Plain script, no build step. Exposes window.NfMoment3D.
 */
(function () {
  "use strict";

  var DIR = "/assets/practice-3d/", V = "?v=2";
  var SIZE = 200, MS = 2600;
  var BADGES = ["badge-carol-singer", "badge-first-drill", "badge-first-part", "badge-month", "badge-night-singer", "badge-part-learned",
    "badge-seven-in-a-row", "badge-spot-on", "badge-ten-drills", "badge-three-in-a-row", "badge-week-goal"];

  // ── Matrices: column-major 4x4, as WebGL takes them ──
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function translation(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
  function rotationX(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
  function rotationY(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ── The coin (emblem.luau): front cap, front bevel, side, back bevel, back cap, each band with its own vertices ──
  var SAMPLES = 10, RIM = 6, BEVEL = 5, HALF = 9, SPIN_SECONDS = 1.4;
  /** The art's outline: a pointy-top hexagon with rounded corners, in model units (viewBox / 70, y up, centred). */
  function outline(radius, corner) {
    var pts = [], inset = corner / Math.sin(Math.PI / 3);
    for (var k = 0; k < 6; k++) {
      var a = (-90 + 60 * k) * Math.PI / 180, cx = (radius - inset) * Math.cos(a), cy = (radius - inset) * Math.sin(a);
      for (var s = 0; s < SAMPLES; s++) {
        var t = a - Math.PI / 6 + (Math.PI / 3) * s / (SAMPLES - 1);
        pts.push([(cx + corner * Math.cos(t)) / 70, -(cy + corner * Math.sin(t)) / 70]);
      }
    }
    return pts;
  }
  /** Interleaved position xyz, normal xyz, uv; and the triangles' indices. */
  function coin(level) {
    var big = level >= 4, radius = (big ? 56 : 52) + RIM, corner = (big ? 14 : 12) + RIM / 2;
    var outer = outline(radius, corner), inner = outline(radius - BEVEL, corner - BEVEL * 0.6), n = outer.length;
    var h = HALF / 70, b = BEVEL / 70, verts = [], idx = [];
    function put(p, z, nx, ny, nz) { verts.push(p[0], p[1], z, nx, ny, nz, 0, 0); return verts.length / 8 - 1; }
    function cap(z, nz) {
      var centre = put([0, 0], z, 0, 0, nz);
      for (var k = 0; k < n; k++) put(inner[k], z, 0, 0, nz);
      for (k = 0; k < n; k++) {
        var a = centre + 1 + k, c = centre + 1 + (k + 1) % n;
        if (nz > 0) idx.push(centre, a, c); else idx.push(centre, c, a);
      }
    }
    function band(ra, za, rb, zb, nz) {
      var start = verts.length / 8;
      for (var k = 0; k < n; k++) {
        // The outward normal at this point of the outline: perpendicular to the neighbours' chord.
        var prev = outer[(k - 1 + n) % n], next = outer[(k + 1) % n], dx = next[0] - prev[0], dy = next[1] - prev[1];
        var l = Math.hypot(dx, dy), sx = dy / l, sy = -dx / l, m = Math.hypot(sx, sy, nz);
        put(ra[k], za, sx / m, sy / m, nz / m);
        put(rb[k], zb, sx / m, sy / m, nz / m);
      }
      for (k = 0; k < n; k++) {
        var a0 = start + 2 * k, b0 = a0 + 1, a1 = start + 2 * ((k + 1) % n), b1 = a1 + 1;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    cap(h, 1);
    band(inner, h, outer, h - b, 0.9);
    band(outer, h - b, outer, -h + b, 0);
    band(outer, -h + b, inner, -h, -0.9);
    cap(-h, -1);
    return { verts: new Float32Array(verts), index: new Uint16Array(idx) };
  }
  /** The face: the whole 140x140 art as one quad just in front of the coin's front cap. */
  function face() {
    var z = HALF / 70 + 0.004, top = 72 / 70, bottom = -68 / 70;
    return {
      verts: new Float32Array([-1, top, z, 0, 0, 1, 0, 0, 1, top, z, 0, 0, 1, 1, 0, 1, bottom, z, 0, 0, 1, 1, 1, -1, bottom, z, 0, 0, 1, 0, 1]),
      index: new Uint16Array([0, 1, 2, 0, 2, 3])
    };
  }

  // ── Shaders (coin.wgsl, puff.wgsl) ──
  var HEAD = "#version 300 es\nprecision highp float;\n";
  var LIGHT = "const vec3 LIGHT = vec3(-0.45, 0.6, 0.66);\nconst vec3 VIEW = vec3(0.0, 0.0, 1.0);\n";
  var COIN_VS = HEAD + [
    "layout(location = 0) in vec3 pos; layout(location = 1) in vec3 normal; layout(location = 2) in vec2 uv;",
    "uniform mat4 mvp; uniform mat4 model;",
    "out vec3 vNormal; out vec2 vUv; out float vBack;",
    "void main() {",
    "  gl_Position = mvp * vec4(pos, 1.0);",
    "  vNormal = normalize((model * vec4(normal, 0.0)).xyz);",
    "  vUv = uv; vBack = normal.z < -0.5 ? 1.0 : 0.0;",
    "}"].join("\n");
  var COIN_FS = HEAD + LIGHT + [
    "uniform vec4 rim; uniform vec4 back; uniform vec4 params;",
    "in vec3 vNormal; in vec2 vUv; in float vBack; out vec4 outColor;",
    "vec3 shade(vec3 n, vec3 base, float shine) {",
    "  vec3 l = normalize(LIGHT), h = normalize(l + VIEW);",
    "  float diffuse = max(dot(n, l), 0.0), spec = pow(max(dot(n, h), 0.0), 36.0) * shine;",
    "  float fresnel = pow(1.0 - max(dot(n, VIEW), 0.0), 3.0) * 0.25;",
    "  return base * (0.55 + 0.6 * diffuse) + vec3(spec + fresnel);",
    "}",
    "void main() {",
    "  vec3 n = normalize(vNormal);",
    "  vec3 base = mix(rim.rgb, back.rgb, vBack);",
    "  vec3 lit = shade(n, base, mix(1.1, 0.35, vBack)) + vec3(params.x * 0.35);",
    "  outColor = vec4(min(lit, vec3(1.0)), 1.0);",
    "}"].join("\n");
  var FACE_FS = HEAD + LIGHT + [
    "uniform vec4 params; uniform sampler2D faceTex;",
    "in vec3 vNormal; in vec2 vUv; in float vBack; out vec4 outColor;",
    "void main() {",
    "  vec4 tex = texture(faceTex, vUv);",
    "  vec3 n = normalize(vNormal), l = normalize(LIGHT), h = normalize(l + VIEW);",
    "  // A soft band of light that crosses the face as the coin turns.",
    "  float sheen = pow(max(dot(n, h), 0.0), 40.0) * 0.2;",
    "  vec3 lit = tex.rgb * (0.86 + 0.2 * max(dot(n, l), 0.0)) + vec3(sheen + params.x * 0.3);",
    "  outColor = vec4(min(lit, vec3(1.0)) * tex.a, tex.a);",
    "}"].join("\n");
  var PUFF_VS = HEAD + [
    "layout(location = 0) in vec3 pos; layout(location = 1) in vec2 uv;",
    "uniform mat4 mvp; uniform vec4 params;",
    "out vec2 vUv; out float vLayer;",
    "void main() {",
    "  // Drawn back to front: instance 0 is the deepest copy, the last the face itself.",
    "  float layer = params.x - float(gl_InstanceID);",
    "  gl_Position = mvp * vec4(pos.xy, pos.z - layer * params.y, 1.0);",
    "  vUv = uv; vLayer = layer;",
    "}"].join("\n");
  var PUFF_FS = HEAD + LIGHT + [
    "uniform mat4 model; uniform vec4 params; uniform sampler2D colorTex; uniform sampler2D normalTex;",
    "in vec2 vUv; in float vLayer; out vec4 outColor;",
    "void main() {",
    "  vec4 c = texture(colorTex, vUv);",
    "  vec3 nm = texture(normalTex, vUv).xyz * 2.0 - 1.0;",
    "  vec3 n = normalize((model * vec4(nm, 0.0)).xyz), l = normalize(LIGHT), h = normalize(l + VIEW);",
    "  float diffuse = max(dot(n, l), 0.0), spec = pow(max(dot(n, h), 0.0), 42.0) * 0.5;",
    "  float rimLight = pow(1.0 - max(dot(n, VIEW), 0.0), 2.5) * 0.18;",
    "  vec3 faceRgb = c.rgb * (0.76 + 0.34 * diffuse) + vec3(spec + rimLight + params.z * 0.3);",
    "  // The edge: the sticker's own colour in shadow, darker the deeper it sits.",
    "  vec3 edge = c.rgb * (0.5 - 0.12 * vLayer / max(params.x, 1.0));",
    "  bool top = vLayer < 0.5;",
    "  vec3 rgb = top ? faceRgb : edge;",
    "  // Only what is solid has thickness: a see-through part stays as light as it is.",
    "  float a = top ? c.a : c.a * c.a * c.a * c.a;",
    "  outColor = vec4(min(rgb, vec3(1.0)) * a, a);",
    "}"].join("\n");

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(function (s) {
      var sh = gl.createShader(s[0]);
      gl.shaderSource(sh, s[1]); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
      gl.attachShader(p, sh);
    });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    return p;
  }
  /** A vertex array over interleaved floats: attributes as [location, size] in order. */
  function mesh(gl, data, attrs) {
    var vao = gl.createVertexArray(), stride = attrs.reduce(function (s, a) { return s + a[1]; }, 0) * 4, offset = 0;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data.verts, gl.STATIC_DRAW);
    attrs.forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, stride, offset); offset += a[1] * 4; });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: data.index.length };
  }
  /** A texture from a decoded image, as it is (no colour management: the normal maps are numbers), mipmapped. */
  function texture(gl, image, unit) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** An image fetched and decoded with its alpha and colours untouched. */
  var images = {};
  function image(name) {
    if (images[name]) return images[name];
    images[name] = fetch(DIR + name + ".webp" + V).then(function (r) {
      if (!r.ok) throw new Error(name);
      return r.blob();
    }).then(function (blob) {
      return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    });
    images[name].catch(function () { delete images[name]; });
    return images[name];
  }

  function camera(gl, model, lean) {
    var aspect = gl.drawingBufferWidth / gl.drawingBufferHeight, fov = 28 * Math.PI / 180;
    var dist = lean / Math.tan(fov / 2) / Math.min(1, aspect);
    return mul(mul(perspective(fov, aspect, 0.1, 20), translation(0, 0, -dist)), model);
  }
  function uniforms(gl, p, names) { var u = {}; names.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); }); return u; }

  /** The level emblem spinning in: twice round with a flash, settling into its sway. */
  function emblem(level) {
    // The metals, as the 2D art's frame gradient: silver-blue, and Choir-ready's violet.
    var rim = level >= 8 ? [0.62, 0.45, 1.0, 1] : [0.66, 0.8, 1.0, 1], back = level >= 8 ? [0.3, 0.15, 0.66, 1] : [0.17, 0.39, 0.92, 1];
    return {
      prepare: function () { return image("emblem-" + level); },
      create: function (gl, art) {
        var coinProg = program(gl, COIN_VS, COIN_FS), faceProg = program(gl, COIN_VS, FACE_FS);
        var coinMesh = mesh(gl, coin(level), [[0, 3], [1, 3], [2, 2]]), faceMesh = mesh(gl, face(), [[0, 3], [1, 3], [2, 2]]);
        var cu = uniforms(gl, coinProg, ["mvp", "model", "rim", "back", "params"]), fu = uniforms(gl, faceProg, ["mvp", "model", "params", "faceTex"]);
        var tex = texture(gl, art, 0);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
        return function (t) {
          // At rest it sways; the level-up spins it twice and flashes, settling back into the sway.
          var yaw = 0.42 * Math.sin(t * 1.1), pitch = -0.1 + 0.06 * Math.sin(t * 0.7), lift = 0, glow = 0;
          if (t < SPIN_SECONDS) {
            var p = t / SPIN_SECONDS;
            yaw += (1 - easeOut(p)) * Math.PI * 4;
            lift = Math.sin(p * Math.PI) * 0.12;
            glow = Math.sin(p * Math.PI);
          }
          var model = mul(mul(translation(0, lift + 0.02 * Math.sin(t * 1.6), 0), rotationX(pitch)), rotationY(yaw));
          var mvp = camera(gl, model, 1.1), params = [glow, t, 0, 0];
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.disable(gl.BLEND);
          gl.useProgram(coinProg);
          gl.uniformMatrix4fv(cu.mvp, false, mvp); gl.uniformMatrix4fv(cu.model, false, model);
          gl.uniform4fv(cu.rim, rim); gl.uniform4fv(cu.back, back); gl.uniform4fv(cu.params, params);
          gl.bindVertexArray(coinMesh.vao); gl.drawElements(gl.TRIANGLES, coinMesh.count, gl.UNSIGNED_SHORT, 0);
          // The face only when it looks toward the viewer: its back is the coin's back cap.
          if (Math.cos(yaw) > 0) {
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
            gl.useProgram(faceProg);
            gl.uniformMatrix4fv(fu.mvp, false, mvp); gl.uniformMatrix4fv(fu.model, false, model); gl.uniform4fv(fu.params, params);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(fu.faceTex, 0);
            gl.bindVertexArray(faceMesh.vao); gl.drawElements(gl.TRIANGLES, faceMesh.count, gl.UNSIGNED_SHORT, 0);
          }
          gl.bindVertexArray(null);
        };
      }
    };
  }

  /** A badge popping in: sprung toward the viewer with a flash, then floating and turning a little. */
  var LAYERS = 7, DEPTH = 0.012, POP_SECONDS = 0.9;
  function sticker(name) {
    return {
      prepare: function () { return Promise.all([image(name), image(name + "-normal")]); },
      create: function (gl, art) {
        var prog = program(gl, PUFF_VS, PUFF_FS);
        var card = mesh(gl, { verts: new Float32Array([-1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, -1, 0, 1, 1, -1, -1, 0, 0, 1]), index: new Uint16Array([0, 1, 2, 0, 2, 3]) }, [[0, 3], [1, 2]]);
        var u = uniforms(gl, prog, ["mvp", "model", "params", "colorTex", "normalTex"]);
        var color = texture(gl, art[0], 0), normal = texture(gl, art[1], 1);
        return function (t) {
          var yaw = 0.38 * Math.sin(t * 0.9), pitch = 0.16 + 0.07 * Math.sin(t * 0.75), push = 0, glow = 0;
          if (t < POP_SECONDS) {
            var p = t / POP_SECONDS;
            push = Math.sin(p * Math.PI) * 0.35 * (1 - p * 0.5);
            glow = Math.sin(p * Math.PI);
            yaw += Math.sin(p * Math.PI * 2) * 0.5;
          }
          var model = mul(mul(translation(0, 0.03 * Math.sin(t * 1.4), push), rotationX(pitch)), rotationY(yaw));
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.useProgram(prog);
          gl.uniformMatrix4fv(u.mvp, false, camera(gl, model, 1.08)); gl.uniformMatrix4fv(u.model, false, model);
          gl.uniform4fv(u.params, [LAYERS, DEPTH, glow, 0]);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, color); gl.uniform1i(u.colorTex, 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, normal); gl.uniform1i(u.normalTex, 1);
          gl.bindVertexArray(card.vao); gl.drawElementsInstanced(gl.TRIANGLES, card.count, gl.UNSIGNED_SHORT, 0, LAYERS + 1);
          gl.bindVertexArray(null);
        };
      }
    };
  }

  /** The piece for a name moments.js is asked to play (`levelup-<1-8>` or a badge), or null. */
  function piece(name) {
    var m = /^levelup-([1-8])$/.exec(name || ""), made = m ? emblem(Number(m[1])) : BADGES.indexOf(name) >= 0 ? sticker(name) : null;
    if (!made) return null;
    made.width = SIZE; made.height = SIZE; made.ms = MS; made.webgl = true;
    return made;
  }

  window.NfMoment3D = { piece: piece, BADGES: BADGES, coin: coin, SIZE: SIZE, MS: MS };
})();
