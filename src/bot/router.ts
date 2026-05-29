import { BotHandler } from './handlers';
import { TrackRepository } from '../db/repos';
import { D1Client } from '../db/d1';
import { EnvBindings, TelegramUpdate } from '../core/types';

export async function handleTelegramWebhook(request: Request, env: EnvBindings): Promise<Response> {
  const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secretHeader || secretHeader !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }
  const payload = (await request.json().catch(() => ({}))) as TelegramUpdate;
  const repo = new TrackRepository(new D1Client(env.D1_DB));
  const handler = new BotHandler({ repo, env });
  return handler.handle(payload);
}
