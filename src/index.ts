import { handleTelegramWebhook } from './bot/router';
import { handleCron } from './checker/scheduler';
import { EnvBindings } from './core/types';
import { logger, LogLevel } from './core/logging';
import { D1Client } from './db/d1';
import { runMigrations } from './db/migrations';

let migrationPromise: Promise<void> | null = null;

async function ensureMigrations(env: EnvBindings) {
  if (!migrationPromise) {
    migrationPromise = runMigrations(new D1Client(env.D1_DB));
  }
  await migrationPromise;
}

function setLogLevel(env: EnvBindings) {
  const level = env.LOG_LEVEL;
  if (level && level !== '') {
    const normalized = level.toLowerCase() as LogLevel;
    logger.setLevel(normalized);
  }
}

export default {
  async fetch(request: Request, env: EnvBindings, ctx: ExecutionContext): Promise<Response> {
    setLogLevel(env);
    ctx.waitUntil(ensureMigrations(env));

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/telegram') {
      await ensureMigrations(env);
      return handleTelegramWebhook(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/cron') {
      await ensureMigrations(env);
      return handleCron(env);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: EnvBindings) {
    setLogLevel(env);
    await ensureMigrations(env);
    await handleCron(env);
  },
};
