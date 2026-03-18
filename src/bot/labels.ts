import type { Track } from '../core/types';

type TrackLabelSource = Pick<Track, 'title' | 'site_host' | 'variant_label'>;

export function getTrackDisplayName(track: Pick<Track, 'title' | 'site_host'>): string {
  const title = track.title?.trim();
  return title && title.length > 0 ? title : track.site_host;
}

export function getTrackDisplayLabel(track: TrackLabelSource, includeHost = true): string {
  const name = getTrackDisplayName(track);
  const variantSuffix = track.variant_label ? ` [${track.variant_label}]` : '';

  if (!includeHost || name === track.site_host) {
    return `${name}${variantSuffix}`;
  }

  return `${name}${variantSuffix} (${track.site_host})`;
}
