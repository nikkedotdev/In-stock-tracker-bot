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

export function formatList(tracks: Track[]): string {
  if (tracks.length === 0) return 'You have no active tracks. Send me a product URL to begin.';
  const rows = tracks.map((track, idx) => {
    const last = track.last_checked_at ?? '--';
    const label = getTrackDisplayLabel(track, false);
    const selectionState = !track.variant_label && track.variant_options ? ' [select variant]' : '';
    const summary = [
      getTrackDisplayName(track) === track.site_host ? null : track.site_host,
      track.status,
      track.needs_manual ? 'manual' : null,
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
