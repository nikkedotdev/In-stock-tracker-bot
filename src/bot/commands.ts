import { normaliseUrl } from '../core/url';
import { ValidationError } from '../core/errors';

export type CommandType =
  | 'start'
  | 'help'
  | 'list'
  | 'remove'
  | 'variant'
  | 'end'
  | 'track-url'
  | 'unknown';

export interface CommandResult {
  type: CommandType;
  argument?: string;
}

const URL_REGEX = /https?:\/\/[\w.-]+(?:\/[\w\d./?&%#=+_-]*)?/i;

export async function parseCommand(text?: string): Promise<CommandResult> {
  if (!text) return { type: 'unknown' };
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    const match = trimmed.match(URL_REGEX);
    if (match) {
      const url = match[0];
      try {
        const { normalizedUrl } = await normaliseUrl(url);
        return { type: 'track-url', argument: normalizedUrl };
      } catch (err) {
        throw new ValidationError((err as Error).message || 'Invalid or unsupported URL');
      }
    }
    return { type: 'unknown' };
  }

  const [cmd, ...rest] = trimmed.split(' ');
  const arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case '/start':
      return { type: 'start' };
    case '/help':
      return { type: 'help' };
    case '/list':
      return { type: 'list' };
    case '/remove':
      if (!arg) return { type: 'remove' };
      if (arg.startsWith('#')) {
        const idx = Number(arg.slice(1));
        if (Number.isNaN(idx) || idx < 1) throw new ValidationError('Invalid list number');
        return { type: 'remove', argument: String(idx) };
      }
      return { type: 'remove', argument: arg };
    case '/variant':
      if (rest.length === 0) return { type: 'variant' };
      return { type: 'variant', argument: rest.join(' ') };
    case '/end':
      return { type: 'end' };
    default:
      return { type: 'unknown' };
  }
}
