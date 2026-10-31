# Blender recommender resources

These resources were copied from the public Vitamix site on October 31, 2026:

- `blender-recommender-en.json` and `blender-recommender-fr.json`:
  `/content/dam/vitamix/files/`. These are snapshots of recommendation weights,
  product details, prices, and visibility flags, not live catalog data.
- `design-system.min.css`: `/content/dam/vitamix/client-library/css/`.
  The widget previously loaded two identical versions with different query strings;
  it now loads one local copy.
- `images/`: question and benefit illustrations, recipe, warranty and article
  images, product images from both feeds, and images referenced by the stylesheet.

Image filenames are normalized to lowercase, hyphenated slugs (`4+.svg` becomes
`4-plus.svg`), and their original DAM and catalog directory structures are
flattened into `images/`. JSON image paths are relative to this
folder; the widget resolves them against its module-relative resource URL.
All non-inline stylesheet image URLs also point into `images/`.

The broken `.atom-stars::after` fallback rule that requested
`https://www.vitamix.com/img/star-cutout.png` (HTTP 404) was removed. Other
stylesheet rules and embedded images are preserved. The vendored stylesheet is
uses a file-level `stylelint-disable` comment rather than being reformatted.

Alpine.js remains on unpkg, and the newsletter subscription endpoint remains on
`www.vitamix.com`. Product and article navigation links are unchanged.

## Updating

Changes to the original feeds, prices, or assets do not automatically propagate
here. When refreshing either JSON feed, preserve its scoring and visibility
fields, copy any new product images into `images/`, and replace `primary_img` and
`second_img` values with `images/<filename>` using slugged filenames. Avoid
restoring remote asset URLs when refreshing the stylesheet.

Validate local resource references and recommendation behavior with:

```sh
node --import=./tests/unit/setup.mjs --test tests/unit/blender-recommender.test.js
```
