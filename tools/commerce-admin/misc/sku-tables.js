export const PROMOTION_HEADER = 'Start\tEnd\tProduct\tRegular Price\tSale Price';

function price(raw) {
  const value = String(raw || '').trim().replace(/^\$/, '').replace(/,/g, '');
  return /^\d+(?:\.\d{1,2})?$/.test(value) ? Number(value).toFixed(2) : '';
}

function colorSlug(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-z]/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function productPath(parent, locale) {
  if (parent.url) {
    try {
      const path = new URL(parent.url).pathname;
      if (path.startsWith(`/${locale}/products/`)) return path;
    } catch {
      // Use the catalog URL key below.
    }
  }
  return parent.urlKey ? `/${locale}/products/${parent.urlKey}` : '';
}

export function convertSkuTable(text, indexRows, locale = 'us/en_us') {
  const catalog = Array.isArray(indexRows) ? indexRows : [];
  const parents = new Map(catalog.filter((item) => item.sku && !item.parentSku)
    .map((item) => [String(item.sku).toUpperCase(), item]));
  const variants = new Map(catalog.filter((item) => item.sku && item.parentSku)
    .map((item) => [String(item.sku).toUpperCase(), item]));
  const groups = new Map();
  const seen = new Map();
  const rows = String(text || '').split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim() || (index === 0 && /^item number\t/i.test(line.trim()))) return [];
    const columns = line.split('\t').map((cell) => cell.trim());
    const sku = columns[0] || '';
    const regular = price(columns[2]);
    const sale = price(columns[3]);
    const issues = [];
    if (columns.length < 4 || !sku) issues.push('Expected SKU, description, regular price, and sale price columns.');
    if (!regular || !sale) issues.push('Regular and sale prices must be valid amounts.');
    if (regular && sale && Number(sale) > Number(regular)) issues.push('Sale price exceeds regular price.');
    const parent = parents.get(sku.toUpperCase());
    const variant = variants.get(sku.toUpperCase());
    if (!parent && !variant) issues.push(`SKU ${sku || '(empty)'} is not in the catalog.`);
    const owner = variant ? parents.get(String(variant.parentSku).toUpperCase()) : parent;
    if (variant && !owner) issues.push(`Parent ${variant.parentSku} is missing from the catalog.`);
    const path = owner ? productPath(owner, locale) : '';
    if (owner && !path) issues.push('Product has no storefront path in this catalog.');
    const catalogPrice = price((variant || parent)?.regularPrice || (variant || parent)?.price);
    const warnings = [];
    if (regular && catalogPrice && regular !== catalogPrice) {
      issues.push(`Regular price differs from ${locale} catalog (${catalogPrice}).`);
    }
    const row = {
      line: index + 1,
      sku,
      description: columns[1] || '',
      regular,
      sale,
      path,
      parentSku: owner?.sku || '',
      variant,
      owner,
      issues,
      warnings,
    };
    if (sku) {
      const previous = seen.get(sku.toUpperCase());
      if (previous) {
        previous.issues.push(`Duplicate SKU ${sku}.`);
        row.issues.push(`Duplicate SKU ${sku}.`);
      } else seen.set(sku.toUpperCase(), row);
    }
    if (owner) {
      const group = groups.get(owner.sku) || [];
      group.push(row);
      groups.set(owner.sku, group);
    }
    return [row];
  });

  const collapsed = new Set();
  const output = [];
  rows.forEach((row) => {
    if (!row.owner) {
      output.push(row);
      return;
    }
    const group = groups.get(row.parentSku);
    const parentRows = group.filter((item) => !item.variant);
    const variantRows = group.filter((item) => item.variant);
    const expected = String(row.owner.variantSkus || '').split(',')
      .map((sku) => sku.trim()).filter(Boolean);
    if (parentRows.length && variantRows.length) {
      row.issues.push('Parent and variant SKUs overlap; choose one representation.');
    }
    const complete = expected.length > 0 && expected.length === variantRows.length
      && expected.every((sku) => variantRows.some((item) => (
        item.sku.toUpperCase() === sku.toUpperCase()
      )));
    const uniform = variantRows.every((item) => item.sale === variantRows[0].sale
      && item.regular === variantRows[0].regular);
    if (row.variant && complete && uniform && !parentRows.length) {
      if (collapsed.has(row.parentSku)) return;
      collapsed.add(row.parentSku);
      output.push({
        ...row,
        sku: variantRows.map((item) => item.sku).join(', '),
        variant: null,
        issues: variantRows.flatMap((item) => item.issues),
        warnings: variantRows.flatMap((item) => item.warnings),
        sourceLines: variantRows.map((item) => item.line),
      });
      return;
    }
    if (row.variant) {
      const slug = colorSlug(row.variant.color);
      if (!slug) row.issues.push('Variant has no color for a promotion URL.');
      else {
        const duplicates = catalog.filter((item) => item.parentSku === row.parentSku
          && colorSlug(item.color) === slug);
        if (duplicates.length > 1) row.issues.push(`Color ${row.variant.color} maps to multiple SKUs.`);
        row.path += `?color=${encodeURIComponent(slug)}`;
      }
      if (!complete) row.warnings.push('Partial variant set; kept as a color-specific path.');
      else if (!uniform) row.warnings.push('Variant prices differ; kept as a color-specific path.');
    }
    output.push(row);
  });

  return {
    rows: output,
    inputCount: rows.length,
    canCopy: output.length > 0
    && rows.every((row) => row.issues.length === 0),
  };
}

export function promotionTsv(rows, start, end) {
  return [PROMOTION_HEADER, ...rows.map((row) => [start, end, row.path, row.regular, row.sale].join('\t'))].join('\n');
}
