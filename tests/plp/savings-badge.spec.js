import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const styles = [
  'styles/colors.css',
  'styles/containers.css',
  'styles/typography.css',
  'styles/styles.css',
  'styles/product-badges.css',
  'widgets/product-list/product-list.css',
  'blocks/product-row/product-row.css',
].map((path) => readFileSync(path, 'utf8')
  .replace(/@import[^;]+;/g, ''));

[320, 375, 599, 600, 768, 1440].forEach((width) => {
  test(`savings badges align on wrapped lines without widening cards at ${width}px @cross-browser`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><body class="appear"><main style="margin-inline: 32px" class="product-list-widget"><div class="product-list-results"></div></main><div class="product-row"><div class="price"></div></div></body>');
    await page.addStyleTag({ content: styles.join('\n') });
    await page.evaluate(() => {
      ['Save $150.00', 'Sauvegarder 150,00 $', 'Extra long savings label $150.00', 'Ahorra $150.00'].forEach((label) => {
        const card = document.createElement('div');
        card.className = 'product-list-widget-product-card';
        card.innerHTML = '<p class="product-list-widget-price"><span class="product-list-widget-price-amount"><span class="product-list-widget-price-value">$249.95 <del>$399.95</del></span> <span class="product-badge product-badge-tier-alert save"></span></span></p>';
        card.querySelector('.save').textContent = label;
        document.querySelector('.product-list-results').append(card);
      });
    });

    const geometry = await page.locator('.save').evaluateAll((badges) => badges.map((badge) => {
      const rect = badge.getBoundingClientRect();
      const amount = badge.parentElement.getBoundingClientRect();
      const value = badge.previousElementSibling.getBoundingClientRect();
      const amountStyle = getComputedStyle(badge.parentElement);
      const card = badge.closest('.product-list-widget-product-card');
      const cardRect = card.getBoundingClientRect();
      const next = card.nextElementSibling?.getBoundingClientRect();
      const limit = next && next.y === cardRect.y && next.x > cardRect.x
        ? next.x : window.innerWidth;
      return {
        x: rect.x,
        right: rect.right,
        amountX: amount.x,
        display: amountStyle.display,
        gap: amountStyle.gap,
        actualGap: rect.x - value.right,
        wrapped: rect.top >= value.bottom,
        cardX: cardRect.x,
        cardY: cardRect.y,
        limit,
      };
    }));

    expect(geometry[0].cardY).toBe(geometry[1].cardY);
    expect(geometry[0].cardX).toBeLessThan(geometry[1].cardX);
    geometry.forEach((badge) => {
      if (badge.wrapped) expect(badge.x).toBe(badge.amountX);
      expect(badge.right).toBeLessThanOrEqual(badge.limit);
    });
    if (width >= 600) {
      const saleGap = await page.locator('.product-row .price')
        .evaluate((price) => getComputedStyle(price).gap);
      expect(geometry[0].display).toBe('flex');
      expect(geometry[0].gap).toBe(saleGap);
      expect(geometry[0].actualGap).toBeCloseTo(parseFloat(saleGap), 1);
    } else {
      expect(geometry[0].display).toBe('block');
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
});
