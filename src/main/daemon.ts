import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { powerMonitor } from 'electron';
import { shouldInhibitScreensaver } from './inhibit';

const execFileAsync = promisify(execFile);

export interface RendererChild { once(event: 'exit' | 'closed', listener: () => void): unknown; kill?(): void; }
export interface IdleDaemonOptions {
  thresholdSeconds?: number;
  pollIntervalMs?: number;
  idleSeconds?: () => number;
  launchRenderer: () => RendererChild | Promise<RendererChild>;
  inhibited?: () => boolean | Promise<boolean>;
  log?: (message: string, ...args: unknown[]) => void;
}

/** Idle launcher shared by the desktop entry point and the user service. */
export class IdleDaemon {
  private timer?: NodeJS.Timeout;
  private child?: RendererChild;
  private stopped = true;
  private suppressUntil = 0;
  private polling = false;
  private readonly options: Required<Pick<IdleDaemonOptions, 'thresholdSeconds' | 'pollIntervalMs'>> & IdleDaemonOptions;

  constructor(options: IdleDaemonOptions) {
    this.options = { thresholdSeconds: 300, pollIntervalMs: 7000, ...options };
    if (this.options.pollIntervalMs < 5000 || this.options.pollIntervalMs > 10000) throw new Error('pollIntervalMs must be between 5000 and 10000');
  }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => this.poll(), this.options.pollIntervalMs);
  }
  stop(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.child?.kill?.(); this.child = undefined; }
  /** Resume events reset the idle epoch and prevent an immediate relaunch. */
  onResume(): void { this.suppressUntil = Date.now() + this.options.pollIntervalMs; this.options.log?.('system resumed; idle launch suppressed for one poll'); }
  private async poll(): Promise<void> {
    if (this.stopped || this.child || this.polling || Date.now() <= this.suppressUntil) return;
    this.polling = true;
    let idle: number;
    try { idle = await readIdleSeconds(this.options.idleSeconds, this.options.log); }
    catch (error) { this.options.log?.('idle read failed', error); this.polling = false; return; }
    if (idle < this.options.thresholdSeconds) { this.polling = false; return; }
    try {
      if (await this.options.inhibited?.()) {
        this.options.log?.('screensaver inhibited (audio/fullscreen); skipping launch');
        this.polling = false;
        return;
      }
    } catch (error) { this.options.log?.('inhibit check failed', error); }
    this.options.log?.('idle threshold reached (%ss), launching renderer', idle);
    try {
      const child = await this.options.launchRenderer();
      if (this.stopped) { child.kill?.(); return; }
      this.child = child;
      const resume = () => { if (this.child === child) this.child = undefined; };
      child.once('exit', resume); child.once('closed', resume);
    } catch (error) { this.options.log?.('renderer launch failed', error); }
    finally { this.polling = false; }
  }
}

async function readIdleSeconds(primary: (() => number) | undefined, log = console.warn): Promise<number> {
  if (primary) return primary();
  try { return powerMonitor.getSystemIdleTime(); }
  catch (error) { log('Electron idle API unavailable; probing logind fallback', error); return readLogindIdleSeconds(log); }
}

/** logind is a capability fallback for Wayland sessions; compositor APIs are never required. */
export async function readLogindIdleSeconds(log: (...args: unknown[]) => void = console.warn): Promise<number> {
  try {
    const session = process.env.XDG_SESSION_ID;
    if (!session) return 0;
    const { stdout: pathOutput } = await execFileAsync('busctl', ['--system', 'call', 'org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', 'GetSession', 's', session], { timeout: 1000 });
    const sessionPath = pathOutput.trim().split(/\s+/).pop()?.replace(/^"|"$/g, '');
    if (!sessionPath?.startsWith('/')) return 0;
    const { stdout } = await execFileAsync('busctl', ['--system', 'get-property', 'org.freedesktop.login1', sessionPath, 'org.freedesktop.login1.Session', 'IdleSinceHintMonotonic'], { timeout: 1000 });
    const value = Number(stdout.trim().split(/\s+/).pop());
    if (Number.isFinite(value) && value > 0) return Math.max(0, Number(process.hrtime.bigint() / 1000n - BigInt(value)) / 1e6);
  } catch (error) { log('logind idle capability unavailable', error); }
  return 0;
}

export function attachPowerResume(daemon: IdleDaemon): () => void {
  const listener = () => daemon.onResume();
  powerMonitor.on('resume', listener);
  return () => powerMonitor.removeListener('resume', listener);
}
