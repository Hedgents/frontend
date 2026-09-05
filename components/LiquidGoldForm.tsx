"use client";

/*
 * Adapted from ThreeUI Community's LiquidFormBackground.
 * Copyright (c) 2026 Meng To. Used under the MIT License.
 * https://github.com/MengTo/threeui
 */
import { useEffect, useRef } from "react";

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main(){gl_Position=vec4(a_pos,0.0,1.0);}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;

#define MAX_STEPS 64
#define MAX_DIST 20.0
#define SURF_DIST 0.003

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float map(vec3 p,float t){
  float morph=snoise(p*.8+t*.1)*.2;
  morph+=snoise(p*1.5-t*.05+10.0)*.08;
  morph+=snoise(p*3.0+t*.02)*.02;
  return length(p)-1.8+morph;
}

vec3 normalAt(vec3 p,float t){
  vec2 e=vec2(.003,0.0);
  return normalize(vec3(
    map(p+e.xyy,t)-map(p-e.xyy,t),
    map(p+e.yxy,t)-map(p-e.yxy,t),
    map(p+e.yyx,t)-map(p-e.yyx,t)
  ));
}

void main(){
  vec2 uv=(gl_FragCoord.xy-u_res*.5)/min(u_res.x,u_res.y);
  float t=u_time*.8;
  vec2 m=u_mouse*.1;
  vec3 ro=vec3(0.0,0.0,5.5);
  vec3 target=vec3(m.x,m.y,0.0);
  vec3 fwd=normalize(target-ro);
  vec3 right=normalize(cross(vec3(0.0,1.0,0.0),fwd));
  vec3 up=cross(fwd,right);
  vec3 rd=normalize(fwd+uv.x*right+uv.y*up);
  vec3 col=mix(vec3(.006,.007,.005),vec3(.025,.021,.012),length(uv)*.35);
  float d=0.0;
  for(int i=0;i<MAX_STEPS;i++){
    vec3 p=ro+rd*d;
    float stepDistance=map(p,t);
    d+=stepDistance;
    if(d>MAX_DIST||abs(stepDistance)<SURF_DIST)break;
  }
  if(d<MAX_DIST){
    vec3 p=ro+rd*d;
    vec3 n=normalAt(p,t);
    vec3 reflected=reflect(rd,n);
    float fresnel=mix(.28,1.0,pow(1.0-max(dot(n,-rd),0.0),4.0));
    vec3 key=normalize(vec3(.5+u_mouse.x,1.0,1.2));
    vec3 rim=normalize(vec3(-.8,-.2,-1.0));
    float keyLight=pow(max(dot(reflected,key),0.0),12.0);
    float rimLight=pow(max(dot(reflected,rim),0.0),6.0);
    vec3 darkGold=vec3(.12,.072,.018);
    vec3 brightGold=vec3(1.0,.67,.19);
    col=mix(darkGold,brightGold,keyLight)*fresnel;
    col+=vec3(.54,.28,.055)*rimLight*.7;
    col+=vec3(1.0,.82,.42)*pow(max(dot(reflected,key),0.0),58.0)*1.4;
  }
  col=col/(col+.55);
  col=pow(col,vec3(1.0/2.2));
  gl_FragColor=vec4(col,1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create liquid-gold shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Liquid-gold shader compilation failed.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function LiquidGoldForm({ className = "", active = false }: { className?: string; active?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl) return undefined;

    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    try {
      vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error("Unable to create liquid-gold program.");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "Liquid-gold program link failed.");
      }
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "a_pos");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    } catch {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return undefined;
    }

    const resolution = gl.getUniformLocation(program, "u_res");
    const time = gl.getUniformLocation(program, "u_time");
    const mouse = gl.getUniformLocation(program, "u_mouse");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let targetX = 0;
    let targetY = 0;
    let mouseX = 0;
    let mouseY = 0;
    let frame = 0;
    let visible = true;
    const startedAt = performance.now();

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      targetX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      targetY = -(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1);
    };
    const render = (now: number) => {
      mouseX += (targetX - mouseX) * 0.045;
      mouseY += (targetY - mouseY) * 0.045;
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, (now - startedAt) * 0.001 * (activeRef.current ? 1.2 : 0.32));
      gl.uniform2f(mouse, mouseX, mouseY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frame = visible && !document.hidden && !reducedMotion ? requestAnimationFrame(render) : 0;
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !frame && !reducedMotion) frame = requestAnimationFrame(render);
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });

    resizeObserver.observe(host);
    intersection.observe(host);
    if (!reducedMotion) canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    resize();
    frame = requestAnimationFrame(render);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    };
  }, []);

  return <div ref={hostRef} className={className}><canvas ref={canvasRef} /></div>;
}
