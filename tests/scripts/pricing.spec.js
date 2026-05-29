/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

/**
 * Unit tests for formatPrice and getOfferPricing (from scripts/scripts.js).
 *
 * These pure functions are defined inline because scripts.js imports aem.js
 * which requires a full browser environment. The functions under test have
 * no browser dependencies so they can be tested directly.
 */

function formatPrice(value, ph) {
  const locale = (ph.languageCode || 'en_US').replace('_', '-');
  const currency = ph.currencyCode || 'USD';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

function getOfferPricing(offer) {
  if (!offer) return null;
  return {
    final: parseFloat(offer.price),
    regular: offer.priceSpecification?.price || null,
  };
}

test.describe('formatPrice', () => {
  test('formats USD in en_US locale', () => {
    const ph = { languageCode: 'en_US', currencyCode: 'USD' };
    expect(formatPrice(399.95, ph)).toBe('$399.95');
  });

  test('formats USD with thousands separator', () => {
    const ph = { languageCode: 'en_US', currencyCode: 'USD' };
    expect(formatPrice(1299.99, ph)).toBe('$1,299.99');
  });

  test('formats CAD in fr_CA locale', () => {
    const ph = { languageCode: 'fr_CA', currencyCode: 'CAD' };
    const result = formatPrice(399.95, ph);
    // fr-CA formats as "399,95 $"
    expect(result).toContain('399,95');
    expect(result).toContain('$');
    expect(result).not.toContain('US');
  });

  test('formats CAD in en_CA locale', () => {
    const ph = { languageCode: 'en_CA', currencyCode: 'CAD' };
    const result = formatPrice(399.95, ph);
    expect(result).toContain('399.95');
    expect(result).toContain('$');
    expect(result).not.toContain('US');
  });

  test('formats zero price', () => {
    const ph = { languageCode: 'en_US', currencyCode: 'USD' };
    expect(formatPrice(0, ph)).toBe('$0.00');
  });

  test('formats whole number with decimals', () => {
    const ph = { languageCode: 'en_US', currencyCode: 'USD' };
    expect(formatPrice(400, ph)).toBe('$400.00');
  });

  test('falls back to en_US and USD when placeholders are empty', () => {
    const ph = {};
    expect(formatPrice(399.95, ph)).toBe('$399.95');
  });
});

test.describe('getOfferPricing', () => {
  test('returns final and regular price from offer with sale', () => {
    const offer = {
      price: '349.95',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        priceType: 'https://schema.org/ListPrice',
        price: 399.95,
        priceCurrency: 'USD',
      },
    };
    const result = getOfferPricing(offer);
    expect(result.final).toBe(349.95);
    expect(result.regular).toBe(399.95);
  });

  test('returns null regular price when no priceSpecification', () => {
    const offer = {
      price: '349.95',
      priceCurrency: 'USD',
    };
    const result = getOfferPricing(offer);
    expect(result.final).toBe(349.95);
    expect(result.regular).toBeNull();
  });

  test('returns null for null offer', () => {
    expect(getOfferPricing(null)).toBeNull();
  });

  test('returns null for undefined offer', () => {
    expect(getOfferPricing(undefined)).toBeNull();
  });

  test('parses string price correctly', () => {
    const offer = { price: '1299.99' };
    const result = getOfferPricing(offer);
    expect(result.final).toBe(1299.99);
  });
});
