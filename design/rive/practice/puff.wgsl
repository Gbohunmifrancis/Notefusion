// A puffy 3D sticker: the sticker's colours lit through its normal map (faces.mjs inflates it from its outline), on a
// card that tilts in 3D, with an edge of thickness made of darker copies stepped back behind it.

struct U {
    mvp: mat4x4<f32>,
    model: mat4x4<f32>,
    params: vec4<f32>,   // x: layers behind the face, y: depth per layer, z: glow (0..1), w: unused
}

@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var colorTex: texture_2d<f32>;
@group(1) @binding(1) var normalTex: texture_2d<f32>;
@group(1) @binding(2) var stickerSampler: sampler;

struct VIn {
    @location(0) pos: vec3<f32>,
    @location(1) uv: vec2<f32>,
}

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) layer: f32,
}

const LIGHT = vec3<f32>(-0.45, 0.6, 0.66);
const VIEW = vec3<f32>(0.0, 0.0, 1.0);

@vertex
fn vs_main(v: VIn, @builtin(instance_index) inst: u32) -> VOut {
    // Drawn back to front: instance 0 is the deepest copy, the last the face itself.
    let layer = u.params.x - f32(inst);
    var o: VOut;
    o.clip = u.mvp * vec4<f32>(v.pos.xy, v.pos.z - layer * u.params.y, 1.0);
    o.uv = v.uv;
    o.layer = layer;
    return o;
}

@fragment
fn fs_main(i: VOut) -> @location(0) vec4<f32> {
    let c = textureSample(colorTex, stickerSampler, i.uv);
    let nm = textureSample(normalTex, stickerSampler, i.uv).xyz * 2.0 - 1.0;
    let n = normalize((u.model * vec4<f32>(nm, 0.0)).xyz);
    let l = normalize(LIGHT);
    let h = normalize(l + VIEW);
    let diffuse = max(dot(n, l), 0.0);
    let spec = pow(max(dot(n, h), 0.0), 42.0) * 0.5;
    let rim = pow(1.0 - max(dot(n, VIEW), 0.0), 2.5) * 0.18;
    let face = c.rgb * (0.76 + 0.34 * diffuse) + vec3<f32>(spec + rim + u.params.z * 0.3);
    // The edge: the sticker's own colour in shadow, darker the deeper it sits.
    let edge = c.rgb * (0.5 - 0.12 * i.layer / max(u.params.x, 1.0));
    let rgb = select(edge, face, i.layer < 0.5);
    // Only what is solid has thickness: a see-through part (an empty star, the spent flame) stays as light as it is.
    let a = select(c.a * c.a * c.a * c.a, c.a, i.layer < 0.5);
    return vec4<f32>(min(rgb, vec3<f32>(1.0)) * a, a);
}
