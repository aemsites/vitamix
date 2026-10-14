import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaCardHtml, planImageSync } from '../../tools/commerce-admin/product-image-sync.js';

const product = {
  path: '/us/en_us/products/blender',
  metaImage: 'https://example.com/existing.jpg',
  metadata: { title: 'Blender' },
  variants: [{ sku: 'black', options: [{ id: 'color', value: 'Black' }] }],
};
const assetBase = 'https://main--vitamix--aemsites.aem.live/assets/products/blender';

test('social image uses the first valid marked row in the current market', () => {
  const rows = [
    { Path: 'ca.jpg', Market: 'CA', 'og-image': 'true' },
    { 'og-image': 'true' },
    { Path: 'gallery.jpg', 'og-image': 'false' },
    { Path: 'social image.jpg', Market: 'US', 'og-image': ' true ' },
    { Path: 'later.jpg', 'og-image': true },
  ];
  const usPlan = planImageSync(product, rows, 'blender', 'US');
  assert.equal(usPlan.nextProduct.metaImage, `${assetBase}/social%20image.jpg`);
  assert.equal(usPlan.metaImage, usPlan.nextProduct.metaImage);
  assert.equal(usPlan.imageCount, 3);
  assert.deepEqual(usPlan.nextProduct.metadata, product.metadata);
  assert.equal(product.metaImage, 'https://example.com/existing.jpg');
  const caPlan = planImageSync(product, rows, 'blender', 'CA');
  assert.equal(caPlan.nextProduct.metaImage, `${assetBase}/ca.jpg`);
});

test('unrestricted variant images can be used as the social image', () => {
  const plan = planImageSync(product, [
    { Path: 'black/social.jpg', 'og-image': true },
  ], 'blender', 'CA');
  assert.equal(plan.nextProduct.metaImage, `${assetBase}/black/social.jpg`);
  assert.equal(plan.variantPlans[0].images[0].url, plan.nextProduct.metaImage);
});

test('missing, false and out-of-market markers preserve the existing social image', () => {
  const rows = [
    { Path: 'gallery.jpg' },
    { Path: 'false.jpg', 'og-image': false },
    { Path: 'ca.jpg', Market: 'CA', 'og-image': 'true' },
  ];
  assert.equal(
    planImageSync(product, rows, 'blender', 'US').nextProduct.metaImage,
    product.metaImage,
  );
  const withoutMetaImage = { ...product };
  delete withoutMetaImage.metaImage;
  assert.equal(Object.hasOwn(planImageSync(withoutMetaImage, rows, 'blender', 'US').nextProduct, 'metaImage'), false);
});

test('preview marks the selected social image even with a transformed preview URL', () => {
  const plan = planImageSync(product, [
    {
      Path: 'black/social.jpg', 'og-image': true, Video: 'video.mp4', Label: 'Social & video',
    },
  ], 'blender', 'US');
  const html = mediaCardHtml(plan.variantPlans[0].images[0], () => '/preview.jpg', plan.metaImage);
  assert.match(html, /pim-sync-card-selected/);
  assert.match(html, /title="Selected by og-image">Meta image/);
  assert.match(html, /src="\/preview.jpg"/);
  assert.match(html, />Video</);
  assert.match(html, /Social &amp; video/);
});

test('preview does not mark unselected images or an existing override without og-image', () => {
  const plan = planImageSync(product, [{ Path: product.metaImage }], 'blender', 'US');
  assert.equal(plan.metaImage, undefined);
  assert.doesNotMatch(
    mediaCardHtml(plan.productImages[0], undefined, plan.metaImage),
    /Meta image|pim-sync-card-selected/,
  );
  assert.doesNotMatch(
    mediaCardHtml({ url: '/other.jpg' }, undefined, '/selected.jpg'),
    /Meta image|pim-sync-card-selected/,
  );
  assert.match(
    mediaCardHtml({ url: '/selected.jpg' }, undefined, '/selected.jpg'),
    /<figcaption[^>]*>.*Meta image/,
  );
});
