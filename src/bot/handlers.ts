import { TrackRepository } from '../db/repos';
import { MAX_ACTIVE_TRACKS_PER_USER } from '../core/config';
import { normaliseUrl } from '../core/url';
import { formatEndConfirmation, formatHelpMessage, formatList, formatRemoveConfirmation, formatRemovePrompt, formatStartMessage, formatTrackingAck, formatVariantPrompt } from './formatter';
import { getTrackDisplayLabel, getTrackDisplayName } from './labels';
import { parseCommand } from './commands';
import { ensureCallbackQuery, ensureMessage } from './validation';
import { Track, EnvBindings, TelegramUpdate, VariantOption } from '../core/types';
import { logger } from '../core/logging';
import { ValidationError } from '../core/errors';
import { recordAudit } from '../telemetry/audit';
import { recordMetric } from '../telemetry/metrics';
import { previewProduct } from './preview';
import { hasDedicatedProfile } from '../profiles';

export interface HandlerDeps {
  repo: TrackRepository;
  env: EnvBindings;
}

export class BotHandler {
  constructor(private deps: HandlerDeps) {}

  async handle(update: TelegramUpdate): Promise<Response> {
    let chatId: number | null = null;
    let userId: number | null = null;
    let text: string | undefined;
    let command;

    try {
      if (update.callback_query) {
        const callback = ensureCallbackQuery(update);
        chatId = callback.chatId;
        userId = callback.userId;
        const tgId = String(userId);
        const userDbId = await this.deps.repo.upsertUser(tgId);
        await this.handleCallbackAction(userDbId, callback);
        return new Response('ok', { status: 200 });
      }

      ({ chatId, userId, text } = ensureMessage(update));
      command = await parseCommand(text);
      const tgId = String(userId);
      const userDbId = await this.deps.repo.upsertUser(tgId);
      switch (command.type) {
        case 'start':
          await sendTelegramMessage(this.deps.env, chatId, formatStartMessage());
          break;
        case 'help':
          await sendTelegramMessage(this.deps.env, chatId, formatHelpMessage());
          break;
        case 'list':
          await this.sendList(chatId, userDbId);
          break;
        case 'remove':
          await this.handleRemove(chatId, userDbId, command.argument);
          break;
        case 'variant':
          await this.handleVariant(chatId, userDbId, command.argument);
          break;
        case 'end':
          await this.handleEnd(chatId, userDbId);
          break;
        case 'track-url':
          if (!command.argument) throw new ValidationError('Missing URL');
          await this.handleTrack(chatId, userDbId, command.argument);
          break;
        default:
          await sendTelegramMessage(this.deps.env, chatId, 'Send me a product URL to begin.');
      }
      return new Response('ok', { status: 200 });
    } catch (err) {
      if (err instanceof ValidationError) {
        logger.warn('Validation error', { message: err.message });
        if (chatId !== null) {
          await sendTelegramMessage(this.deps.env, chatId, err.message);
        }
        return new Response('ignored', { status: 200 });
      }
      logger.error('Bot handler error', { error: (err as Error).message });
      return new Response('error', { status: 500 });
    }
  }

  private async handleCallbackAction(
    userDbId: number,
    callback: {
      callbackQueryId: string;
      chatId: number;
      data: string;
      messageId: number;
    }
  ) {
    if (callback.data.startsWith('remove:')) {
      await this.handleRemoveCallback(userDbId, callback);
      return;
    }

    if (callback.data.startsWith('variant-track:')) {
      await this.handleVariantTrackCallback(userDbId, callback);
      return;
    }

    if (callback.data.startsWith('variant-pick:')) {
      await this.handleVariantPickCallback(userDbId, callback);
      return;
    }

    await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Unknown action');
  }

  private async handleRemoveCallback(
    userDbId: number,
    callback: {
      callbackQueryId: string;
      chatId: number;
      data: string;
      messageId: number;
    }
  ) {
    const match = /^remove:(\d+)$/.exec(callback.data);
    if (!match) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Unknown action');
      return;
    }

    const trackId = Number(match[1]);
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);
    const target = tracks.find((t) => t.id === trackId);

    if (!target) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Already removed');
      await sendTelegramMessage(this.deps.env, callback.chatId, 'Could not find that tracked URL.');
    } else {
      await this.deps.repo.deleteTrack(target.id);
      recordAudit('track_removed', { userId: userDbId, trackId: target.id });
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Removed');
      await sendTelegramMessage(
        this.deps.env,
        callback.chatId,
        formatRemoveConfirmation(getTrackDisplayName(target), target.site_host),
        'Markdown'
      );
    }

    await clearTelegramInlineKeyboard(this.deps.env, callback.chatId, callback.messageId).catch((err) => {
      logger.warn('Failed to clear inline keyboard', { error: (err as Error).message });
    });
  }

  private async handleVariantTrackCallback(
    userDbId: number,
    callback: {
      callbackQueryId: string;
      chatId: number;
      data: string;
      messageId: number;
    }
  ) {
    const match = /^variant-track:(\d+)$/.exec(callback.data);
    if (!match) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Unknown action');
      return;
    }

    const trackId = Number(match[1]);
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);
    const trackIdx = tracks.findIndex((t) => t.id === trackId);
    const target = trackIdx >= 0 ? tracks[trackIdx] : undefined;
    if (!target) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Track not found');
      await sendTelegramMessage(this.deps.env, callback.chatId, 'Could not find that tracked URL.');
      return;
    }

    const options = this.getVariantOptions(target);
    if (options.length === 0) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'No variants');
      await sendTelegramMessage(this.deps.env, callback.chatId, 'This track has no selectable variants.');
      return;
    }

    await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Pick a variant');
    await sendTelegramMessage(
      this.deps.env,
      callback.chatId,
      this.formatVariantPickerMessage(trackIdx + 1, getTrackDisplayName(target), target.site_host),
      'Markdown',
      buildVariantOptionKeyboard(target.id, options)
    );
    await clearTelegramInlineKeyboard(this.deps.env, callback.chatId, callback.messageId).catch((err) => {
      logger.warn('Failed to clear inline keyboard', { error: (err as Error).message });
    });
  }

  private async handleVariantPickCallback(
    userDbId: number,
    callback: {
      callbackQueryId: string;
      chatId: number;
      data: string;
      messageId: number;
    }
  ) {
    const match = /^variant-pick:(\d+):(\d+)$/.exec(callback.data);
    if (!match) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Unknown action');
      return;
    }

    const trackId = Number(match[1]);
    const optionIdx = Number(match[2]);
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);
    const trackIdx = tracks.findIndex((t) => t.id === trackId);
    const target = trackIdx >= 0 ? tracks[trackIdx] : undefined;
    if (!target) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Track not found');
      await sendTelegramMessage(this.deps.env, callback.chatId, 'Could not find that tracked URL.');
      return;
    }

    const options = this.getVariantOptions(target);
    const option = options[optionIdx];
    if (!option) {
      await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Invalid option');
      await sendTelegramMessage(this.deps.env, callback.chatId, 'Invalid variant option.');
      return;
    }

    await this.selectVariant(callback.chatId, target, trackIdx, option);
    await answerTelegramCallbackQuery(this.deps.env, callback.callbackQueryId, 'Variant selected');
    await clearTelegramInlineKeyboard(this.deps.env, callback.chatId, callback.messageId).catch((err) => {
      logger.warn('Failed to clear inline keyboard', { error: (err as Error).message });
    });
  }

  private async sendList(chatId: number, userDbId: number) {
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);
    await sendTelegramMessage(this.deps.env, chatId, formatList(tracks));
  }

  private async handleTrack(chatId: number, userDbId: number, normalizedUrl: string) {
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);
    if (tracks.length >= MAX_ACTIVE_TRACKS_PER_USER) {
      await sendTelegramMessage(this.deps.env, chatId, 'You already track 3 URLs. Remove one to add more.');
      return;
    }

    const { normalizedUrl: cleanUrl, siteHost, urlHash } = await normaliseUrl(normalizedUrl);
    const existing = await this.deps.repo.getTrackByUserAndHash(userDbId, urlHash);
    if (existing) {
      await sendTelegramMessage(this.deps.env, chatId, 'You already track this link.');
      return;
    }

    const preview = await previewProduct(cleanUrl).catch((err) => {
      logger.warn('Preview fetch failed', { error: (err as Error).message });
      return null;
    });

    const variantOptions = preview?.signals.variantOptions ?? [];
    const requiresSelection = variantOptions.length > 1;
    const autoSelect = variantOptions.length === 1 ? variantOptions[0] : null;
    const variantOptionsJson = variantOptions.length ? JSON.stringify(variantOptions) : null;
    const nextCheckAt = requiresSelection ? null : new Date().toISOString();

    const trackId = await this.deps.repo.insertTrack(userDbId, cleanUrl, siteHost, urlHash, nextCheckAt, {
      variantId: autoSelect?.id ?? null,
      variantLabel: autoSelect?.label ?? null,
      variantOptions: variantOptionsJson,
    });

    if (preview) {
      await this.deps.repo.updateAfterCheck(trackId, {
        title: preview.title ?? null,
        price: preview.price ?? null,
        variant_summary: autoSelect?.label ?? preview.variantsSummary ?? null,
        variant_options: variantOptionsJson,
        state_reason: getPreviewStateReason(siteHost, preview.status, requiresSelection),
      });
    } else {
      await this.deps.repo.updateAfterCheck(trackId, {
        state_reason: hasDedicatedProfile(siteHost) ? 'MANUAL_REVIEW' : 'UNSUPPORTED_SITE',
      });
    }

    recordAudit('track_added', { userId: userDbId, url: cleanUrl });
    recordMetric('track_added');
    const updated = await this.deps.repo.getActiveTracksByUser(userDbId);
    const index = updated.findIndex((t) => t.id === trackId) + 1;

    if (requiresSelection) {
      await sendTelegramMessage(
        this.deps.env,
        chatId,
        formatVariantPrompt(index, preview?.title?.trim() || siteHost, siteHost, variantOptions),
        'Markdown',
        buildVariantOptionKeyboard(trackId, variantOptions)
      );
    } else {
      await sendTelegramMessage(
        this.deps.env,
        chatId,
        formatTrackingAck(index, preview?.title?.trim() || siteHost, siteHost),
        'Markdown'
      );
    }
  }

  private async handleRemove(chatId: number, userDbId: number, arg?: string) {
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);

    if (!arg) {
      if (tracks.length === 0) {
        await sendTelegramMessage(this.deps.env, chatId, 'You have no active tracks. Send me a product URL to begin.');
        return;
      }
      await sendTelegramMessage(
        this.deps.env,
        chatId,
        formatRemovePrompt(),
        undefined,
        buildRemoveKeyboard(tracks)
      );
      return;
    }

    let target: Track | undefined;
    if (/^\d+$/.test(arg)) {
      const idx = Number(arg) - 1;
      target = tracks[idx];
    } else {
      const { urlHash } = await normaliseUrl(arg);
      target = tracks.find((t) => t.url_hash === urlHash);
    }

    if (!target) {
      await sendTelegramMessage(this.deps.env, chatId, 'Could not find that tracked URL.');
      return;
    }

    await this.deps.repo.deleteTrack(target.id);
    recordAudit('track_removed', { userId: userDbId, trackId: target.id });
    await sendTelegramMessage(
      this.deps.env,
      chatId,
      formatRemoveConfirmation(getTrackDisplayName(target), target.site_host),
      'Markdown'
    );
  }

  private async handleEnd(chatId: number, userDbId: number) {
    const removed = await this.deps.repo.deleteAllByUser(userDbId);
    recordAudit('track_end', { userId: userDbId, removed });
    await sendTelegramMessage(this.deps.env, chatId, formatEndConfirmation(removed));
  }

  private async handleVariant(chatId: number, userDbId: number, arg?: string) {
    const tracks = await this.deps.repo.getActiveTracksByUser(userDbId);

    if (!arg) {
      await this.sendVariantPicker(chatId, tracks);
      return;
    }

    const parts = arg.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      await this.sendVariantPicker(chatId, tracks);
      return;
    }

    const pending = tracks.filter((t) => !t.variant_id && this.getVariantOptions(t).length > 0);

    let trackIdx: number | undefined;
    let optionIdx: number | undefined;

    if (parts.length === 1) {
      optionIdx = Number(parts[0]) - 1;
      if (Number.isNaN(optionIdx)) {
        await sendTelegramMessage(this.deps.env, chatId, 'Usage: /variant <option#>');
        return;
      }
      if (pending.length === 0) {
        await sendTelegramMessage(this.deps.env, chatId, 'No pending variant selections.');
        return;
      }
      if (pending.length > 1) {
        await sendTelegramMessage(
          this.deps.env,
          chatId,
          'Specify the item as `/variant <#> <option#>` since multiple tracks need selection.'
        );
        return;
      }
      const target = pending[0];
      trackIdx = tracks.findIndex((t) => t.id === target.id);
    } else {
      trackIdx = Number(parts[0]) - 1;
      optionIdx = Number(parts[1]) - 1;
      if (Number.isNaN(trackIdx) || Number.isNaN(optionIdx)) {
        await sendTelegramMessage(this.deps.env, chatId, 'Usage: /variant <#> <option#>');
        return;
      }
    }

    const target = trackIdx !== undefined ? tracks[trackIdx] : undefined;
    if (!target) {
      await sendTelegramMessage(this.deps.env, chatId, 'Invalid track number.');
      return;
    }

    const options = this.getVariantOptions(target);
    if (options.length === 0) {
      await sendTelegramMessage(this.deps.env, chatId, 'This track has no selectable variants.');
      return;
    }
    if (optionIdx === undefined) {
      await sendTelegramMessage(this.deps.env, chatId, 'Invalid option number.');
      return;
    }

    const option = options[optionIdx];
    if (!option) {
      await sendTelegramMessage(this.deps.env, chatId, 'Invalid variant option.');
      return;
    }

    await this.selectVariant(chatId, target, trackIdx, option);
  }

  private async sendVariantPicker(chatId: number, tracks: Track[]) {
    const variantTracks = tracks.filter((track) => this.getVariantOptions(track).length > 0);
    if (variantTracks.length === 0) {
      await sendTelegramMessage(this.deps.env, chatId, 'No tracks with selectable variants.');
      return;
    }

    if (variantTracks.length === 1) {
      const track = variantTracks[0];
      const trackIdx = tracks.findIndex((t) => t.id === track.id);
      await sendTelegramMessage(
        this.deps.env,
        chatId,
        this.formatVariantPickerMessage(trackIdx + 1, getTrackDisplayName(track), track.site_host),
        'Markdown',
        buildVariantOptionKeyboard(track.id, this.getVariantOptions(track))
      );
      return;
    }

    await sendTelegramMessage(
      this.deps.env,
      chatId,
      'Choose a tracked URL first, then pick a variant:',
      undefined,
      buildVariantTrackKeyboard(tracks, variantTracks)
    );
  }

  private getVariantOptions(track: Track): VariantOption[] {
    if (!track.variant_options) return [];
    try {
      const parsed = JSON.parse(track.variant_options) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is VariantOption => {
          if (!item || typeof item !== 'object') return false;
          const option = item as Partial<VariantOption>;
          return typeof option.id === 'string' && typeof option.label === 'string' && typeof option.available === 'boolean';
        })
        .map((option) => ({ id: option.id, label: option.label, available: option.available }));
    } catch {
      return [];
    }
  }

  private formatVariantPickerMessage(order: number, displayName: string, host: string): string {
    const label = displayName === host ? `**${host}**` : `**${displayName}** (${host})`;
    return `Tracking #${order}: ${label} has multiple options.\nPick a variant:`;
  }

  private async selectVariant(chatId: number, track: Track, trackIdx: number, option: VariantOption) {
    await this.deps.repo.updateAfterCheck(track.id, {
      variant_id: option.id,
      variant_label: option.label,
      variant_summary: option.label,
      next_check_at: new Date().toISOString(),
      state_reason: null,
    });

    await sendTelegramMessage(
      this.deps.env,
      chatId,
      `Tracking #${trackIdx + 1}: now monitoring **${getTrackDisplayName(track)}** [${option.label}]`,
      'Markdown'
    );
  }
}

function getPreviewStateReason(
  siteHost: string,
  previewStatus: Track['status'],
  requiresSelection: boolean
): Track['state_reason'] {
  if (requiresSelection) return 'PENDING_VARIANT';
  if (previewStatus !== 'UNKNOWN') return null;
  return hasDedicatedProfile(siteHost) ? 'UNCLASSIFIED_HTML' : 'UNSUPPORTED_SITE';
}

interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

function buildRemoveKeyboard(tracks: Track[]): TelegramReplyMarkup {
  return {
    inline_keyboard: tracks.map((track, idx) => [
      {
        text: formatRemoveButtonLabel(track, idx + 1),
        callback_data: `remove:${track.id}`,
      },
    ]),
  };
}

function buildVariantTrackKeyboard(allTracks: Track[], variantTracks: Track[]): TelegramReplyMarkup {
  return {
    inline_keyboard: variantTracks.map((track) => {
      const order = allTracks.findIndex((t) => t.id === track.id) + 1;
      return [
        {
          text: formatVariantTrackButtonLabel(track, order),
          callback_data: `variant-track:${track.id}`,
        },
      ];
    }),
  };
}

function buildVariantOptionKeyboard(trackId: number, options: VariantOption[]): TelegramReplyMarkup {
  return {
    inline_keyboard: options.map((option, idx) => [
      {
        text: `Option ${idx + 1}: ${option.label} (${option.available ? 'Available' : 'Not available'})`,
        callback_data: `variant-pick:${trackId}:${idx}`,
      },
    ]),
  };
}

function formatRemoveButtonLabel(track: Track, order: number): string {
  const raw = `#${order} ${getTrackDisplayLabel(track, false)}`;
  return raw.length <= 50 ? raw : `${raw.slice(0, 47)}...`;
}

function formatVariantTrackButtonLabel(track: Track, order: number): string {
  const raw = `#${order} ${getTrackDisplayLabel(track, false)}`;
  return raw.length <= 60 ? raw : `${raw.slice(0, 57)}...`;
}

export async function sendTelegramMessage(
  env: EnvBindings,
  chatId: number,
  text: string,
  parseMode?: 'MarkdownV2' | 'Markdown' | 'HTML',
  replyMarkup?: TelegramReplyMarkup
) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error('Telegram send failed', { status: res.status, body });
    throw new Error('Failed to send Telegram message');
  }
}

async function answerTelegramCallbackQuery(
  env: EnvBindings,
  callbackQueryId: string,
  text?: string
) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error('Telegram callback answer failed', { status: res.status, body });
    throw new Error('Failed to answer callback query');
  }
}

async function clearTelegramInlineKeyboard(env: EnvBindings, chatId: number, messageId: number) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.warn('Failed to clear reply markup', { status: res.status, body });
    throw new Error('Failed to clear inline keyboard');
  }
}
