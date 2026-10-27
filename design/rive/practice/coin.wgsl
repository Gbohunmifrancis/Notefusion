// The 3D level emblem: a bevelled hexagonal coin (the "coin" entry points) wearing the level's 2D emblem as a decal on
// its face (the "face" entry points). Lit from the upper left and the front, as the 2D art is, with a moving sheen.

struct U {
    mvp: mat4x4<f32>,
    model: mat4x4<f32>,
    rim: vec4<f32>,      // the rim's metal
    back: vec4<f32>,     // the back face
    params: vec4<f32>,   // x: glow (0..1, a level-up's flash), y: time
}

@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var faceTex: texture_2d<f32>;
@group(1) @binding(1) var faceSampler: sampler;

struct VIn {
    @location(0) pos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
}

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) back: f32,
}

const LIGHT = vec3<f32>(-0.45, 0.6, 0.66);
const VIEW = vec3<f32>(0.0, 0.0, 1.0);

fn shade(n: vec3<f32>, base: vec3<f32>, shine: f32) -> vec3<f32> {
    let l = normalize(LIGHT);
    let h = normalize(l + VIEW);
    let diffuse = max(dot(n, l), 0.0);
    let spec = pow(max(dot(n, h), 0.0), 36.0) * shine;
    let fresnel = pow(1.0 - max(dot(n, VIEW), 0.0), 3.0) * 0.25;
    return base * (0.55 + 0.6 * diffuse) + vec3<f32>(spec + fresnel);
}

@vertex
fn vs_coin(v: VIn) -> VOut {
    var o: VOut;
    o.clip = u.mvp * vec4<f32>(v.pos, 1.0);
    o.normal = normalize((u.model * vec4<f32>(v.normal, 0.0)).xyz);
    o.uv = v.uv;
    o.back = select(0.0, 1.0, v.normal.z < -0.5);
    return o;
}

@fragment
fn fs_coin(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4<f32> {
    var n = normalize(i.normal);
    if (!ff) { n = -n; }
    let base = mix(u.rim.rgb, u.back.rgb, i.back);
    let lit = shade(n, base, mix(1.1, 0.35, i.back)) + vec3<f32>(u.params.x * 0.35);
    return vec4<f32>(min(lit, vec3<f32>(1.0)), 1.0);
}

@vertex
fn vs_face(v: VIn) -> VOut {
    var o: VOut;
    o.clip = u.mvp * vec4<f32>(v.pos, 1.0);
    o.normal = normalize((u.model * vec4<f32>(v.normal, 0.0)).xyz);
    o.uv = v.uv;
    o.back = 0.0;
    return o;
}

@fragment
fn fs_face(i: VOut) -> @location(0) vec4<f32> {
    let tex = textureSample(faceTex, faceSampler, i.uv);
    let n = normalize(i.normal);
    let l = normalize(LIGHT);
    let h = normalize(l + VIEW);
    // A soft band of light that crosses the face as the coin turns.
    let sheen = pow(max(dot(n, h), 0.0), 40.0) * 0.2;
    let lit = tex.rgb * (0.86 + 0.2 * max(dot(n, l), 0.0)) + vec3<f32>(sheen + u.params.x * 0.3);
    let a = tex.a;
    return vec4<f32>(min(lit, vec3<f32>(1.0)) * a, a);
}
