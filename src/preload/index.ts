import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CyclePick } from '../shared/ipc';
contextBridge.exposeInMainWorld('scrnsvr',{ getConfig:()=>ipcRenderer.invoke(IPC.getConfig), setConfig:(config:unknown)=>ipcRenderer.invoke(IPC.setConfig,config), importNoctaliaColors:()=>ipcRenderer.invoke(IPC.importNoctaliaColors), close:()=>ipcRenderer.send(IPC.close), onCycle:(listener:(pick:CyclePick)=>void)=>{const handler=(_event: unknown,pick:CyclePick)=>listener(pick);ipcRenderer.on(IPC.cycle,handler);return()=>ipcRenderer.removeListener(IPC.cycle,handler);} });
