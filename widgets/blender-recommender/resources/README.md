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

The US and Canadian E310 entries in both feeds were refreshed to VX3 from the
production feeds on November 4, 2026, with its image saved locally as
`images/vx3.jpg`. Scoring, visibility flags, and companion products were
preserved. The production Canadian French VX3 entry supplies English benefits;
the local entry translates them into French using the existing feed's wording.

Image filenames are normalized to lowercase, hyphenated slugs (`4+.svg` becomes
`4-plus.svg`), and their original DAM and catalog directory structures are
flattened into `images/`. JSON image paths are relative to this
folder; the widget resolves them against its module-relative resource URL.
All non-inline stylesheet image URLs also point into `images/`.

The broken `.atom-stars::after` fallback rule that requested
`https://www.vitamix.com/img/star-cutout.png` (HTTP 404) was removed. Other
stylesheet rules and embedded images are preserved. The vendored stylesheet is
uses a file-level `stylelint-disable` comment rather than being reformatted.

Alpine.js remains on unpkg. The name and email screen is hidden and automatically
skipped only when the restored screen is still the intro. The widget no longer
submits newsletter subscriptions or calls the production `/bin` endpoint.
Saved questions and existing visitor names are preserved; reloading during the
results loader restarts its two-second completion timer.

VX3 product links use `/products/vx3`; other product and
article navigation paths are unchanged. The widget determines country and
language from the page path on both preview and production hosts.

## Updating

Changes to the original feeds, prices, or assets do not automatically propagate
here. When refreshing either JSON feed, preserve its scoring and visibility
fields, copy any new product images into `images/`, and replace `primary_img` and
`second_img` values with `images/<filename>` using slugged filenames. Avoid
restoring remote asset URLs when refreshing the stylesheet.

There is no dedicated recommender test file in the repository. Validate the quiz
manually in US English, Canadian English, and Canadian French, including fresh
sessions, answered-question reloads, Back navigation, and loading-screen reloads.
Check that product images load locally and no `newslettersubscription` request is
made. Run the existing repository lint and unit tests before shipping.
