# Blender recommender resources

This folder contains the local data, styles, and assets used by the legacy
blender recommender. The resources are snapshots imported from the public
Vitamix site on October 31, 2026; upstream changes do not propagate automatically.

## Recommendation data

`blender-recommender-en.json` and `blender-recommender-fr.json` originate from
`/content/dam/vitamix/files/`. They define recommendation weights, product
details, prices, and visibility flags rather than querying a live catalog.

The US and Canadian VX3 entries reflect the production feeds as of November 4,
2026, with localized Canadian French benefits and a local product image at
`images/vx3.jpg`. VX3 links use `/products/vx3`. The widget selects country and
language from the page path on both preview and production hosts.

## Images

`images/` contains product photos, question and benefit illustrations, recipe,
warranty and article images, and stylesheet assets. Filenames use lowercase,
hyphenated slugs, such as `4-plus.svg`; original DAM and catalog directories are
flattened into this folder.

Feed image paths use `images/<filename>` relative to this resources folder.
The widget resolves them against its module-relative resource URL. Non-inline
stylesheet image URLs also point into `images/`.

SVGs use readable formatting without unnecessary export metadata, unused IDs
or namespaces, or redundant groups. They retain their artwork, dimensions,
viewBoxes, titles, fixed colors, and referenced definitions. Because they are
loaded as external images, `currentColor` does not inherit the page's text color.

## Styles and runtime

`design-system.min.css` is the vendored stylesheet from
`/content/dam/vitamix/client-library/css/`, loaded once from this folder. It keeps
its imported formatting and a file-level `stylelint-disable` comment. Embedded
images are retained; the unavailable remote star-image fallback is omitted.
Local layout overrides belong in the widget stylesheet, not the vendored file.

Alpine.js loads from unpkg. The quiz does not request a name or email or submit
newsletter subscriptions. Fresh sessions skip the hidden intro; saved sessions
retain their question position, answers, and existing visitor names. The results
loader runs for two seconds and restarts that timer if the page is reloaded.

Below 768px, loading testimonials are static and fit the container. Results
display two product cards with arrows and a localized "1 of 2" / "1 de 2" count
in a polite, atomic status live region. At 768px and above, testimonials scroll,
the product count is hidden, and the results heading uses normal word-breaking.

## Maintenance

- Refresh feeds deliberately, preserving recommendation weights, visibility
  flags, and companion-product relationships.
- Copy new images into `images/` with normalized filenames and update
  `primary_img` and `second_img` paths in the feeds.
- Keep stylesheet assets local rather than restoring remote image URLs.
- Keep SVG cleanup conservative: preserve geometry, colors, dimensions, and
  referenced definitions; avoid aggressive path rounding.

## Validation

There is no dedicated recommender test file. Manually validate US English,
Canadian English, and Canadian French on mobile and desktop:

- Complete the quiz in a fresh session and check products, prices, and links.
- Reload an answered question, use Back navigation, and reload during loading.
- Check testimonial layout, both product cards, and mobile count updates.
- Confirm local images load and no `newslettersubscription` request is made.

For SVG updates, compare before/after renders and validate internal references.
The current 27 SVGs passed pixel-identical Chromium comparisons at intrinsic,
2x, and 3x sizes after structural cleanup.

Before shipping, run `npm run lint` and `npm run test:unit`.
