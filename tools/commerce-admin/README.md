# Commerce Admin

## Recent catalog changes and index freshness

Every catalog index request bypasses the browser cache and includes a cache-busting
query parameter in the URL sent through fcors. The local fcors implementation has
no explicit response cache, but forwards upstream cache headers.

Successful ProductBus catalog writes (including creation, imports, image sync,
availability changes, production promotion and deletion) record the product path
and update time in `sessionStorage`, scoped by API host, organization and site.
Each locale index load directly re-fetches its pending products without browser
caching and patches parent/variant index rows, including new or removed products.
Unrelated products are not fetched. Failed direct reads surface an error rather
than silently displaying a stale index; the product remains pending for retry.

Pending entries are removed only when the unpatched index matches the direct
product's index fields and variant membership. Non-indexed fields cannot be
compared against an index. Console messages prefixed `[commerce-admin]` report
each revalidation's path, elapsed seconds since the last write, whether the index
has caught up, and failures. The list survives navigation and reloads in this tab
until convergence or the browser session ends.

## Editing product JSON

On product detail, use **Export / import...** in edit mode. The **Editor view**
checkbox in the modal footer switches from raw JSON to a collapsible tree.
Search property names above the tree to highlight matches and hide unrelated
branches. Matching parents keep all their children visible and editable.
Matching nested properties reveal their ancestors. Clearing search restores the
full tree and its previous expansion state; filtering never removes JSON data.
Object and array properties start collapsed; search automatically expands matches.
Opening an array expands all its child branches, without numeric index labels.
Expand or collapse using the chevron after the parent name. Add controls appear
only while the parent is expanded. Array items stay
expanded without their own chevron or a separate Properties/Items heading.
Click a property name or value to edit it; editing boxes stay hidden otherwise.
Click away to finish, or press Escape to cancel the current edit. Changed fields
are highlighted and marked **Modified**; new entries are marked **Added**.
Use **Add property** or **Add item** (document-plus icon) to add entries,
and the trash icon to remove them.
Array elements do not show an **Add property** button. **Add item** copies the
first existing item's properties and nested structure with all scalar values
blank. If all items are removed, the original first item remains the template;
arrays that started empty add a blank string.
New values start as strings. Existing numbers and booleans keep their types,
without a type selector; existing objects and arrays retain their structure.
Switching back preserves the edited JSON. Duplicate names within an object and
invalid numbers must be corrected before switching back, downloading, or
previewing an import. **Preview import** and **Download** use the edited tree;
changes are not saved to the catalog until the existing import confirmation.

## Creating catalog products

In Commerce Admin's production catalog, select **Add new product**. The modal
supports selecting multiple countries using round flags and Household or Commercial
placement. Canada includes both English and French catalogs; Mexico includes both
English and Spanish catalogs automatically.
Images and inferred variants are checked separately for each selected market.
Enter one product name and one price per country on the second
screen. Country flags identify the currency; price inputs format as currency when
leaving the field. All variants and language catalogs in a country share these
prices. The entered price is saved as both regular and final price.
Only the SKU is entered per variant, shared across all markets.
The regular-product Settings screen provides compact, independently selectable chips for `addToCart`,
`comingSoon`, `findDealer`, `findLocally` and `retired`. `addToCart` starts selected
(`Yes`); the other flags start unselected (`No`). Availability still starts OutOfStock.
They are stored as strings in the parent product's `custom` object for every
selected catalog and its variants, and shown in the final review.
On the first screen, a plain **Virtual Bundle** checkbox selects the wizard flow:

| Step | Regular product | Virtual bundle |
| --- | --- | --- |
| 1 | Product assets | Product assets |
| 2 | Product details & pricing | Bundle components |
| 3 | Settings | Bundle details & pricing |
| 4 | Review & create | Review & create |

Bundle components are selected before entering details. The bundle details screen
suggests the union of component categories, summed catalog prices per country,
the URL key as the parent SKU, and URL-key-plus-color variant SKUs. The suggested
product name joins the selected product names with ` + `. These
suggestions are editable. Returning to
components preserves edits, while untouched price suggestions refresh from the
new selection. Bundle buttons default to addToCart Yes and the other flags No;
condition is New, with no promo text or warranty options.
Step 3 also shows component allocations and calculated parent tax and weight.
Allocations list every catalog's component SKUs, colors, full tax classifications
and allocated amounts based on the entered overall bundle price. Color rows are
alternatives, not additional components to sum. Allocations refresh when the
bundle price is changed.
Component rows show catalog, color, SKU, tax classification and source weight.
Weight totals count one variant per component for each bundle color, not all
alternative colors together. Each bundle variant receives its color's total;
the parent uses the largest color total. Missing component weights are shown as
incomplete rather than saved as a partial total. Component weights are used for
calculation only and are not added to the API's `bundleItems` records.
The bundle picker uses the coupon product picker in products-only mode. Select one
of each component: it must exist in every selected catalog and either be simple
or have a unique matching variant for every bundle color, without additional
option dimensions. Nested bundles are not supported.
Compatibility is checked against ProductBus when applying the selection and again
before review; incompatible selections are rejected with the catalog and reason.
The wizard saves `type: "bundle"`, `custom.type: "bundle"` and `bundleItems`,
retaining the asset-derived colors. Each component's current parent catalog final
price is used as its proportional weight; its allocated price is the same for all
colors. Cent rounding is distributed so component prices exactly equal the
entered bundle price in each country. Component SKUs and tax classifications
are retained, and the review shows their allocations.
Selected bundle rows show compact product thumbnails and source catalog prices.
Allocations on the details screen refresh after country prices change.
The settings screen starts with an optional tax-classification picklist and weight.
Its 62 fixed tax combinations come from the US production catalog export dated
2026-10-16; selecting one writes `taxCode`, `taxData.UDF10` and `taxData.UDF11` on
the parent. Weight is optional, defaults to pounds, and writes
both `weight` and `shippingDimensions.weight` on the parent and every variant.
The optional `custom.promoButton` text field appears inside a compact grey `promo:`
badge on the same wrapping row as the other button controls.
An **Advanced Settings** checkbox reveals a bordered container with condition
(New by default, or Refurbished). Condition is saved on
the parent and variants. The Options picklist sits outside Advanced Settings in
its own checkbox-controlled bordered section; collapsing it preserves selections.
Options are the 11 standalone warranty products in the
same export, rather than duplicated legacy option records. Selected option SKUs
are resolved against each selected catalog before review; missing/ambiguous SKUs,
invalid prices and currency mismatches block creation. Local catalog final prices
populate both option `price` and `finalPrice`; the live name, SKU and catalog path
are saved in parent `custom.options`, with `type: "radio"` and `required: "1"`.
Legacy product-specific UIDs are not copied. Review lists tax, weight, condition,
promotional text and local option prices. Advanced Settings only controls visibility:
collapsing it preserves the selected values.
The final review groups images, formatted prices and SKU badges into country
cards with round flags and included locales. Other fields are available under
**Detailed summary**. The **JSON** button to the left of Cancel swaps the summary
for the complete catalog payload array; **Summary** switches back.
Select existing category chips or add a named category on the second screen;
the selection is applied to every created catalog entry. Configurable variants
also receive their own `custom` object with the same categories, button settings,
promo text, options and bundle type as the parent. Existing category URL
keys are retained, and new category URL keys are derived from their names.
Category chips in the catalog, product detail and creation wizard share a
12-color palette selected by a case-insensitive hash of the category name,
independent of category ordering.
Configurable products use their
URL slug as the parent SKU, with no parent SKU input. Canonical and variant URLs
are generated automatically and cannot be edited. Review all catalogs before creating.
Each catalog uses a create-only request. If some writes fail, the wizard reports
partial success and retries only catalogs not yet confirmed created; previously
created catalogs are never overwritten or rolled back.
The modal
requires published `/assets/products/{urlKey}/images.json` assets before continuing.
Use [Product Assets](https://da.live/app/aemsites/vitamix/tools/product-assets/app?ref=product-assets)
to add or correct the assets, publish them, then select **Check again**.
Root-level images become the product gallery; color folders determine configurable
variants, even for a single color. Market-specific rows follow image-sync filtering.
Without color folders the product is simple. The wizard does not edit asset structure.

Review galleries, supply the product name, distinct simple-product/variant SKUs
and prices, then review the complete JSON before creating. Color names and
variant names are derived automatically from the product name and color. All products
and variants start `OutOfStock`, with product `metadata.robots` set to `noindex` and
`metadata.visibility` set to `embargoed`.
These settings do not make the product private. Authored page metadata can override
catalog metadata. No catalog write happens before final confirmation; create-only
requests reject existing paths instead of overwriting them.
