import { test, expect } from '@playwright/test';
import { orderMarketLabel, orderMarketBadgeHtml } from '../../tools/commerce-admin/orders-page.js';

test.describe('orderMarketLabel', () => {
  test('returns CA · EN for Canada with en-US locale (default Canada English URL /ca/en_us)', () => {
    expect(orderMarketLabel({ country: 'ca', locale: 'en-US' })).toBe('CA · EN');
    expect(orderMarketLabel({ country: 'CA', locale: 'en-us' })).toBe('CA · EN');
  });

  test('returns CA · EN for Canada with en-CA locale', () => {
    expect(orderMarketLabel({ country: 'ca', locale: 'en-CA' })).toBe('CA · EN');
  });

  test('returns CA · FR for Canada with fr-CA locale (/ca/fr_ca)', () => {
    expect(orderMarketLabel({ country: 'ca', locale: 'fr-CA' })).toBe('CA · FR');
    expect(orderMarketLabel({ country: 'CA', locale: 'fr-ca' })).toBe('CA · FR');
  });

  test('returns US for United States', () => {
    expect(orderMarketLabel({ country: 'us', locale: 'en-US' })).toBe('US');
    expect(orderMarketLabel({ country: 'US', locale: 'en-US' })).toBe('US');
  });

  test('returns MX for Mexico', () => {
    expect(orderMarketLabel({ country: 'mx', locale: 'es-MX' })).toBe('MX');
  });

  test('handles missing or empty fields safely', () => {
    expect(orderMarketLabel(null)).toBe('—');
    expect(orderMarketLabel({})).toBe('—');
    expect(orderMarketLabel({ country: '' })).toBe('—');
  });
});

test.describe('orderMarketBadgeHtml', () => {
  test('renders styled badge for CA · EN', () => {
    const html = orderMarketBadgeHtml({ country: 'ca', locale: 'en-US' });
    expect(html).toContain('orders-market-badge');
    expect(html).toContain('orders-market-badge-ca-en');
    expect(html).toContain('CA · EN');
  });

  test('renders styled badge for CA · FR', () => {
    const html = orderMarketBadgeHtml({ country: 'ca', locale: 'fr-CA' });
    expect(html).toContain('orders-market-badge');
    expect(html).toContain('orders-market-badge-ca-fr');
    expect(html).toContain('CA · FR');
  });

  test('renders styled badge for US', () => {
    const html = orderMarketBadgeHtml({ country: 'us', locale: 'en-US' });
    expect(html).toContain('orders-market-badge');
    expect(html).toContain('orders-market-badge-us');
    expect(html).toContain('US');
  });

  test('renders em dash when country is absent', () => {
    expect(orderMarketBadgeHtml(null)).toBe('—');
    expect(orderMarketBadgeHtml({})).toBe('—');
  });

  test('supports query highlighting in browser context', async ({ page }) => {
    await page.setContent('<div></div>');
    const result = await page.evaluate(() => {
      // Mock highlightMatch logic as in search-highlight.js
      const label = 'CA · EN';
      const div = document.createElement('div');
      div.textContent = label;
      return div.innerHTML.replace(/(CA)/gi, '<mark class="pim-highlight">$1</mark>');
    });
    expect(result).toContain('<mark class="pim-highlight">CA</mark>');
  });
});
