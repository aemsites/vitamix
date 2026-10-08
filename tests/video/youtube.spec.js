import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const [video, gallery, videoCSS] = await Promise.all([
    readFile(resolve('blocks/video/video.js'), 'utf8'),
    readFile(resolve('blocks/pdp/gallery.js'), 'utf8'),
    readFile(resolve('blocks/video/video.css'), 'utf8'),
  ]);
  const modules = {
    '/blocks/video/video.js': video,
    '/blocks/pdp/gallery.js': gallery,
    '/scripts/scripts.js': 'export function buildCarousel() { throw new Error("Unexpected carousel call"); }',
    '/scripts/aem.js': 'export function getMetadata() { throw new Error("Unexpected metadata call"); }',
    '/blocks/modal/modal.js': 'export function createModal() { throw new Error("Unexpected modal call"); }',
  };
  await page.route('https://video.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<main></main>' });
    } else if (modules[pathname]) {
      await route.fulfill({ contentType: 'text/javascript', body: modules[pathname] });
    } else {
      await route.abort();
    }
  });
  await page.route('https://www.youtube.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('https://video.test/');
  await page.addStyleTag({ content: videoCSS });
});

[
  'https://www.youtube.com/shorts/AbCdEf123_4',
  'https://youtube.com/shorts/AbCdEf123_4?si=share-token',
  'https://m.youtube.com/shorts/AbCdEf123_4/',
  'https://www.youtube.com/watch?v=AbCdEf123_4',
  'https://youtu.be/AbCdEf123_4',
].forEach((href) => {
  test(`embeds ${href} with existing player behavior @cross-browser`, async ({ page }) => {
    await page.evaluate(async (url) => {
      const { embedYoutube } = await import(new URL('/blocks/video/video.js', window.location.href).href);
      document.querySelector('main').append(embedYoutube(new URL(url), true, false, 'Video title'));
    }, href);
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/AbCdEf123_4?rel=0&v=AbCdEf123_4&autoplay=1&mute=0&controls=1&disablekb=0&loop=0&playsinline=0');
    await expect(iframe).toHaveAttribute('title', 'Video title');
    const { width, height } = await iframe.boundingBox();
    expect(height / width).toBeCloseTo(href.includes('/shorts/') ? 1 : 9 / 16, 3);
  });
});

test('Shorts preserve background settings without autoplay @cross-browser', async ({ page }) => {
  await page.evaluate(async () => {
    const { embedYoutube } = await import(new URL('/blocks/video/video.js', window.location.href).href);
    document.querySelector('main').append(embedYoutube(
      new URL('https://www.youtube.com/shorts/AbCdEf123_4'),
      false,
      true,
    ));
  });
  await expect(page.locator('iframe')).toHaveAttribute('src', 'https://www.youtube.com/embed/AbCdEf123_4?rel=0&v=AbCdEf123_4&autoplay=0&mute=1&controls=0&disablekb=1&loop=1&playsinline=1');
  await expect(page.locator('iframe')).toHaveAttribute('title', 'Content from Youtube');
  await expect(page.locator('iframe').locator('..')).toHaveAttribute('aria-hidden', 'true');
});

test('Video block plays a Shorts link from its placeholder @cross-browser', async ({ page }) => {
  await page.evaluate(async () => {
    const { default: decorate } = await import(new URL('/blocks/video/video.js', window.location.href).href);
    const block = document.createElement('div');
    block.className = 'video';
    block.innerHTML = '<picture><img alt="Video preview"></picture><p><a href="https://www.youtube.com/shorts/AbCdEf123_4?si=share-token">Watch</a></p><p>Short video</p>';
    document.querySelector('main').append(block);
    await decorate(block);
  });
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.video-placeholder')).toHaveCSS('aspect-ratio', '1 / 1');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.video-placeholder')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveAttribute('src', /\/embed\/AbCdEf123_4\?.*autoplay=1/);
  await expect(page.locator('iframe')).toHaveAttribute('title', 'Short video');
  const { width, height } = await page.locator('iframe').boundingBox();
  expect(height / width).toBeCloseTo(1, 3);
});

[
  ['https://www.youtube.com/shorts/AbCdEf123_4', '1 / 1'],
  ['https://www.youtube.com/watch?v=AbCdEf123_4', '16 / 9'],
].forEach(([href, ratio]) => {
  test(`Video block reserves ${ratio} for ${href} @cross-browser`, async ({ page }) => {
    await page.evaluate(async (url) => {
      const { default: decorate } = await import(new URL('/blocks/video/video.js', window.location.href).href);
      const block = document.createElement('div');
      block.className = 'video';
      block.style.marginTop = '2000px';
      const link = document.createElement('a');
      link.href = url;
      link.textContent = 'Watch video';
      block.append(link);
      document.querySelector('main').append(block);
      await decorate(block);
    }, href);
    await expect(page.locator('.video')).toHaveCSS('aspect-ratio', ratio);
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});

[
  'https://www.youtube.com/shorts/AbCdEf123_4?si=share-token',
  'https://youtube.com/shorts/AbCdEf123_4',
  'https://m.youtube.com/shorts/AbCdEf123_4',
  'https://www.youtube.com/watch?v=AbCdEf123_4',
  'https://youtu.be/AbCdEf123_4',
].forEach((href) => {
  test(`gallery plays ${href} inline @cross-browser`, async ({ page }) => {
    await page.evaluate(async (url) => {
      const { buildSlide } = await import(new URL('/blocks/pdp/gallery.js', window.location.href).href);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<picture><img alt="Video preview"></picture><a>Watch video</a>';
      wrapper.querySelector('a').href = url;
      document.querySelector('main').append(buildSlide(wrapper, 'lcp'));
    }, href);
    await expect(page.locator('a.video-wrapper picture')).toHaveCount(1);
    await page.locator('a.video-wrapper').click();
    await expect(page.locator('a.video-wrapper')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveAttribute('src', /\/embed\/AbCdEf123_4\?.*autoplay=1/);
    const { width, height } = await page.locator('iframe').boundingBox();
    expect(height / width).toBeCloseTo(href.includes('/shorts/') ? 1 : 9 / 16, 3);
    await expect(page).toHaveURL('https://video.test/');
  });
});
