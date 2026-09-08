export {};
declare global { interface Window { scrnsvr:{getConfig:()=>Promise<unknown>;setConfig:(c:unknown)=>Promise<void>;close:()=>void} } }
declare module '*.glsl' { const source:string; export default source; }
declare module '*.frag' { const source:string; export default source; }
