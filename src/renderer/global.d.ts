export {};
declare global { interface Window { scrnsvrAudio?: { subscribe: (listener: (frame: import('../shared/audio').AudioFrame) => void) => () => void } } }
declare global { interface Window { scrnsvr:{getConfig:()=>Promise<unknown>;setConfig:(c:unknown)=>Promise<void>;importNoctaliaColors:()=>Promise<import('../shared/noctalia').NoctaliaImportResult>;close:()=>void;onCycle?:(listener:(pick:import('../shared/ipc').CyclePick)=>void)=>()=>void} } }
declare module '*.glsl' { const source:string; export default source; }
declare module '*.frag' { const source:string; export default source; }
