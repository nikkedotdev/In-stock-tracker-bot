import {
  GLOBAL_CONCURRENCY_DEFAULT,
  PER_HOST_CONCURRENCY,
  PER_HOST_MIN_GAP_MS,
} from '../core/config';
import { D1Client } from '../db/d1';
import { TrackRepository } from '../db/repos';
import { EnvBindings, Track, VariantOption } from '../core/types';
import { RateLimiter } from './rateLimiter';
import { fetchTrack } from './fetcher';
import { parsePage } from './parser';
import { normalise } from './normaliser';
import { applyTransition } from './transitions';
import { hashContentSnippet } from '../core/signatures';
import { formatAlert, formatManualReviewNotice } from '../bot/formatter';
import { sendTelegramMessage } from '../bot/handlers';
import { logger } from '../core/logging';
import { FetchError } from '../core/errors';
import { recordMetric } from '../telemetry/metrics';
import { recordAudit } from '../telemetry/audit';
import { hasDedicatedProfile, findApiProfile } from '../profiles';

export async function handleCron(env: EnvBindings): Promise<Response> {
  const repo = new TrackRepository(new D1Client(env.D1_DB));
  const now = new Date();
  const due = await repo.getDueTracks(now.toISOString(), 200);
  if (due.length === 0) {
    return new Response('no-due');
  }

  const limiter = new RateLimiter({
    perHost: PER_HOST_CONCURRENCY,
    global: Number(env.MAX_GLOBAL_CONCURRENCY ?? GLOBAL_CONCURRENCY_DEFAULT),
    minGapMs: PER_HOST_MIN_GAP_MS,
  });

  await Promise.all(due.map((track) => limiter.schedule(track.site_host, () => processTrack(track, repo, env))));

  return new Response('ok');
}

type DueTrack = Track & { tg_user_id: string };

async function processTrack(track: DueTrack, repo: TrackRepository, env: EnvBindings) {
  const now = new Date();
  try {
    // API-based profiles bypass HTML fetch entirely
    const apiProfile = findApiProfile(track.site_host);
    if (apiProfile?.checkStock) {
      const result = await apiProfile.checkStock(track.url, track.site_host);
      const observedStatus = result.statusHint ?? 'UNKNOWN';
      const decision = applyTransition({
        track,
        observedStatus,
        now,
        success: true,
        needsManual: false,
      });
      const patch = {
        ...decision.patch,
        title: result.title ?? track.title,
        price: result.price ?? track.price,
        last_http_status: null,
        last_error_kind: null,
        state_reason: observedStatus === 'UNKNOWN' ? 'UNCLASSIFIED_HTML' as const : null,
      };
      if (decision.alert) {
        const chatId = Number(track.tg_user_id);
        await sendTelegramMessage(env, chatId, formatAlert({ ...track, ...patch } as Track), 'Markdown');
        recordAudit('alert_sent', { trackId: track.id, userId: track.user_id });
        recordMetric('alert_sent');
        await repo.deleteTrack(track.id);
      } else {
        await repo.updateAfterCheck(track.id, patch);
      }
      return;
    }

    const outcome = await fetchTrack(track, env);
    if (outcome.status === 'not-modified') {
      const decision = applyTransition({
        track,
        observedStatus: track.status,
        now,
        success: true,
        needsManual: track.needs_manual === 1,
      });
      await repo.updateAfterCheck(track.id, {
        ...decision.patch,
        last_http_status: null,
        last_error_kind: null,
        state_reason: currentSuccessStateReason(track),
      });
      return;
    }

    if (!outcome.html) throw new Error('Missing HTML in fetch');
    const parsed = parsePage(outcome.html, track.site_host, outcome.headers);
    const normalized = normalise(parsed);
    const variantOptions = normalized.signals.variantOptions;
    const { observedStatus, variantSummary } = resolveVariantStatus(track, normalized.signals.variantOptions, normalized.status);
    const needsManual = detectManualBlock(outcome.html);
    const decision = applyTransition({
      track,
      observedStatus,
      now,
      success: true,
      needsManual,
    });
    const stateReason = classifySuccessStateReason(track.site_host, observedStatus, needsManual);

    const patch = {
      ...decision.patch,
      title: normalized.title ?? track.title,
      price: normalized.price ?? track.price,
      variant_summary: variantSummary ?? normalized.variantsSummary ?? track.variant_summary,
      etag: outcome.headers.get('etag') ?? track.etag,
      content_sig: await hashContentSnippet(outcome.html),
      variant_options: variantOptions ? JSON.stringify(variantOptions) : track.variant_options,
      last_http_status: null,
      last_error_kind: null,
      state_reason: stateReason,
    };

    const enteredManualReview = shouldNotifyManualReview(currentSuccessStateReason(track), stateReason);

    if (decision.alert) {
      const chatId = Number(track.tg_user_id);
      await sendTelegramMessage(env, chatId, formatAlert({ ...track, ...patch } as Track), 'Markdown');
      recordAudit('alert_sent', { trackId: track.id, userId: track.user_id });
      recordMetric('alert_sent');
      await repo.deleteTrack(track.id);
    } else {
      await repo.updateAfterCheck(track.id, patch);
      if (enteredManualReview) {
        await sendTelegramMessage(
          env,
          Number(track.tg_user_id),
          formatManualReviewNotice(patch.title ?? track.title ?? track.site_host, track.site_host)
        );
      }
    }
  } catch (err) {
    logger.warn('Track processing failed', { id: track.id, error: (err as Error).message });
    const needsManual = err instanceof FetchError && (err.status === 403 || err.status === 429);
    const decision = applyTransition({
      track,
      observedStatus: track.status,
      now,
      success: false,
      needsManual,
    });
    await repo.updateAfterCheck(track.id, {
      ...decision.patch,
      last_http_status: err instanceof FetchError ? err.status ?? null : null,
      last_error_kind: err instanceof FetchError ? err.kind : 'UNKNOWN_ERROR',
      state_reason: err instanceof FetchError ? err.stateReason : null,
    });
  }
}

function detectManualBlock(html: string): boolean {
  return (
    /\bcaptcha\b/i.test(html) ||
    /<form[^>]*captcha/i.test(html) ||
    /id=["']captcha/i.test(html) ||
    /<title[^>]*>.*?enable javascript/i.test(html) ||
    /region.{0,20}restriction/i.test(html)
  );
}

function resolveVariantStatus(
  track: Track,
  options: VariantOption[] | undefined,
  fallback: Track['status']
): { observedStatus: Track['status']; variantSummary?: string | null } {
  if (!track.variant_id) {
    return { observedStatus: fallback, variantSummary: track.variant_summary ?? null };
  }
  const match = options?.find((opt) => opt.id === track.variant_id);
  if (!match) {
    return { observedStatus: fallback, variantSummary: track.variant_summary ?? null };
  }
  const status = match.available ? 'AVAILABLE' : 'NOT_AVAILABLE';
  const summary = track.variant_label ? `${track.variant_label} (${match.available ? 'available' : 'out of stock'})` : track.variant_summary ?? null;
  return { observedStatus: status, variantSummary: summary };
}

function classifySuccessStateReason(
  host: string,
  status: Track['status'],
  needsManual: boolean
): Track['state_reason'] {
  if (needsManual) return 'MANUAL_REVIEW';
  if (status !== 'UNKNOWN') return null;
  return hasDedicatedProfile(host) ? 'UNCLASSIFIED_HTML' : 'UNSUPPORTED_SITE';
}

function currentSuccessStateReason(track: Track): Track['state_reason'] {
  if (track.needs_manual === 1) return 'MANUAL_REVIEW';
  if (track.status === 'UNKNOWN') return track.state_reason;
  return null;
}

function shouldNotifyManualReview(previous: Track['state_reason'] | null, next: Track['state_reason'] | null): boolean {
  return previous !== 'MANUAL_REVIEW' && next === 'MANUAL_REVIEW';
}
