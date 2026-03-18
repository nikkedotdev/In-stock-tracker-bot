interface RateLimiterOptions {
  perHost: number;
  global: number;
  minGapMs: number;
}

export class RateLimiter {
  private hostCounts = new Map<string, number>();
  private hostLast = new Map<string, number>();
  private globalActive = 0;

  constructor(private opts: RateLimiterOptions) {}

  async schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(host);
    try {
      await this.waitGap(host);
      const result = await task();
      this.hostLast.set(host, Date.now());
      return result;
    } finally {
      this.release(host);
    }
  }

  private async acquire(host: string) {
    for (;;) {
      const hostCount = this.hostCounts.get(host) ?? 0;
      if (hostCount < this.opts.perHost && this.globalActive < this.opts.global) {
        this.hostCounts.set(host, hostCount + 1);
        this.globalActive += 1;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private release(host: string) {
    const hostCount = (this.hostCounts.get(host) ?? 1) - 1;
    if (hostCount <= 0) this.hostCounts.delete(host);
    else this.hostCounts.set(host, hostCount);
    this.globalActive = Math.max(0, this.globalActive - 1);
  }

  private async waitGap(host: string) {
    const last = this.hostLast.get(host) ?? 0;
    const delta = Date.now() - last;
    const waitMs = this.opts.minGapMs - delta;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
