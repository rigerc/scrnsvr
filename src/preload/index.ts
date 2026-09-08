import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
contextBridge.exposeInMainWorld('scrnsvr',{ getConfig:()=>ipcRenderer.invoke(IPC.getConfig), setConfig:(config:unknown)=>ipcRenderer.invoke(IPC.setConfig,config), close:()=>ipcRenderer.send(IPC.close) });
