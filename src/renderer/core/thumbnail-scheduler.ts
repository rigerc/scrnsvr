import { startLoop } from './loop';

export interface ThumbnailScene {
  draw(delta: number): void;
  dispose(): void;
  resume?(): void;
  suspend?(): void;
}

interface ThumbnailJob {
  create: () => ThumbnailScene;
  scene?: ThumbnailScene;
  previous: number;
  due: number;
}

/** One thumbnail per frame, at most 15 fps per tile and 60 draws/s in total.
 * Compilation is deferred to that same budget. Recently hidden scenes are kept
 * in a bounded LRU so scrolling back doesn't compile them again.
 */
export class ThumbnailScheduler {
  private readonly active = new Map<object, ThumbnailJob>();
  private readonly cached = new Map<object, ThumbnailJob>();
  private stop?: () => void;
  private time = 0;

  constructor(private readonly cacheLimit = 16) {}

  mount(key: object, create: () => ThumbnailScene): () => void {
    const job = this.cached.get(key) ?? { create, previous: this.time, due: this.time };
    this.cached.delete(key);
    job.previous = this.time;
    job.due = this.time;
    job.scene?.resume?.();
    this.active.set(key, job);
    this.stop ??= startLoop(delta => this.tick(delta), 60);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.active.delete(key);
      job.scene?.suspend?.();
      // Tiles scrolled past before their first frame need no cache entry.
      if (job.scene) this.cached.set(key, job);
      while (this.cached.size > this.cacheLimit) {
        const oldest = this.cached.keys().next().value!;
        this.cached.get(oldest)!.scene!.dispose();
        this.cached.delete(oldest);
      }
      if (!this.active.size) {
        this.stop?.();
        this.stop = undefined;
      }
    };
  }

  private tick(delta: number) {
    this.time += delta;
    for (const [key, job] of this.active) {
      if (this.time + 0.01 < job.due) continue;
      // Move this tile to the back of the queue for fair service, including
      // newly visible tiles. A slow shader cannot trigger a catch-up burst.
      this.active.delete(key);
      this.active.set(key, job);
      try {
        const fresh = !job.scene;
        job.scene ??= job.create();
        job.scene.draw(fresh ? 0 : this.time - job.previous);
        job.previous = this.time;
        job.due = this.time + 1000 / 15;
      } catch (error) {
        // A bad custom shader must not stop the other gallery tiles.
        this.active.delete(key);
        job.scene?.dispose();
        job.scene = undefined;
        console.error('Unable to render shader thumbnail', error);
        if (!this.active.size) {
          this.stop?.();
          this.stop = undefined;
        }
      }
      break;
    }
  }

  dispose() {
    this.stop?.();
    this.stop = undefined;
    for (const job of [...this.active.values(), ...this.cached.values()]) {
      job.scene?.dispose();
      job.scene = undefined;
    }
    this.active.clear();
    this.cached.clear();
  }
}
