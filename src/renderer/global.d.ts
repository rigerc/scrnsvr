import type { ScrnsvrApi, ScrnsvrAudioApi } from '../shared/ipc';

export {};
declare global {
  interface Window {
    scrnsvr: ScrnsvrApi;
    scrnsvrAudio?: ScrnsvrAudioApi;
  }
}
declare module '*.glsl' { const source:string; export default source; }
declare module '*.frag' { const source:string; export default source; }
