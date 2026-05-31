import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractSiteCode,
  extractProductSlug,
  checkFriedpotatoStock,
} from '../src/profiles/sites/friedpotato.com';
import { findApiProfile } from '../src/profiles';

describe('friedpotato profile', () => {
  describe('extractSiteCode', () => {
    it('extracts site code from host', () => {
      expect(extractSiteCode('ado-officialshop-friedpotato.com')).toBe('ado-officialshop');
    });

    it('handles other subdomains', () => {
      expect(extractSiteCode('some-artist-friedpotato.com')).toBe('some-artist');
    });

    it('rejects codes with header injection characters', () => {
      expect(extractSiteCode('bad\r\nvalue-friedpotato.com')).toBeNull();
      expect(extractSiteCode('bad value-friedpotato.com')).toBeNull();
      expect(extractSiteCode('bad/path-friedpotato.com')).toBeNull();
    });
  });

  describe('extractProductSlug', () => {
    it('extracts slug from product URL', () => {
      expect(extractProductSlug('https://ado-officialshop-friedpotato.com/products/Ado26Ao_015')).toBe(
        'Ado26Ao_015'
      );
    });

    it('returns null for non-product URLs', () => {
      expect(extractProductSlug('https://ado-officialshop-friedpotato.com/shops')).toBeNull();
    });

    it('handles query params', () => {
      expect(extractProductSlug('https://x-friedpotato.com/products/ABC_001?ref=top')).toBe('ABC_001');
    });
  });

  describe('findApiProfile', () => {
    it('returns profile for friedpotato hosts', () => {
      const profile = findApiProfile('ado-officialshop-friedpotato.com');
      expect(profile).toBeDefined();
      expect(profile?.checkStock).toBeDefined();
    });

    it('returns undefined for other hosts', () => {
      expect(findApiProfile('nike.com')).toBeUndefined();
    });
  });

  describe('checkFriedpotatoStock', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns AVAILABLE when isSoldOut is false', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          _embedded: {
            products: [
              { slug: 'Ado26Ao_015', name: 'Test Product', price: 900, isSoldOut: false },
            ],
          },
        }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await checkFriedpotatoStock(
        'https://ado-officialshop-friedpotato.com/products/Ado26Ao_015',
        'ado-officialshop-friedpotato.com'
      );

      expect(result.statusHint).toBe('AVAILABLE');
      expect(result.title).toBe('Test Product');
      expect(result.price).toBe('¥900');
    });

    it('returns NOT_AVAILABLE when isSoldOut is true', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          _embedded: {
            products: [
              { slug: 'Ado26Ao_023', name: 'Sold Out Item', price: 4800, isSoldOut: true },
            ],
          },
        }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await checkFriedpotatoStock(
        'https://ado-officialshop-friedpotato.com/products/Ado26Ao_023',
        'ado-officialshop-friedpotato.com'
      );

      expect(result.statusHint).toBe('NOT_AVAILABLE');
      expect(result.title).toBe('Sold Out Item');
      expect(result.price).toBe('¥4,800');
    });

    it('returns empty result when API fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const result = await checkFriedpotatoStock(
        'https://ado-officialshop-friedpotato.com/products/Ado26Ao_015',
        'ado-officialshop-friedpotato.com'
      );

      expect(result).toEqual({});
    });

    it('returns empty result when product not found', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          _embedded: { products: [{ slug: 'OTHER_001', name: 'Other', price: 100, isSoldOut: false }] },
        }),
      };
      // Return empty on subsequent pages
      const emptyPage = {
        ok: true,
        json: async () => ({ _embedded: { products: [] } }),
      };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValue(emptyPage));

      const result = await checkFriedpotatoStock(
        'https://ado-officialshop-friedpotato.com/products/MISSING_001',
        'ado-officialshop-friedpotato.com'
      );

      expect(result).toEqual({});
    });

    it('sends correct X-Bet-Site-Code header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ _embedded: { products: [] } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await checkFriedpotatoStock(
        'https://ado-officialshop-friedpotato.com/products/X',
        'ado-officialshop-friedpotato.com'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('shop.api.groobee.com'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Bet-Site-Code': 'ado-officialshop' }),
        })
      );
    });
  });
});
