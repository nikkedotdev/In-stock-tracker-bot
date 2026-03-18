import { Status, ScrapeSignals, VariantOption } from '../core/types';
import { genericProfile } from './sites/generic';
import { nikeProfile } from './sites/nike.com';
import { amazonUkProfile } from './sites/amazon.co.uk';
import { jellycatProfile } from './sites/jellycat.com';
import { noodollProfile } from './sites/noodoll.com';
import { greenPheasantProfile } from './sites/greenpheasantgifts.co.uk';

export interface ProfileResult {
  signals?: Partial<ScrapeSignals>;
  statusHint?: Status;
  variantsSummary?: string;
  price?: string;
  title?: string;
  variantOptions?: VariantOption[];
}

export interface SiteProfile {
  hosts: string[];
  parse(html: string, headers: Headers): ProfileResult;
}

const profiles: SiteProfile[] = [
  nikeProfile,
  amazonUkProfile,
  jellycatProfile,
  noodollProfile,
  greenPheasantProfile,
];

export function hasDedicatedProfile(host: string): boolean {
  return profiles.some((p) => p.hosts.some((h) => host.endsWith(h)));
}

export function applyProfile(host: string, html: string, headers: Headers): ProfileResult {
  const profile = profiles.find((p) => p.hosts.some((h) => host.endsWith(h)));
  if (profile) return profile.parse(html, headers);
  return genericProfile.parse(html, headers);
}
