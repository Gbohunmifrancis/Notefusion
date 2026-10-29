/**
 * A canvas that draws into SVG: the subset of the 2D canvas API the reward moments use (`lib/momentArt.ts`, the mirror
 * of the web's `assets/moment-art.js`), recorded as one frame of SVG elements the phone draws with react-native-svg
 * (`components/practice/Moments.tsx`). Every path is written in the card's own coordinates (arcs as cubic curves, so a
 * squashed circle stays exact); a gradient keeps the transform it was filled under; a clip lasts until the `restore`
 * that undoes it. A picture (`drawImage`) starts a layer of its own, so what is drawn after it lies on top.
 *
 * Blending is always plain: react-native-svg has no screen or additive blend, so a glow is a little softer than on the web.
 * Pure: no React Native import, tested in `svgCanvas.test.ts`.
 */

export type Matrix = [number, number, number, number, number, number];

export interface GradientStop {
  offset: number;
  color: string;
}
export interface Gradient {
  kind: "linear" | "radial";
  /** linear: x1 y1 x2 y2; radial: cx cy r (inner circle at the centre, radius 0). */
  coords: number[];
  stops: GradientStop[];
  addColorStop(offset: number, color: string): void;
}
export type Paint = string | Gradient;

export interface GradientDef {
  id: string;
  kind: "linear" | "radial";
  coords: number[];
  stops: GradientStop[];
  /** Maps the gradient's own coordinates to the card's: the transform it was filled under. */
  matrix: Matrix;
}
export interface ClipDef {
  id: string;
  d: string;
}
export interface PathItem {
  kind: "path";
  d: string;
  /** A colour, or `url(#id)` for a gradient. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
  opacity: number;
  clip?: string;
}
export interface TextItem {
  kind: "text";
  text: string;
  size: number;
  color: string;
  opacity: number;
  /** Where the text's centre sits, and how it is turned and scaled there. */
  matrix: Matrix;
  clip?: string;
}
export interface SvgLayer {
  kind: "svg";
  items: (PathItem | TextItem)[];
  gradients: GradientDef[];
  clips: ClipDef[];
}
export interface ImageLayer {
  kind: "image";
  name: string;
  /** The picture's rectangle in its own units, and the transform that puts it on the card. */
  x: number;
  y: number;
  width: number;
  height: number;
  matrix: Matrix;
  opacity: number;
}
export type Layer = SvgLayer | ImageLayer;

/** The 2D canvas calls the moments make. */
export interface MomentCtx {
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: Paint;
  strokeStyle: Paint;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(a: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  arc(cx: number, cy: number, r: number, a0: number, a1: number): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: string, x: number, y: number, w: number, h: number): void;
  createLinearGradient(x1: number, y1: number, x2: number, y2: number): Gradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a then b: the matrix that applies b first, then a (as canvas transform calls compose). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function gradient(kind: "linear" | "radial", coords: number[]): Gradient {
  const g: Gradient = {
    kind,
    coords,
    stops: [],
    addColorStop(offset, color) {
      g.stops.push({ offset, color });
    },
  };
  return g;
}

interface State {
  matrix: Matrix;
  alpha: number;
  fill: Paint;
  stroke: Paint;
  lineWidth: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  font: string;
  clip?: string;
}

/** A fresh canvas for one frame; `frame()` hands back what was drawn on it. */
export function svgCanvas(): MomentCtx & { frame(): Layer[] } {
  let state: State = { matrix: IDENTITY, alpha: 1, fill: "#000", stroke: "#000", lineWidth: 1, cap: "butt", join: "miter", font: "10px" };
  const stack: State[] = [];
  const layers: Layer[] = [];
  let layer: SvgLayer | null = null;
  let path: string[] = [];
  let open = false; // a current point exists in the path
  let ids = 0;

  function svg(): SvgLayer {
    if (!layer) {
      layer = { kind: "svg", items: [], gradients: [], clips: [] };
      layers.push(layer);
    }
    return layer;
  }
  function apply(m: Matrix) {
    state = { ...state, matrix: multiply(state.matrix, m) };
  }
  function point(x: number, y: number): string {
    const m = state.matrix;
    return `${round(m[0] * x + m[2] * y + m[4])} ${round(m[1] * x + m[3] * y + m[5])}`;
  }
  /** An elliptical arc as cubic curves, in its own coordinates, then through the current transform. */
  function arcPath(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number) {
    let sweep = a1 - a0;
    if (sweep > Math.PI * 2) sweep = Math.PI * 2;
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / steps;
    const k = (4 / 3) * Math.tan(step / 4);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const at = (x: number, y: number): [number, number] => [cx + x * cr - y * sr, cy + x * sr + y * cr];
    const start = at(rx * Math.cos(a0), ry * Math.sin(a0));
    path.push(`${open ? "L" : "M"}${point(start[0], start[1])}`);
    open = true;
    for (let i = 0; i < steps; i++) {
      const t0 = a0 + i * step;
      const t1 = t0 + step;
      const c1 = at(rx * (Math.cos(t0) - k * Math.sin(t0)), ry * (Math.sin(t0) + k * Math.cos(t0)));
      const c2 = at(rx * (Math.cos(t1) + k * Math.sin(t1)), ry * (Math.sin(t1) - k * Math.cos(t1)));
      const end = at(rx * Math.cos(t1), ry * Math.sin(t1));
      path.push(`C${point(c1[0], c1[1])} ${point(c2[0], c2[1])} ${point(end[0], end[1])}`);
    }
  }
  function paint(p: Paint): string {
    if (typeof p === "string") return p;
    const id = `g${ids++}`;
    svg().gradients.push({ id, kind: p.kind, coords: p.coords, stops: p.stops.slice(), matrix: state.matrix });
    return `url(#${id})`;
  }
  /** How thick a line of width w is once transformed: the transform's mean scale. */
  function thickness(w: number): number {
    const m = state.matrix;
    return w * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  }
  function fontSize(): number {
    const m = /(\d+(?:\.\d+)?)px/.exec(state.font);
    return m ? Number(m[1]) : 10;
  }

  const ctx = {
    get globalAlpha() { return state.alpha; },
    set globalAlpha(v: number) { state = { ...state, alpha: v }; },
    globalCompositeOperation: "source-over",
    get fillStyle() { return state.fill; },
    set fillStyle(v: Paint) { state = { ...state, fill: v }; },
    get strokeStyle() { return state.stroke; },
    set strokeStyle(v: Paint) { state = { ...state, stroke: v }; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v: number) { state = { ...state, lineWidth: v }; },
    get lineCap() { return state.cap; },
    set lineCap(v: "butt" | "round" | "square") { state = { ...state, cap: v }; },
    get lineJoin() { return state.join; },
    set lineJoin(v: "miter" | "round" | "bevel") { state = { ...state, join: v }; },
    get font() { return state.font; },
    set font(v: string) { state = { ...state, font: v }; },
    textAlign: "center",
    textBaseline: "middle",
    save() { stack.push(state); },
    restore() { const s = stack.pop(); if (s) state = s; },
    translate(x: number, y: number) { apply([1, 0, 0, 1, x, y]); },
    scale(x: number, y: number) { apply([x, 0, 0, y, 0, 0]); },
    rotate(a: number) { const c = Math.cos(a); const s = Math.sin(a); apply([c, s, -s, c, 0, 0]); },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) { apply([a, b, c, d, e, f]); },
    beginPath() { path = []; open = false; },
    moveTo(x: number, y: number) { path.push(`M${point(x, y)}`); open = true; },
    lineTo(x: number, y: number) { path.push(`${open ? "L" : "M"}${point(x, y)}`); open = true; },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      if (!open) { path.push(`M${point(c1x, c1y)}`); open = true; }
      path.push(`C${point(c1x, c1y)} ${point(c2x, c2y)} ${point(x, y)}`);
    },
    arc(cx: number, cy: number, r: number, a0: number, a1: number) { arcPath(cx, cy, r, r, 0, a0, a1); },
    ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, a0: number, a1: number) {
      arcPath(cx, cy, rx, ry, rotation, a0, a1);
    },
    rect(x: number, y: number, w: number, h: number) {
      path.push(`M${point(x, y)}L${point(x + w, y)}L${point(x + w, y + h)}L${point(x, y + h)}Z`);
      open = false;
    },
    closePath() { if (path.length) path.push("Z"); open = false; },
    fill() {
      if (!path.length) return;
      svg().items.push({ kind: "path", d: path.join(""), fill: paint(state.fill), opacity: state.alpha, clip: state.clip });
    },
    stroke() {
      if (!path.length) return;
      svg().items.push({
        kind: "path", d: path.join(""), stroke: paint(state.stroke), strokeWidth: thickness(state.lineWidth),
        cap: state.cap, join: state.join, opacity: state.alpha, clip: state.clip,
      });
    },
    clip() {
      const id = `c${ids++}`;
      svg().clips.push({ id, d: path.join("") });
      state = { ...state, clip: id };
    },
    fillText(text: string, x: number, y: number) {
      const color = typeof state.fill === "string" ? state.fill : "#fff";
      svg().items.push({ kind: "text", text, size: fontSize(), color, opacity: state.alpha, matrix: multiply(state.matrix, [1, 0, 0, 1, x, y]), clip: state.clip });
    },
    drawImage(image: string, x: number, y: number, w: number, h: number) {
      layers.push({ kind: "image", name: image, x, y, width: w, height: h, matrix: state.matrix, opacity: state.alpha });
      layer = null;
    },
    createLinearGradient(x1: number, y1: number, x2: number, y2: number) { return gradient("linear", [x1, y1, x2, y2]); },
    createRadialGradient(_x0: number, _y0: number, _r0: number, x1: number, y1: number, r1: number) { return gradient("radial", [x1, y1, r1]); },
    frame() { return layers; },
  };
  return ctx;
}
