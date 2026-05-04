/**
 * FIFO job queue with a configurable concurrency cap. Used to keep a weak server from
 * being pinned by N parallel ffmpeg post-processors when a season pack finishes.
 *
 * Keys are opaque strings the caller chooses; useful for asking "is this specific
 * job queued / running right now?" via {@link isQueued} / {@link isRunning}.
 */
export class JobQueue {
  private concurrency: number;
  private running = new Set<string>();
  private pending: Array<{
    key: string;
    fn: () => Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  }> = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  enqueue(key: string, fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ key, fn, resolve, reject });
      this.tick();
    });
  }

  isQueued(key: string): boolean {
    return this.pending.some((p) => p.key === key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.tick();
  }

  stats(): { running: number; queued: number; concurrency: number } {
    return {
      running: this.running.size,
      queued: this.pending.length,
      concurrency: this.concurrency,
    };
  }

  private tick(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.running.add(job.key);
      job
        .fn()
        .then(
          () => job.resolve(),
          (err) => job.reject(err),
        )
        .finally(() => {
          this.running.delete(job.key);
          this.tick();
        });
    }
  }
}
