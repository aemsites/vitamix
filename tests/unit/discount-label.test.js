import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import formatDiscountLabel from '../../scripts/commerce/discount-label.js';

describe('formatDiscountLabel', () => {
  it('removes the generated ID.me coupon number prefix', () => {
    assert.equal(formatDiscountLabel('#993 ID.me'), 'ID.me');
    assert.equal(formatDiscountLabel('#993 ID.me discount'), 'ID.me discount');
  });

  it('leaves other discount labels unchanged', () => {
    assert.equal(formatDiscountLabel('SAVE10'), 'SAVE10');
    assert.equal(formatDiscountLabel('#993 Summer Sale'), '#993 Summer Sale');
    assert.equal(formatDiscountLabel('ID.me'), 'ID.me');
  });
});
