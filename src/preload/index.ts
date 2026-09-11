import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CyclePick } from '../shared/ipc';
import type { AudioFrame } from '../shared/audio';
let audioListeners = 0;
contextBridge.exposeInMainWorld('scrnsvrAudio', {
  subscribe: (listener: (frame: AudioFrame) => void) => {
    const handler = (_event: unknown, frame: AudioFrame) => listener(frame);
    ipcRenderer.on(IPC.audio, handler);
    if (++audioListeners === 1) ipcRenderer.send(IPC.audioSubscribe);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener(IPC.audio, handler);
      if (--audioListeners === 0) ipcRenderer.send(IPC.audioUnsubscribe);
    };
  },
});
contextBridge.exposeInMainWorld('scrnsvr',{ getConfig:()=>ipcRenderer.invoke(IPC.getConfig), setConfig:(config:unknown)=>ipcRenderer.invoke(IPC.setConfig,config), importNoctaliaColors:()=>ipcRenderer.invoke(IPC.importNoctaliaColors), close:()=>ipcRenderer.send(IPC.close), onCycle:(listener:(pick:CyclePick)=>void)=>{const handler=(_event: unknown,pick:CyclePick)=>listener(pick);ipcRenderer.on(IPC.cycle,handler);return()=>ipcRenderer.removeListener(IPC.cycle,handler);} });
