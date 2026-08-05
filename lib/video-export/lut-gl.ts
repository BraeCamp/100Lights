/**
 * WebGL2 LUT applier — applies a parsed .cube 3D LUT (lib/lut-parser) to a
 * video frame on the GPU. Per-pixel trilinear interpolation comes free from
 * LINEAR filtering on a 3D texture, so this is fast enough to run per frame
 * in both the live preview overlay and the real-time export capture.
 *
 * One shared canvas + program; LUT textures are cached per LutData object.
 * Returns null wherever WebGL2 is unavailable — callers treat that as
 * "LUT unsupported" and skip it rather than falling back to CPU trilinear.
 */

import type { LutData } from '@/lib/lut-parser'

const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Fullscreen triangle
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uFrame;
uniform sampler3D uLut;
uniform float uScale;   // (S-1)/S
uniform float uOffset;  // 1/(2S)
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uFrame, vec2(vUv.x, 1.0 - vUv.y));
  vec3 graded = texture(uLut, clamp(c.rgb, 0.0, 1.0) * uScale + uOffset).rgb;
  outColor = vec4(graded, c.a);
}`

class LutGL {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private frameTex: WebGLTexture
  private lutTexCache = new WeakMap<LutData, WebGLTexture>()
  private uScale: WebGLUniformLocation | null
  private uOffset: WebGLUniformLocation | null

  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = gl

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    gl.useProgram(prog)
    gl.uniform1i(gl.getUniformLocation(prog, 'uFrame'), 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'uLut'), 1)
    this.uScale = gl.getUniformLocation(prog, 'uScale')
    this.uOffset = gl.getUniformLocation(prog, 'uOffset')

    this.frameTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private lutTexture(lut: LutData): WebGLTexture {
    const cached = this.lutTexCache.get(lut)
    if (cached) return cached
    const { gl } = this
    const S = lut.size
    // lut.table is indexed (r*S² + g*S + b)*3; a 3D texture is x-fastest, so
    // texel (x=r, y=g, z=b) lives at ((b*S + g)*S + r)*4 in the upload buffer.
    const buf = new Uint8Array(S * S * S * 4)
    for (let b = 0; b < S; b++) {
      for (let g = 0; g < S; g++) {
        for (let r = 0; r < S; r++) {
          const src = (r * S * S + g * S + b) * 3
          const dst = ((b * S + g) * S + r) * 4
          buf[dst]     = Math.max(0, Math.min(255, Math.round(lut.table[src]     * 255)))
          buf[dst + 1] = Math.max(0, Math.min(255, Math.round(lut.table[src + 1] * 255)))
          buf[dst + 2] = Math.max(0, Math.min(255, Math.round(lut.table[src + 2] * 255)))
          buf[dst + 3] = 255
        }
      }
    }
    const tex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, S, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    this.lutTexCache.set(lut, tex)
    return tex
  }

  /** Draw `source` through `lut` into the shared canvas and return it. */
  apply(source: TexImageSource, lut: LutData, w: number, h: number): HTMLCanvasElement | null {
    if (w <= 0 || h <= 0) return null
    const { gl, canvas } = this
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, w, h)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture(lut))
    gl.uniform1f(this.uScale, (lut.size - 1) / lut.size)
    gl.uniform1f(this.uOffset, 1 / (2 * lut.size))

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    } catch {
      return null   // cross-origin frame or invalid source
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return canvas
  }
}

let singleton: LutGL | null | undefined

/** Shared LutGL instance, or null when WebGL2 is unavailable. */
export function getLutGL(): LutGL | null {
  if (singleton !== undefined) return singleton
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
    singleton = gl ? new LutGL(gl, canvas) : null
  } catch {
    singleton = null
  }
  return singleton
}
