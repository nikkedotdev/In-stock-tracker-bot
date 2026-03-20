import { Track, VariantOption } from '../core/types';
import { getTrackDisplayLabel, getTrackDisplayName } from './labels';

export function formatStartMessage(): string {
  return [
    'Hello! Send me up to 3 product links (one per message) and I will check stock every minute.',
    'Commands: /help, /list, /variant, /remove, /remove <#|url>, /end',
  ].join('\n');
}

export function formatHelpMessage(): string {
  return [
    'Paste a product URL to start tracking.',
    'I will alert you once it is available (after double-confirming).',
    'Use /list to see tracked items, /variant to pick/change variants, /remove (or /remove <#|url>) to stop, /end to clear all.',
  ].join('\n');
}

export function formatTrackingAck(order: number, displayName: string, host: string): string {
  const label = displayName === host ? `**${host}**` : `**${displayName}** (${host})`;
  return `Tracking #${order}: ${label} - I will notify you when it is available.`;
}

export function formatVariantPrompt(order: number, displayName: string, host: string, options: VariantOption[]): string {
  const label = displayName === host ? `**${host}**` : `**${displayName}** (${host})`;
  const lines = [
    `Tracking #${order}: ${label} has multiple options.`,
    'Tap an option button below, or use `/variant <option#>` (`/variant <#> <option#>` when several items are pending):',
  ];
  options.forEach((option, idx) => {
    lines.push(`Option ${idx + 1}: ${option.label} - ${option.available ? 'Available' : 'Not available'}`);
  });
  lines.push('Example: `/variant 2` selects option 2 for this item.');
  return lines.join('\n');
}

export function formatManualReviewNotice(displayName: string, host: string): string {
  const label = displayName === host ? host : `${displayName} (${host})`;
  return `Heads up: ${label} may be blocked or unreliable right now, so I will keep tracking it but its current status may be wrong. Use /list for details.`;
}

export function formatList(tracks: Track[]): string {
  if (tracks.length === 0) return 'You have no active tracks. Send me a product URL to begin.';
  const rows = tracks.map((track, idx) => {
    const last = track.last_checked_at ?? '--';
    const label = getTrackDisplayLabel(track, false);
    const selectionState = !track.variant_label && hasSelectableVariantOptions(track.variant_options) ? ' [select variant]' : '';
    const summary = [
      getTrackDisplayName(track) === track.site_host ? null : track.site_host,
      formatStatusSummary(track),
      track.needs_manual && track.state_reason !== 'MANUAL_REVIEW' ? 'manual' : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' • ');

    return [
      `#${idx + 1} ${label}${selectionState}`,
      summary,
      `Last checked: ${last}`,
    ].join('\n');
  });
  return rows.join('\n\n');
}

function formatStatusSummary(track: Track): string {
  const detail = formatDiagnosticDetail(track);
  return detail ? `${track.status} (${detail})` : track.status;
}

function formatDiagnosticDetail(track: Track): string | null {
  if (track.status === 'ERROR') {
    if (track.last_http_status === 403 && track.state_reason === 'CLOUDFLARE_CHALLENGE') {
      return '403 cloudflare challenge';
    }
    if (track.last_http_status === 429 && track.state_reason === 'RATE_LIMITED') {
      return '429 rate limited';
    }
  }

  switch (track.state_reason) {
    case 'PENDING_VARIANT':
      return 'pending variant';
    case 'UNSUPPORTED_SITE':
      return 'unsupported site';
    case 'UNCLASSIFIED_HTML':
      return 'unclassified html';
    case 'TIMEOUT':
      return 'timeout';
    case 'NETWORK_ERROR':
      return 'network error';
    case 'FETCH_BLOCKED':
      return 'fetch blocked';
    case 'MANUAL_REVIEW':
      return 'manual review';
    default:
      return null;
  }
}

function hasSelectableVariantOptions(variantOptions: Track['variant_options']): boolean {
  if (!variantOptions) return false;
  try {
    const parsed = JSON.parse(variantOptions) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export function formatRemoveConfirmation(displayName: string, host: string): string {
  const label = displayName === host ? `**${host}**` : `**${displayName}** (${host})`;
  return `Removed tracking for ${label}.`;
}

export function formatRemovePrompt(): string {
  return 'Select an item to remove:';
}

export function formatEndConfirmation(count: number): string {
  if (count === 0) return 'You had no active tracks.';
  return `Removed ${count} track${count === 1 ? '' : 's'}.`;
}

export function formatAlert(track: Track): string {
  const lines = [
    `✅ In stock: **${track.title ?? track.site_host}** (${track.site_host})`,
  ];
  if (track.variant_label) lines.push(`Variant: ${track.variant_label}`);
  if (track.price) lines.push(track.price);
  if (track.variant_summary) lines.push(track.variant_summary);
  lines.push(track.url);
  lines.push('Removed from tracking. Send another link to track more.');
  return lines.join('\n');
}
