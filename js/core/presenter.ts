import type { RenderPresenter } from './types';

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_crt;
uniform float u_noise;
varying vec2 v_uv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 centered = v_uv - 0.5;
  float r2 = dot(centered, centered);

  // Potard GPU : même à 0 le look a une identité (lentille + phosphore),
  // à 1 il reste lisible — plus d'aberration / vignette qui noient le jeu.
  float gpu = mix(0.28, 1.0, clamp(u_intensity, 0.0, 1.0));

  float barrel = gpu * 0.07;
  vec2 warped = centered * (1.0 + barrel * r2) * 0.985;
  vec2 baseUv = clamp(warped + 0.5, 0.0, 1.0);

  float split = gpu * (0.0011 + r2 * 0.0024);
  vec2 dir = normalize(centered + vec2(0.0001));
  vec3 color = vec3(
    texture2D(u_scene, clamp(baseUv + dir * split, 0.0, 1.0)).r,
    texture2D(u_scene, baseUv).g,
    texture2D(u_scene, clamp(baseUv - dir * split, 0.0, 1.0)).b
  );

  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * luma * gpu * 0.055;
  color *= mix(vec3(1.0), vec3(1.035, 1.0, 0.975), gpu * 0.4);

  float vig = 1.0 - r2 * (0.12 + gpu * 0.16);
  color *= mix(1.0, clamp(vig, 0.72, 1.0), 0.9);

  if (u_crt > 0.001) {
    float crt = clamp(u_crt, 0.0, 1.0);
    float py = baseUv.y * u_resolution.y;
    float scan = 0.82 + 0.18 * sin(py * 3.14159265);
    color *= mix(1.0, scan, crt * 0.72);
    float px = baseUv.x * u_resolution.x;
    float mask = 0.94 + 0.06 * sin(px * 2.094395);
    color *= mix(1.0, mask, crt * 0.28);
    float roll = fract(baseUv.y * 0.28 + u_time * 0.035);
    float bar = smoothstep(0.0, 0.03, roll) * (1.0 - smoothstep(0.03, 0.08, roll));
    color += vec3(0.55, 0.82, 1.0) * bar * crt * 0.028;
  }

  if (u_noise > 0.001) {
    float n = hash21(gl_FragCoord.xy + vec2(u_time * 47.0, u_time * 19.0));
    float grain = (n - 0.5) * clamp(u_noise, 0.0, 1.0) * 0.04 * (0.4 + luma * 0.6);
    color += grain;
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

interface GpuResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  position: number;
  scene: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  intensity: WebGLUniformLocation | null;
  crt: WebGLUniformLocation | null;
  noise: WebGLUniformLocation | null;
}

type Context = WebGLRenderingContext | WebGL2RenderingContext;

function shader(gl: Context, type: number, source: string): WebGLShader | null {
  const value = gl.createShader(type);
  if (!value) return null;
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    gl.deleteShader(value);
    return null;
  }
  return value;
}

function link(gl: Context): WebGLProgram | null {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** Présentation plein écran optionnelle ; aucun état de simulation ne transite par WebGL. */
export class WebGLPresenter implements RenderPresenter {
  readonly canvas: HTMLCanvasElement;
  available = false;
  private activeValue = false;
  private gl: Context | null = null;
  private resources: GpuResources | null = null;
  private readonly onLost: () => void;
  private readonly onRestored: () => void;

  constructor(reference: HTMLCanvasElement, onLost: () => void = () => {}, onRestored: () => void = () => {}) {
    this.onLost = onLost;
    this.onRestored = onRestored;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gpu-presenter';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.visibility = 'hidden';
    this.canvas.style.borderRadius = getComputedStyle(reference).borderRadius;
    this.canvas.style.boxShadow = getComputedStyle(reference).boxShadow;
    const parent = reference.parentElement || document.body;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.activeValue = false;
      this.available = false;
      this.gl = null;
      this.resources = null;
      this.canvas.style.visibility = 'hidden';
      this.onLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.initialize();
      this.onRestored();
    });
    this.initialize();
  }

  get active(): boolean {
    return this.activeValue && !!this.resources;
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  present(source: CanvasImageSource, time: number, intensity = 0.45, crt = 0, noise = 0): void {
    const gl = this.gl;
    const resources = this.resources;
    if (!this.active || !gl || !resources) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(resources.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.enableVertexAttribArray(resources.position);
    gl.vertexAttribPointer(resources.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    // CanvasImageSource utilise une origine en haut à gauche, alors que les
    // coordonnées de texture WebGL partent du bas à gauche.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.uniform1i(resources.scene, 0);
    gl.uniform2f(resources.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(resources.time, time);
    gl.uniform1f(resources.intensity, Math.max(0, Math.min(1, intensity)));
    gl.uniform1f(resources.crt, Math.max(0, Math.min(1, crt)));
    gl.uniform1f(resources.noise, Math.max(0, Math.min(1, noise)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  enable(enabled: boolean): void {
    this.activeValue = enabled && this.available;
    this.canvas.style.visibility = this.active ? 'visible' : 'hidden';
  }

  dispose(): void {
    if (this.gl && this.resources) {
      this.gl.deleteTexture(this.resources.texture);
      this.gl.deleteBuffer(this.resources.buffer);
      this.gl.deleteProgram(this.resources.program);
    }
    this.resources = null;
    this.gl = null;
    this.available = false;
    this.activeValue = false;
    this.canvas.remove();
  }

  private initialize(): void {
    const gl = (this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
      || this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false })) as Context | null;
    if (!gl) {
      this.available = false;
      this.resources = null;
      return;
    }
    const program = link(gl);
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    if (!program || !buffer || !texture) {
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
      this.available = false;
      this.resources = null;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.gl = gl;
    this.resources = {
      program,
      buffer,
      texture,
      position: gl.getAttribLocation(program, 'a_position'),
      scene: gl.getUniformLocation(program, 'u_scene'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      crt: gl.getUniformLocation(program, 'u_crt'),
      noise: gl.getUniformLocation(program, 'u_noise'),
    };
    this.available = true;
  }
}
