/** Vaudeville OGL LightRays plus roiling floor fog, sharing one capped 24fps context. */
import { Renderer, Program, Triangle, Mesh } from "ogl";
import { parseHex } from "../../../color";
import { FRAGMENT, VERTEX } from "./shaders";
import { FOG_FRAGMENT } from "./fog-shader";

/** The fixed moment a still frame shows, so every visit draws the same rays. */
const STILL_SECONDS = 4;

/** `animate` false draws ONE frame (and one more after each resize), with no loop and no pointer follow. */
export function startLightRays(canvas: HTMLCanvasElement, followMouse: boolean, mouseInfluence: number, withFog = true, animate = true, rig: 'stage' | 'house' | 'projector' = 'stage'): (() => void) | null {
  let renderer: Renderer;
  try { renderer = new Renderer({ canvas, alpha: true, premultipliedAlpha: true, depth: false, antialias: false, dpr: 1, powerPreference: "low-power", autoClear: false }); }
  catch { return null; }
  const gl = renderer.gl;
  if (!gl) return null;
  let geometry: Triangle | undefined;
  const programs: Program[] = [];
  let frame = 0;
  let stopped = false;
  let detach = (): void => {};
  const release = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    detach();
    canvas.dataset.raysReady = "false";
    gl.useProgram(null);
    programs.forEach(program => { gl.deleteShader(program.vertexShader); gl.deleteShader(program.fragmentShader); program.remove(); });
    geometry?.remove();
  };
  try {
    geometry = new Triangle(gl);
    const styles = getComputedStyle(canvas);
    const rgb = (token: string): [number, number, number] => {
      const parsed = parseHex(styles.getPropertyValue(token));
      if (!parsed) throw new Error("Missing stage color");
      return parsed.map(channel => channel / 255) as [number, number, number];
    };
    const make = (fragment: string, uniforms: Program["uniforms"]): Mesh => {
      const program = new Program(gl, { vertex: VERTEX, fragment, uniforms, transparent: true, depthTest: false, depthWrite: false });
      programs.push(program);
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) throw new Error("Stage shader failed");
      return new Mesh(gl, { geometry, program });
    };
    // Uniforms and ray shaders come from Vaudeville's LightRays component.
    // theme-key-ok: visual rig chooses stage or house palettes, not a theme identifier
    const colors = rig === 'stage' ? ["--premiere-rose", "--premiere-violet"] : rig === 'house' ? ["--premiere-gold", "--premiere-gold"] : ["--premiere-text"];
    const rays = colors.map(token => make(FRAGMENT, {
      iTime: { value: 0 }, iResolution: { value: [1, 1] }, rayPos: { value: [0, 0] }, rayDir: { value: [0, 1] },
      raysColor: { value: rgb(token) }, raysSpeed: { value: .25 }, lightSpread: { value: rig === 'projector' ? .24 : .10 }, rayLength: { value: 3 },
      pulsating: { value: 0 }, fadeDistance: { value: 1 }, saturation: { value: 1 }, mousePos: { value: [.5, .5] },
      mouseInfluence: { value: 0 }, noiseAmount: { value: .015 }, distortion: { value: .03 }, isStatic: { value: 0 },
    }));
    const fog = withFog ? [make(FOG_FRAGMENT, { iTime: { value: 0 }, iResolution: { value: [1, 1] }, fogColor: { value: rgb("--premiere-text") } })] : [];
    const meshes = [...rays, ...fog];
    const mouse = { x: .5, y: .5 };
    const smoothMouse = { ...mouse };
    let hasMouse = false;
    let bounds = canvas.getBoundingClientRect();
    const pointer = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse" || !bounds.width || !bounds.height) return;
      hasMouse = true;
      mouse.x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      mouse.y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    };
    const paint = (seconds: number): void => {
      gl.clear(gl.COLOR_BUFFER_BIT);
      meshes.forEach(mesh => {
        mesh.program.uniforms.iTime.value = seconds;
        renderer.render({ scene: mesh, clear: false });
      });
    };
    const resize = (): void => {
      bounds = canvas.getBoundingClientRect();
      const { width, height } = bounds;
      if (!width || !height || stopped) return;
      const scale = Math.min(1, 640 / width, 640 / height);
      renderer.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const ratio = width / height;
      const anchors = rig === 'house' ? [.07, .93] : rig === 'projector' ? [.5] : ratio >= 2 ? [.28, .71] : ratio <= .8 ? [.26, .72] : [.35, .68];
      meshes.forEach(mesh => { mesh.program.uniforms.iResolution.value = [canvas.width, canvas.height]; });
      rays.forEach((mesh, index) => { mesh.program.uniforms.rayPos.value = [anchors[index]! * canvas.width, -.2 * canvas.height]; });
      if (rig === 'house') rays.forEach((mesh, index) => { mesh.program.uniforms.rayDir.value = [index === 0 ? .4 : -.4, 1]; });
      if (!animate && !gl.isContextLost()) paint(STILL_SECONDS);
    };
    let previous = 0;
    const draw = (now: number): void => {
      if (stopped || document.hidden || gl.isContextLost()) return;
      if (now - previous >= 1000 / 24) {
        previous = now;
        if (followMouse && hasMouse) {
          smoothMouse.x += (mouse.x - smoothMouse.x) * .18;
          smoothMouse.y += (mouse.y - smoothMouse.y) * .18;
          rays.forEach(mesh => {
            mesh.program.uniforms.mousePos.value = [smoothMouse.x, smoothMouse.y];
            mesh.program.uniforms.mouseInfluence.value = mouseInfluence;
          });
        }
        paint(now / 1000);
      }
      frame = requestAnimationFrame(draw);
    };
    const visibility = (): void => {
      cancelAnimationFrame(frame);
      if (animate && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize);
    const lost = (): void => { release(); };
    observer.observe(canvas);
    document.addEventListener("visibilitychange", visibility);
    canvas.addEventListener("webglcontextlost", lost);
    if (followMouse && animate) window.addEventListener("pointermove", pointer);
    detach = () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); canvas.removeEventListener("webglcontextlost", lost); window.removeEventListener("pointermove", pointer); };
    resize();
    if (animate) frame = requestAnimationFrame(draw);
    canvas.dataset.raysReady = "true";
    return release;
  } catch { release(); return null; }
}
