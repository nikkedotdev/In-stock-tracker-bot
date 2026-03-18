import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('worker scheduled handler', () => {
  it('runs cron inline instead of deferring it with waitUntil', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('ctx.waitUntil(handleCron(env));');
    expect(source).toContain('await handleCron(env);');
  });
});
