import type { AudioFrame } from './audio';
import type { Config } from './config';
import type { NoctaliaImportResult } from './noctalia';

/** Public preload contract shared by its implementation and browser consumers. */
export interface ScrnsvrApi {
  getConfig(): Promise<Config>;
  setConfig(config: Config): Promise<void>;
  importNoctaliaColors(): Promise<NoctaliaImportResult>;
  close(): void;
}

export interface ScrnsvrAudioApi {
  subscribe(listener: (frame: AudioFrame) => void): () => void;
}

export const IPC = { getConfig:'config:get', setConfig:'config:set', importNoctaliaColors:'colors:import-noctalia', close:'window:close', audio:'audio:frame', audioSubscribe:'audio:subscribe', audioUnsubscribe:'audio:unsubscribe' } as const;
