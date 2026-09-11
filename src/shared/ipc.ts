export interface CyclePick { shader: string; preset?: string; }
export const IPC = { getConfig:'config:get', setConfig:'config:set', importNoctaliaColors:'colors:import-noctalia', close:'window:close', cycle:'rotation:cycle', audio:'audio:frame', audioSubscribe:'audio:subscribe', audioUnsubscribe:'audio:unsubscribe' } as const;
