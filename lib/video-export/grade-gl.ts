/**
 * WebGL2 grade-node engine — renders an ordered chain of GradeNodes
 * (lib/editor-types) onto a video frame. One shader pass per node,
 * ping-ponged between two framebuffer textures; the final pass hits the
 * output canvas. The SAME module runs the live preview overlay and the
 * export compositor, so preview↔export parity is structural, not tested-in.
 *
 * Per-node math, in order (documented so UI + QA share one contract):
 *   1. temp/tint          r += temp·k, b -= temp·k, g += tint·k   (k = 0.15)
 *   2. offset             c += offset
 *   3. lift               c += lift·(1 − c)          (raises blacks, pins white)
 *   4. gain               c ·= 1 + gain
 *   5. gamma              c = c^(1/(1+gamma))        (mids, pins both ends)
 *   6. contrast/pivot     c = (c − pivot)·contrast + pivot
 *   7. luma curve         per-channel through a 256-entry LUT
 *   8. hue-vs-sat         sat multiplier from a 256-entry LUT indexed by hue
 *   9. saturation         mix(luma709, c, sat)
 *  10. window             out = mix(nodeInput, out, mask)
 *
 * Wheels resolve per channel as wheel.channel + wheel.y (master).
 * Returns null when WebGL2 is unavailable — callers skip grading.
 */

import type { GradeNode, GradeCurvePoint, GradeWindow } from '@/lib/editor-types'
import { gradeNodeIsNeutral } from '@/lib/editor-types'

const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
uniform sampler2D uLuma;    // 256×1, r = mapped value
uniform sampler2D uHueSat;  // 256×1, r = sat multiplier / 2
uniform int   uHasLuma;
uniform int   uHasHueSat;
uniform int   uFlipY;       // 1 on the first pass (external frame), 0 after
uniform vec3  uLift;
uniform vec3  uGamma;
uniform vec3  uGain;
uniform vec3  uOffset;
uniform float uContrast;
uniform float uPivot;
uniform float uTemp;
uniform float uTint;
uniform float uSat;
// Window: 0 = none, 1 = ellipse, 2 = gradient
uniform int   uWinShape;
uniform vec2  uWinCenter;
uniform vec2  uWinRadii;
uniform float uWinAngle;
uniform float uWinSoft;
uniform int   uWinInvert;
in vec2 vUv;
out vec4 outColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

void main() {
  vec2 uv = uFlipY == 1 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 src = texture(uFrame, uv);
  vec3 c = src.rgb;
  vec3 orig = c;

  // 1. temp / tint
  c.r += uTemp * 0.15;
  c.b -= uTemp * 0.15;
  c.g += uTint * 0.15;

  // 2..5 wheels
  c += uOffset;
  c = c + uLift * (1.0 - c);
  c = c * (1.0 + uGain);
  c = pow(clamp(c, 0.0001, 4.0), 1.0 / (1.0 + uGamma));

  // 6. contrast about pivot
  c = (c - uPivot) * uContrast + uPivot;

  // 7. luma curve per channel
  if (uHasLuma == 1) {
    c.r = texture(uLuma, vec2(clamp(c.r, 0.0, 1.0), 0.5)).r;
    c.g = texture(uLuma, vec2(clamp(c.g, 0.0, 1.0), 0.5)).r;
    c.b = texture(uLuma, vec2(clamp(c.b, 0.0, 1.0), 0.5)).r;
  }

  // 8. hue-vs-sat
  if (uHasHueSat == 1) {
    float hue = rgb2hsv(clamp(c, 0.0, 1.0)).x;
    float mult = texture(uHueSat, vec2(hue, 0.5)).r * 2.0;
    float l = dot(clamp(c, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, mult);
  }

  // 9. saturation
  float luma = dot(clamp(c, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSat);

  // 10. window mask
  if (uWinShape != 0) {
    vec2 p = uv - uWinCenter;
    float ca = cos(uWinAngle), sa = sin(uWinAngle);
    p = vec2(p.x * ca + p.y * sa, -p.x * sa + p.y * ca);
    float m;
    if (uWinShape == 1) {
      float d = length(p / max(uWinRadii, vec2(1e-4)));
      m = 1.0 - smoothstep(1.0 - uWinSoft, 1.0 + uWinSoft, d);
    } else {
      float d = p.y / max(uWinRadii.y, 1e-4);
      m = 1.0 - smoothstep(-uWinSoft, uWinSoft, d);
    }
    if (uWinInvert == 1) m = 1.0 - m;
    c = mix(orig, c, clamp(m, 0.0, 1.0));
  }

  outColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`

interface CurveTex { tex: WebGLTexture; sig: string }

function sampleCurve(points: GradeCurvePoint[], n: number, neutral: number): Float32Array {
  const out = new Float32Array(n)
  const pts = [...points].sort((a, b) => a.x - b.x)
  if (pts.length < 2) { out.fill(neutral); return out }
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    if (x <= pts[0].x) { out[i] = pts[0].y; continue }
    if (x >= pts[pts.length - 1].x) { out[i] = pts[pts.length - 1].y; continue }
    let k = 0
    while (k < pts.length - 2 && pts[k + 1].x < x) k++
    // Catmull-Rom through the segment for smooth curves
    const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)]
    const t = (x - p1.x) / Math.max(1e-6, p2.x - p1.x)
    const t2 = t * t, t3 = t2 * t
    out[i] = Math.min(1, Math.max(0,
      0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)))
  }
  return out
}

class GradeGL {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private uni: Record<string, WebGLUniformLocation | null> = {}
  private frameTex: WebGLTexture
  private ping: { tex: WebGLTexture; fb: WebGLFramebuffer }[]
  private neutralTex: WebGLTexture
  private curveCache = new Map<string, CurveTex>()
  private w = 0
  private h = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src); gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error')
      return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    this.prog = prog
    for (const name of ['uFrame','uLuma','uHueSat','uHasLuma','uHasHueSat','uFlipY','uLift','uGamma','uGain','uOffset','uContrast','uPivot','uTemp','uTint','uSat','uWinShape','uWinCenter','uWinRadii','uWinAngle','uWinSoft','uWinInvert']) {
      this.uni[name] = gl.getUniformLocation(prog, name)
    }

    const mkTex = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.frameTex = mkTex()
    this.ping = [0, 1].map(() => {
      const tex = mkTex()
      const fb = gl.createFramebuffer()!
      return { tex, fb }
    })
    // 1×1 white placeholder for unused curve samplers
    this.neutralTex = mkTex()
    gl.bindTexture(gl.TEXTURE_2D, this.neutralTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]))
  }

  private curveTex(key: string, points: GradeCurvePoint[], neutral: number): WebGLTexture {
    const sig = points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';')
    const hit = this.curveCache.get(key)
    if (hit && hit.sig === sig) return hit.tex
    const gl = this.gl
    const data = sampleCurve(points, 256, neutral)
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = Math.round(data[i] * 255)
    const tex = hit?.tex ?? gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, bytes)
    this.curveCache.set(key, { tex, sig })
    return tex
  }

  private resize(w: number, h: number) {
    if (this.w === w && this.h === h) return
    this.w = w; this.h = h
    const gl = this.gl
    this.canvas.width = w; this.canvas.height = h
    for (const p of this.ping) {
      gl.bindTexture(gl.TEXTURE_2D, p.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.tex, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private setNodeUniforms(node: GradeNode, flipY: boolean) {
    const gl = this.gl, u = this.uni
    const vec = (w: { r: number; g: number; b: number; y: number }) => [w.r + w.y, w.g + w.y, w.b + w.y]
    gl.uniform1i(u.uFlipY, flipY ? 1 : 0)
    gl.uniform3fv(u.uLift,   vec(node.lift))
    gl.uniform3fv(u.uGamma,  vec(node.gamma))
    gl.uniform3fv(u.uGain,   vec(node.gain))
    gl.uniform3fv(u.uOffset, vec(node.offset))
    gl.uniform1f(u.uContrast, node.contrast)
    gl.uniform1f(u.uPivot,    node.pivot)
    gl.uniform1f(u.uTemp,     node.temp)
    gl.uniform1f(u.uTint,     node.tint)
    gl.uniform1f(u.uSat,      node.saturation)

    const hasLuma = !!node.lumaCurve && node.lumaCurve.length >= 2
    const hasHueSat = !!node.hueSat && node.hueSat.length >= 2
    gl.uniform1i(u.uHasLuma, hasLuma ? 1 : 0)
    gl.uniform1i(u.uHasHueSat, hasHueSat ? 1 : 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, hasLuma ? this.curveTex(`${node.id}:luma`, node.lumaCurve!, 0) : this.neutralTex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, hasHueSat ? this.curveTex(`${node.id}:hs`, node.hueSat!, 0.5) : this.neutralTex)

    const win: GradeWindow | null = node.window ?? null
    gl.uniform1i(u.uWinShape, win ? (win.shape === 'ellipse' ? 1 : 2) : 0)
    if (win) {
      gl.uniform2f(u.uWinCenter, win.cx, win.cy)
      gl.uniform2f(u.uWinRadii, Math.max(1e-4, win.rx), Math.max(1e-4, win.ry))
      gl.uniform1f(u.uWinAngle, win.angle)
      gl.uniform1f(u.uWinSoft, Math.max(0.001, win.softness))
      gl.uniform1i(u.uWinInvert, win.invert ? 1 : 0)
    }
  }

  /** Apply active (enabled, non-neutral) nodes to a frame. Returns the shared
   *  output canvas, or null when nothing applies (caller uses the source). */
  apply(frame: TexImageSource, nodes: GradeNode[], w: number, h: number): HTMLCanvasElement | null {
    const active = nodes.filter(n => n.enabled && !gradeNodeIsNeutral(n))
    if (active.length === 0) return null
    const gl = this.gl
    this.resize(w, h)
    gl.useProgram(this.prog)
    gl.uniform1i(this.uni.uFrame, 0)
    gl.uniform1i(this.uni.uLuma, 1)
    gl.uniform1i(this.uni.uHueSat, 2)
    gl.viewport(0, 0, w, h)

    // Upload the source frame
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame)

    // Y-orientation: the uploaded frame stores row 0 at the top (Y-down), so
    // pass 0 samples flipped — after that every intermediate lives in GL's
    // natural orientation and presents correctly on the canvas unflipped.
    // (Identical to how lut-gl's single pass always flips.)
    let srcTex = this.frameTex
    for (let i = 0; i < active.length; i++) {
      const last = i === active.length - 1
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : this.ping[i % 2].fb)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      this.setNodeUniforms(active[i], i === 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      srcTex = this.ping[i % 2].tex
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.canvas
  }
}

let inst: GradeGL | null | undefined
export function getGradeGL(): GradeGL | null {
  if (inst !== undefined) return inst
  try { inst = new GradeGL() } catch { inst = null }
  return inst
}
