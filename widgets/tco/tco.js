import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Loads widget copy from the co-located JSON file for the given language.
 * @param {string} lang - Language key (e.g. "en", "fr")
 * @returns {Promise<Object>} Flat key-value copy object for that language
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const base = window.hlx && window.hlx.codeBasePath ? window.hlx.codeBasePath : '';
  const resp = await fetch(`${base}${jsonPath}`);
  const data = await resp.json();
  return data[lang] || data.en || {};
}

/**
 * Applies widget copy to all text nodes and attributes in the widget.
 * @param {HTMLElement} widget - The .tco element
 * @param {Object} copy - Flat key-value copy object
 */
function applyWidgetCopy(widget, copy) {
  widget.querySelector('form').setAttribute('aria-label', copy.formLabel || '');
  widget.querySelector('.tco-results').setAttribute('aria-label', copy.resultsLabel || '');

  widget.querySelector('label[for="tco-model"]').textContent = copy.model || '';
  widget.querySelector('#tco-model option[value=""]').textContent = copy.selectModel || '';
  widget.querySelector('label[for="tco-msrp"]').textContent = copy.msrp || '';
  widget.querySelector('label[for="tco-profit"]').textContent = copy.profit || '';
  widget.querySelector('label[for="tco-blends-per-day"]').textContent = copy.blendsPerDay || '';
  widget.querySelector('label[for="tco-operating-days"]').textContent = copy.operatingDays || '';
  widget.querySelector('label[for="tco-blend-time"]').textContent = copy.blendTime && copy.seconds
    ? `${copy.blendTime} (${copy.seconds})`
    : '';

  widget.querySelector('#tco-dt-faster-blend-time').textContent = copy.fasterBlendTime && copy.seconds
    ? `${copy.fasterBlendTime} (${copy.seconds})`
    : '';
  widget.querySelector('#tco-dt-warranty-days').textContent = copy.motorWarranty && copy.days
    ? `${copy.motorWarranty} (${copy.days})`
    : '';
  widget.querySelector('#tco-dt-warranty-hours').textContent = copy.motorWarranty && copy.hours
    ? `${copy.motorWarranty} (${copy.hours})`
    : '';
  widget.querySelector('#tco-dt-break-even').textContent = copy.breakEven || '';
  widget.querySelector('#tco-dt-cost-per-blend-days').textContent = copy.costPerBlend && copy.days
    ? `${copy.costPerBlend} (${copy.days})`
    : '';
  widget.querySelector('#tco-dt-cost-per-blend-hours').textContent = copy.costPerBlend && copy.hours
    ? `${copy.costPerBlend} (${copy.hours})`
    : '';
}

/**
 * Pure calculation for the TCO widget.
 * @param {Object|null} model - Selected model {label, warrantyDays, warrantyHours}
 * @param {number} msrp - Machine purchase price in dollars
 * @param {number} profit - Profit per blended item in dollars
 * @param {number} blendsPerDay - Number of blends per operating day
 * @param {number} operatingDays - Operating days per week
 * @param {number} blendTime - Average blend time in seconds
 * @returns {Object} Derived display values and calculated results
 */
function calculate(model, msrp, profit, blendsPerDay, operatingDays, blendTime) {
  const isQuickAndQuiet = model !== null && model.warrantyHours !== null;

  const fasterBlendTime = isQuickAndQuiet && blendTime > 0
    ? blendTime * 0.7
    : null;

  const warrantyDays = model ? model.warrantyDays : null;
  const warrantyHours = model ? model.warrantyHours : null;

  let breakEven = null;
  if (msrp > 0 && profit > 0 && blendsPerDay > 0) {
    breakEven = Math.round(msrp / (profit * blendsPerDay));
  }

  let costPerBlendDays = null;
  const warrantyValid = warrantyDays !== null && warrantyDays > 0;
  if (msrp > 0 && blendsPerDay > 0 && operatingDays > 0 && warrantyValid) {
    costPerBlendDays = msrp / (blendsPerDay * operatingDays * warrantyDays);
  }

  let costPerBlendHours = null;
  if (isQuickAndQuiet && msrp > 0 && blendTime > 0) {
    costPerBlendHours = msrp / (2520000 / (blendTime * 0.7));
  }

  return {
    fasterBlendTime,
    warrantyDays,
    warrantyHours,
    breakEven,
    costPerBlendDays,
    costPerBlendHours,
  };
}

/**
 * Reads and parses user input values from the widget.
 * @param {HTMLElement} widget - The .tco element
 * @param {Array<Object>} models - Array of model objects
 * @returns {Object} Parsed input values keyed by field name
 */
function readInputs(widget, models) {
  const modelIndex = parseInt(widget.querySelector('#tco-model').value, 10);
  const model = Number.isNaN(modelIndex) ? null : (models[modelIndex] || null);

  return {
    model,
    msrp: parseFloat(widget.querySelector('#tco-msrp').value) || 0,
    profit: parseFloat(widget.querySelector('#tco-profit').value) || 0,
    blendsPerDay: parseFloat(widget.querySelector('#tco-blends-per-day').value) || 0,
    operatingDays: parseFloat(widget.querySelector('#tco-operating-days').value) || 0,
    blendTime: parseFloat(widget.querySelector('#tco-blend-time').value) || 0,
  };
}

/**
 * Updates result displays from calculation output.
 * @param {HTMLElement} widget - The .tco element
 * @param {Object} results - Output from calculate()
 */
function updateDisplay(widget, results) {
  const na = '—';

  widget.querySelector('#tco-faster-blend-time').value = results.fasterBlendTime !== null
    ? results.fasterBlendTime.toFixed(2)
    : na;

  widget.querySelector('#tco-warranty-days').value = results.warrantyDays !== null
    ? String(results.warrantyDays)
    : na;

  widget.querySelector('#tco-warranty-hours').value = results.warrantyHours !== null
    ? String(results.warrantyHours)
    : na;

  widget.querySelector('#tco-break-even').value = results.breakEven !== null
    ? String(results.breakEven)
    : na;

  widget.querySelector('#tco-cost-per-blend-days').value = results.costPerBlendDays !== null
    ? `$${results.costPerBlendDays.toFixed(4)}`
    : na;

  widget.querySelector('#tco-cost-per-blend-hours').value = results.costPerBlendHours !== null
    ? `$${results.costPerBlendHours.toFixed(4)}`
    : na;

  const meter = widget.querySelector('#tco-break-even-meter');
  if (results.breakEven !== null && results.warrantyDays !== null) {
    meter.max = results.warrantyDays;
    meter.low = Math.round(results.warrantyDays * 0.33);
    meter.high = Math.round(results.warrantyDays * 0.67);
    meter.optimum = 0;
    meter.value = Math.min(results.breakEven, results.warrantyDays);
    meter.removeAttribute('hidden');
  } else {
    meter.setAttribute('hidden', '');
  }
}

/**
 * Decorates the TCO calculator widget: loads copy, populates model options,
 * wires listeners, and runs an initial calculation pass.
 * @param {HTMLElement} widget - The .tco element
 */
export default async function decorate(widget) {
  const { language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);

  applyWidgetCopy(widget, copy);

  const models = [
    { label: 'Quick & Quiet™', warrantyDays: 1460, warrantyHours: 700 },
    { label: 'The Quiet One®', warrantyDays: 1095, warrantyHours: null },
    { label: 'Touch & Go™ Advance®', warrantyDays: 1095, warrantyHours: null },
    { label: 'Drink Machine Advance®', warrantyDays: 1095, warrantyHours: null },
    { label: 'Drink Machine Two-Speed', warrantyDays: 1095, warrantyHours: null },
    { label: 'Vita-Prep® 3', warrantyDays: 1095, warrantyHours: null },
    { label: 'Vita-Prep®', warrantyDays: 1095, warrantyHours: null },
    { label: 'XL®', warrantyDays: 1095, warrantyHours: null },
  ];

  const select = widget.querySelector('#tco-model');
  models.forEach((model, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = model.label;
    select.appendChild(option);
  });

  const run = () => {
    const {
      model, msrp, profit, blendsPerDay, operatingDays, blendTime,
    } = readInputs(widget, models);
    if (model && model.warrantyHours !== null) {
      widget.setAttribute('data-model', 'quick-and-quiet');
    } else {
      widget.removeAttribute('data-model');
    }
    updateDisplay(widget, calculate(model, msrp, profit, blendsPerDay, operatingDays, blendTime));
  };

  widget.querySelector('form').addEventListener('submit', (e) => e.preventDefault());

  widget.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', run);
    el.addEventListener('change', run);
  });

  run();
}
