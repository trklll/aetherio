import { useEffect, useRef, type CSSProperties } from "react";
import { sportsFlagPalette } from "./sportsFlagPalette";
import { SportsFlagCloth } from "./SportsFlagCloth";
import "./SportsFlag.css";

const VERTEX = `attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
uniform vec3 u_home;
uniform vec3 u_away;
varying vec3 v_color;
void main() {
  // Normals come from the actual simulated mesh, not a prescribed wave.
  vec3 normal = a_normal.z < 0. ? -a_normal : a_normal;
  vec3 light = normalize(vec3(-.65, .4, .65));
  float diffuse = max(dot(normal, light), 0.);
  float sheen = max(dot(normal, normalize(light + vec3(0., 0., 1.))), 0.);
  sheen *= sheen; sheen *= sheen; sheen *= sheen;
  float shade = .48 + diffuse * .5;
  sheen *= .06;
  vec3 pigment = mix(u_home, u_away, smoothstep(.22, .78, a_uv.x));
  // Smooth material/color evaluation belongs on the dense render mesh, not
  // in millions of fragment invocations. Rasterization interpolates the RGB.
  v_color = pigment * (shade + sheen * .8) + vec3(sheen * .2);
  // This is a window into the cloth, not a flying rectangular object. Keep
  // the viewport covered while the solver's local folds move inside it.
  vec2 clip = vec2(a_uv.x * 2. - 1., 1. - a_uv.y * 2.);
  vec2 rest = vec2((a_uv.x - .5) * 4.8, (.5 - a_uv.y) * 3.);
  float inset = sin(a_uv.x * 3.14159265) * sin(a_uv.y * 3.14159265);
  clip += clamp(a_position.xy - rest, vec2(-.15), vec2(.15)) * .16 * inset;
  clip.x += clamp(a_position.z, -.5, .5) * .035 * inset;
  gl_Position = vec4(clip, clamp(-a_position.z * .1, -.9, .9), 1.);
}`;
const FRAGMENT = `precision highp float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.);
}`;

function hslToRgb(value: string): [number, number, number] {
  const match = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(value);
  if (!match) return [0.18, 0.19, 0.2];
  const hue = ((Number(match[1]) % 360) + 360) % 360 / 30;
  const saturation = Number(match[2]) / 100;
  const lightness = Number(match[3]) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue) % 12;
    return lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

/** One cloth renderer and rest pose; only the selected preview or active detail animates. */
export default function SportsFlag({ home, away, animated = false, stableBackingWidth, stableBackingHeight }: { home: string; away: string; animated?: boolean; stableBackingWidth?: number; stableBackingHeight?: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backingSizeRef = useRef({ width: stableBackingWidth, height: stableBackingHeight });
  backingSizeRef.current = { width: stableBackingWidth, height: stableBackingHeight };
  const resizeCurrentRef = useRef<(() => void) | undefined>(undefined);
  const updateVisibilityRef = useRef<(() => void) | undefined>(undefined);
  const animatedRef = useRef(animated);
  animatedRef.current = animated;
  const palette = sportsFlagPalette(home, away);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dispose = () => {};
    const start = () => {
      dispose();
      resizeCurrentRef.current = undefined;
      root.dataset.flagMotion = "still";
      root.dataset.flagReady = "false";
      // Hidden carousel entries must not allocate GPU contexts at all.
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "high-performance", desynchronized: true });
      if (!gl) return;
      const shaders: WebGLShader[] = [];
      const shader = (type: number, source: string) => {
        const result = gl.createShader(type);
        if (!result) return null;
        shaders.push(result); gl.shaderSource(result, source); gl.compileShader(result);
        return gl.getShaderParameter(result, gl.COMPILE_STATUS) ? result : null;
      };
      const vertex = shader(gl.VERTEX_SHADER, VERTEX);
      const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
      const program = gl.createProgram();
      if (!program || !vertex || !fragment) {
        shaders.forEach(value => gl.deleteShader(value));
        if (program) gl.deleteProgram(program);
        return;
      }
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program); return;
      }
      gl.useProgram(program);
      gl.uniform3fv(gl.getUniformLocation(program, "u_home"), hslToRgb(palette.home));
      gl.uniform3fv(gl.getUniformLocation(program, "u_away"), hslToRgb(palette.away));
      const cloth = new SportsFlagCloth();
      const vertexBuffer = gl.createBuffer();
      const indexBuffer = gl.createBuffer();
      if (!vertexBuffer || !indexBuffer) {
        if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
        if (indexBuffer) gl.deleteBuffer(indexBuffer);
        shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program); return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cloth.vertices.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cloth.indices, gl.STATIC_DRAW);
      for (const [name, size, offset] of [["a_position", 3, 0], ["a_normal", 3, 12], ["a_uv", 2, 24]] as const) {
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
      }
      const homeRgb = hslToRgb(palette.home), awayRgb = hslToRgb(palette.away);
      gl.clearColor((homeRgb[0] + awayRgb[0]) * .35, (homeRgb[1] + awayRgb[1]) * .35, (homeRgb[2] + awayRgb[2]) * .35, 1);
      // The window projection is non-overlapping; a depth buffer adds a full
      // per-pixel read/write without contributing to the visible cloth.
      gl.disable(gl.DEPTH_TEST);
      let previousFrame: number | undefined;
      let frameRequest: number | undefined;
      let visible = true;
      let contextLost = false;
      const moving = () => animatedRef.current && !reducedMotion.matches;
      const paint = () => {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, cloth.writeVertices());
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLES, cloth.indices.length, gl.UNSIGNED_SHORT, 0);
        root.dataset.flagReady = "true";
      };
      const draw = (timestamp: number) => {
        frameRequest = undefined;
        if (!visible || document.hidden || contextLost) return;
        if (previousFrame !== undefined) cloth.advance((timestamp - previousFrame) / 1000);
        previousFrame = timestamp;
        paint();
        frameRequest = requestAnimationFrame(draw);
      };
      const resize = () => {
        if (contextLost || !canvas.clientWidth || !canvas.clientHeight) return;
        // The shell supplies a stable target size for each settled stage. Its
        // card morph and expansion therefore scale one native-quality buffer
        // instead of reallocating it on every tween frame.
        const backingSize = backingSizeRef.current;
        const layoutWidth = backingSize.width && backingSize.height ? backingSize.width : canvas.clientWidth;
        const layoutHeight = backingSize.width && backingSize.height ? backingSize.height : canvas.clientHeight;
        // Preserve native Full HD in motion too; optimize the draw pipeline,
        // not by enlarging a low-resolution canvas across the window.
        const scale = Math.min(window.devicePixelRatio || 1, 2, 2048 / layoutWidth, 1440 / layoutHeight);
        const width = Math.max(1, Math.round(layoutWidth * scale));
        const height = Math.max(1, Math.round(layoutHeight * scale));
        if (canvas.width === width && canvas.height === height) return;
        canvas.width = width; canvas.height = height;
        gl.viewport(0, 0, canvas.width, canvas.height);
        // A running rAF already paints this frame. Resizing during shell
        // expansion must not submit a second full-resolution draw each tick.
        if (!moving() || frameRequest === undefined) paint();
      };
      resize();
      paint();
      resizeCurrentRef.current = resize;
      const updateVisibility = () => {
        const shouldRun = moving() && visible && !document.hidden && !contextLost;
        if (shouldRun && frameRequest === undefined) {
          previousFrame = undefined;
          root.dataset.flagMotion = "running";
          frameRequest = requestAnimationFrame(draw);
        } else if (!shouldRun) {
          if (frameRequest !== undefined) cancelAnimationFrame(frameRequest);
          frameRequest = undefined;
          previousFrame = undefined;
          root.dataset.flagMotion = !moving() || contextLost ? "still" : "paused";
        }
      };
      updateVisibilityRef.current = updateVisibility;
      const observer = new IntersectionObserver(entries => {
        visible = entries[0]?.isIntersecting ?? false;
        if (!visible && !contextLost) {
          const contextControl = gl.getExtension("WEBGL_lose_context");
          if (contextControl) {
            contextLost = true;
            updateVisibility();
            contextControl.loseContext();
            return;
          }
        } else if (visible && contextLost) {
          gl.getExtension("WEBGL_lose_context")?.restoreContext();
        }
        updateVisibility();
      });
      observer.observe(canvas);
      document.addEventListener("visibilitychange", updateVisibility);
      const onContextLost = (event: Event) => {
        event.preventDefault(); contextLost = true; updateVisibility();
      };
      const onContextRestored = () => { contextLost = false; start(); };
      canvas.addEventListener("webglcontextlost", onContextLost);
      canvas.addEventListener("webglcontextrestored", onContextRestored);
      updateVisibility();
      dispose = () => {
        if (frameRequest !== undefined) cancelAnimationFrame(frameRequest);
        observer.disconnect();
        document.removeEventListener("visibilitychange", updateVisibility);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        if (updateVisibilityRef.current === updateVisibility) updateVisibilityRef.current = undefined;
        gl.deleteBuffer(vertexBuffer); gl.deleteBuffer(indexBuffer);
        shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program);
        root.dataset.flagMotion = "still";
        // Wait for React's detach: palette changes and StrictMode replay keep
        // this canvas connected and must not lose a context we will reuse.
        queueMicrotask(() => {
          if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
        });
      };
    };
      const resizeObserver = new ResizeObserver(() => {
        if (resizeCurrentRef.current) {
          if (!backingSizeRef.current.width || !backingSizeRef.current.height) resizeCurrentRef.current();
        } else start();
      });
      resizeObserver.observe(canvas);
      start(); reducedMotion.addEventListener("change", start);
    return () => {
      resizeObserver.disconnect();
      reducedMotion.removeEventListener("change", start);
      dispose();
      resizeCurrentRef.current = undefined;
    };
  }, [palette.home, palette.away]);

  useEffect(() => { resizeCurrentRef.current?.(); }, [stableBackingWidth, stableBackingHeight]);
  useEffect(() => { updateVisibilityRef.current?.(); }, [animated]);

  return <div ref={rootRef} className="sports-flag" data-flag-motion="still" aria-hidden="true" style={{ "--flag-home": palette.home, "--flag-away": palette.away } as CSSProperties}>
    <canvas ref={canvasRef} className="sports-flag__canvas" />
  </div>;
}
