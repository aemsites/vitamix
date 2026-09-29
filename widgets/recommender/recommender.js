import { createOptimizedPicture, fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage, formatPrice } from '../../scripts/scripts.js';
import {
  fetchProductIndex, buildProductIndexBySlug, slugFromUrl, createStarRating,
} from '../../scripts/plp-data.js';

const normalize = (value) => (value || '').trim().toLowerCase();

/**
 * Groups sheet rows into questions; rows with an empty "Questions" cell
 * are additional answers for the preceding question.
 * @param {Object[]} rows - Rows from the "questions" sheet
 * @returns {{ name: string, detail: string, answers: { label: string, detail: string }[] }[]}
 */
function parseQuestions(rows) {
  const questions = [];
  rows.forEach((row) => {
    const name = (row.Questions || '').trim();
    if (name) questions.push({ name, detail: (row['Question Details'] || '').trim(), answers: [] });
    const current = questions[questions.length - 1];
    const label = (row.Answers || '').trim();
    if (current && label) {
      current.answers.push({ label, detail: (row['Answer Details'] || '').trim() });
    }
  });
  return questions.filter((q) => q.answers.length);
}

/**
 * Picks the most specific recommendation row whose non-empty criteria all match.
 * Empty cells act as wildcards; ties resolve to the earliest row in the sheet.
 * @param {Object[]} rows - Rows from the "recommendations" sheet
 * @param {Object[]} questions - Parsed questions
 * @param {Object<string, string>} selections - Selected answer label keyed by question name
 * @returns {string|undefined} Recommendation URL
 */
function findRecommendation(rows, questions, selections) {
  let best;
  let bestScore = -1;
  rows.forEach((row) => {
    let score = 0;
    const matches = questions.every(({ name }) => {
      const criterion = normalize(row[name]);
      if (!criterion) return true;
      if (criterion !== normalize(selections[name])) return false;
      score += 1;
      return true;
    });
    if (matches && score > bestScore) {
      best = row;
      bestScore = score;
    }
  });
  return best?.Recommendation;
}

/**
 * Converts a recommendation URL into a safe href, relative when it points at production.
 * @param {string} url
 * @returns {string|null}
 */
function toHref(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.hostname === 'www.vitamix.com') return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.href;
  } catch (e) {
    return null;
  }
}

function buildQuestion(question, index) {
  const fieldset = document.createElement('fieldset');
  fieldset.dataset.step = index + 1;
  fieldset.dataset.question = question.name;
  fieldset.tabIndex = -1;
  fieldset.hidden = true;

  const legend = document.createElement('legend');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = question.name;
  legend.append(eyebrow, question.detail || question.name);
  fieldset.append(legend);

  const options = document.createElement('div');
  options.className = 'options';
  question.answers.forEach((answer, i) => {
    const id = `recommender-q${index + 1}-a${i + 1}`;
    const label = document.createElement('label');
    label.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'radio';
    input.id = id;
    input.name = `recommender-q${index + 1}`;
    input.value = answer.label;

    const text = document.createElement('span');
    text.className = 'text';
    const name = document.createElement('strong');
    name.textContent = answer.label;
    text.append(name);
    if (answer.detail) {
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = answer.detail;
      text.append(detail);
    }

    label.append(input, text);
    options.append(label);
  });
  fieldset.append(options);
  return fieldset;
}

/**
 * Loads the product index and placeholders used to render the recommended product card.
 * @returns {Promise<{ bySlug: Object, ph: Object }>}
 */
async function loadProducts() {
  const { locale, language } = getLocaleAndLanguage();
  const [data, ph] = await Promise.all([
    fetchProductIndex(locale, language),
    fetchPlaceholders(`/${locale}/${language}/products/config`),
  ]);
  return { bySlug: buildProductIndexBySlug(data, locale, language), ph };
}

function createPrice(product, ph) {
  const price = document.createElement('p');
  price.className = 'price';
  const variantPrices = (product.variants || [])
    .map((v) => Number(v.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  const varying = variantPrices.length > 1
    && Math.min(...variantPrices) !== Math.max(...variantPrices);

  if (varying) {
    const label = document.createElement('span');
    label.className = 'price-label';
    label.textContent = ph.startingAt || 'Starting at';
    price.append(label);
  }

  const amount = document.createElement('span');
  amount.className = 'price-amount';
  amount.textContent = formatPrice(varying ? Math.min(...variantPrices) : product.price, ph);
  const regular = product.originalPrice || product.regularPrice;
  if (!varying && regular > product.price) {
    const del = document.createElement('del');
    del.textContent = formatPrice(regular, ph);
    amount.append(' ', del);
  }
  price.append(amount);
  return price;
}

function createProductCard(product, ph) {
  const card = document.createElement('div');
  card.className = 'product-card';

  const imageLink = document.createElement('a');
  imageLink.className = 'image';
  imageLink.href = product.url;
  imageLink.tabIndex = -1;
  const src = product.image || product.variants?.find((v) => v.image)?.image;
  if (src) {
    imageLink.append(createOptimizedPicture(src, product.title, false, [
      { media: '(min-width: 600px)', width: '1200' },
      { width: '750' },
    ]));
  }

  const info = document.createElement('div');
  info.className = 'info';

  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = product.url;
  titleLink.textContent = product.title;
  title.append(titleLink);
  info.append(title);

  const rating = createStarRating({
    reviewCount: parseInt(product.reviewCount, 10) || 0,
    reviewAverage: parseFloat(product.ratingValue) || 0,
  });
  if (rating.children.length) info.append(rating);

  if (product.description) {
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = product.description;
    info.append(description);
  }

  if (product.price) info.append(createPrice(product, ph));

  const cta = document.createElement('p');
  cta.className = 'button-wrapper';
  const shopNow = document.createElement('a');
  shopNow.className = 'button emphasis';
  shopNow.href = product.url;
  shopNow.textContent = ph.shopNow || 'Shop Now';
  cta.append(shopNow);
  info.append(cta);

  card.append(imageLink, info);
  return card;
}

async function loadConfig(config) {
  const { locale, language } = getLocaleAndLanguage();
  const resp = await fetch(`/${locale}/${language}/blender-recommender/${config}.json`);
  if (!resp.ok) throw new Error(`Failed to load recommender config: ${resp.status}`);
  const json = await resp.json();
  return {
    questions: parseQuestions(json.questions?.data || []),
    recommendations: json.recommendations?.data || [],
  };
}

export default async function decorate(widget) {
  const { config } = widget.dataset;

  let data;
  try {
    if (!config || !/^[a-z0-9-]+$/i.test(config)) throw new Error('Missing or invalid config');
    data = await loadConfig(config);
    if (!data.questions.length) throw new Error('No questions found');
  } catch (e) {
    widget.dataset.stage = 'error';
    return;
  }

  const { questions, recommendations } = data;
  // fetched up front so the result renders without a delay
  const productsLoaded = loadProducts().catch(() => null);
  const quizEl = widget.querySelector('.quiz');
  const progressEl = widget.querySelector('progress');
  const stepLabelEl = widget.querySelector('.step-label');
  const prevBtn = widget.querySelector('.prev');
  const nextBtn = widget.querySelector('.next');
  const nextLabel = nextBtn.textContent;
  const total = questions.length;

  const fieldsets = questions.map(buildQuestion);
  quizEl.append(...fieldsets);
  widget.querySelector('.step-total').textContent = total;
  progressEl.max = total;

  let currentStep = 1;

  const updateNext = () => {
    nextBtn.disabled = !fieldsets[currentStep - 1].querySelector('input:checked');
  };

  const showStep = (step, focus = true) => {
    currentStep = step;
    fieldsets.forEach((fs) => { fs.hidden = true; });
    const fieldset = fieldsets[step - 1];
    fieldset.hidden = false;
    if (focus) fieldset.focus();

    progressEl.value = step - 1;
    stepLabelEl.textContent = step;
    prevBtn.hidden = step === 1;
    nextBtn.textContent = step === total ? 'See My Recommendation' : nextLabel;
    updateNext();
  };

  const showResults = async () => {
    const selections = {};
    fieldsets.forEach((fs) => {
      selections[fs.dataset.question] = fs.querySelector('input:checked')?.value;
    });
    const href = toHref(findRecommendation(recommendations, questions, selections));
    if (!href) {
      widget.dataset.stage = 'error';
      return;
    }

    nextBtn.disabled = true;
    const products = await productsLoaded;
    const { pathname } = new URL(href, window.location.origin);
    const product = pathname.includes('/products/') && products?.bySlug[slugFromUrl(pathname)];
    const productEl = widget.querySelector('.results .product');
    const fallbackEl = widget.querySelector('.results .fallback');
    if (product) {
      productEl.replaceChildren(createProductCard(product, products.ph));
    } else {
      productEl.replaceChildren();
      fallbackEl.querySelector('a').href = href;
    }
    productEl.hidden = !product;
    fallbackEl.hidden = !!product;

    progressEl.value = total;
    widget.dataset.stage = 'results';
    widget.querySelector('.results h2').focus();
  };

  nextBtn.addEventListener('click', () => {
    if (currentStep === total) showResults();
    else showStep(currentStep + 1);
  });

  prevBtn.addEventListener('click', () => showStep(currentStep - 1));

  widget.querySelector('button[type="reset"]').addEventListener('click', () => {
    widget.querySelectorAll('input:checked').forEach((input) => { input.checked = false; });
    widget.dataset.stage = 'quiz';
    showStep(1);
  });

  widget.addEventListener('change', (e) => {
    if (e.target.closest('fieldset')) updateNext();
  });

  widget.dataset.stage = 'quiz';
  showStep(1, false);
}
