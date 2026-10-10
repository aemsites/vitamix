# Product Assets

DA Live app for reviewing product imagery stored in `/assets/products/`.

Open at `https://da.live/app/<org>/<repo>/tools/product-assets/app`.

## List (`app.html`)

1. Lists every subfolder of `/<org>/<repo>/assets/products/` (each folder is a product slug).
2. Fetches `/assets/products/<slug>/images.json` from DA for each product, a few at a time, and adds rows in alphabetical order as each one loads.
3. Each row shows the slug with image/variant counts, one color swatch per variant, and the first 5 images (`+N` for the rest).
4. The search bar filters as you type on slug or variant color. Matching text in the slug is highlighted, and matching swatches get a ring. The query is kept in `?q=`.
5. Clicking a row opens the details view.
6. **+ Add product** (next to the count) asks for a product slug; it doesn't need to exist in a product catalog yet, so images can be prepared ahead of the product. Input is slugged (lowercase, dashes). Create saves an empty `images.json` in `/assets/products/<slug>/` and opens its details page to add images.

## Details (`details.html?product=<slug>`)

The header links to the product in [product admin](https://product-admin--vitamix--aemsites.aem.live/tools/commerce-admin/catalog.html) for each locale whose product index (`/<locale>/products/index.json`) contains a parent product with the same slug, and **Open folder** opens the product's assets folder in DA. Locale indexes are read through the same CORS proxy as `tools/commerce-admin`, and cached in session storage for 10 minutes.

Shows all images as thumbnails, grouped by variant color. Images without a color folder show first under "All variants". Each variant group has its swatch color as a top border and a light tint of that color as its background.

Editing (changes stay local until saved):

- **Reorder / move:** drag images within a group to reorder them, or onto another group (color variant or "All variants") to move them there. Moving changes the image's `Path` folder (e.g. `white/x.jpg` → `black/x.jpg`), and the file is moved in DA when you save. Dragging an image back to its original group restores its original path. Alt+Arrow keys reorder within a group. To move several at once, click images to select them (Shift+click selects a range), then drag any selected image; the others follow in their current order. Esc or Clear empties the selection. Moved or edited images get an orange dot. External (`https://…`) images can't be moved into a color.
- **Add variants:** **+ Add variants** below the groups opens a searchable list of every color in the swatch config, docked to the side. It stays open while you add as many variants as you like: each new group is added and scrolled into view (with a brief highlight) behind the panel. Click an added color again to remove it while it's still empty, and press Enter in the search box to add the first match. Close with Done, × or Esc. New groups are drag and drop targets and are only kept if they have images when you save.
- **Edit an image:** hover it and click **Edit** (or press E when it has focus) to open a dialog for its Label, YouTube video URL (validated, with a thumbnail preview) and Markets (flag toggles; none selected = all markets). Edited images get an orange dot. **Delete image** in the dialog removes it from the page; on save the row is removed from `images.json` and the file is deleted from DA (Discard undoes it). For images added but not yet saved it just drops them.
- **Add images:** drop images, folders or `.zip` files on a group to add them to that group. "All variants" is the main product; color groups are variants. Drop anywhere else on the page to sort files by folder name: a file in a folder named like a variant color (e.g. `white/` or `kit/black/`, matched against existing variants and the swatch config) goes to that variant, others go to the main product. Zips are unpacked in the browser (their name counts as a folder); non-image files and `__MACOSX`/dotfiles are skipped. File names are slugged to lowercase, dash-separated names plus a lowercase extension (`Café_Front Shot (2).JPEG` → `cafe-front-shot-2.jpg`) and get a `-2` suffix if the name already exists. New images get a green "New" badge, and can be edited, reordered or removed (× / Delete) before saving. They stay in memory until saved.
- **Save:** when there are changes, a bar at the top shows Save / Discard (Cmd/Ctrl+S also saves). Discard reverts immediately, without asking. Saving first moves files for images that changed group, then uploads any new images to `/assets/products/<slug>/[<color>/]<file>` in DA, then writes `images.json` back to DA (creating it if it doesn't exist yet), then deletes the files of deleted images. It then previews and publishes every new or moved image followed by `images.json` (via the AEM admin API, on `main`), and removes moved-away and deleted files from live and preview. Save succeeds even if a preview/publish step fails; the error is shown and logged to the console. `images.json` keeps its sheet format, other columns and other sheets. If the file changed in DA after the page loaded, you're asked before overwriting it. Leaving the page with unsaved changes asks for confirmation.

## `images.json`

Columns: `Path`, `Label`, `Video`, `Category`, `Subcategory`, `Market`.

- A folder prefix in `Path` (e.g. `white/a3500-white-front.png`) marks the variant color. Swatch colors come from `/us/en_us/products/config/color-swatches.json`; colors missing from that config show as hatched swatches.
- `Market` (comma-separated, e.g. `US,CA`) is shown as flag badges on each thumbnail, using `/icons/flag-<market>.svg`. Images with no market apply to all markets and get no badge.
- Images load from same-origin `/assets/products/...` URLs. If an image fails to load (for example, it hasn't been previewed yet), it falls back to the DA source.
