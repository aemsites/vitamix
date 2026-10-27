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
      const key = Object.keys(row).find((column) => column.trim() === name);
      const criterion = normalize(key ? row[key] : '');
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

function buildDecisionTree(questions, rows, selections = {}, questionIndex = 0) {
  if (questionIndex === questions.length) {
    const url = findRecommendation(rows, questions, selections);
    return url ? { type: 'result', url, signature: `result:${url}` } : null;
  }

  const question = questions[questionIndex];
  const options = question.answers
    .map((answer, answerIndex) => {
      selections[question.name] = answer.label;
      const child = buildDecisionTree(questions, rows, selections, questionIndex + 1);
      delete selections[question.name];
      return child ? { answerIndex, child } : null;
    })
    .filter(Boolean);

  if (!options.length) return null;
  if (options.every(({ child }) => child.signature === options[0].child.signature)) {
    return options[0].child;
  }

  const signature = JSON.stringify([
    questionIndex,
    options.map(({ answerIndex, child }) => [answerIndex, child.signature]),
  ]);
  return {
    type: 'question',
    questionIndex,
    options,
    signature,
  };
}

function getDecisionTreeDepth(node) {
  if (node.type === 'result') return 0;
  return 1 + Math.max(...node.options.map(({ child }) => getDecisionTreeDepth(child)));
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
    label.dataset.answerIndex = i;

    const input = document.createElement('input');
    input.type = 'radio';
    input.id = id;
    input.name = `recommender-q${index + 1}`;
    input.value = answer.label;
    input.dataset.answerIndex = i;

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
  const decisionTree = buildDecisionTree(questions, recommendations);
  if (!decisionTree) {
    widget.dataset.stage = 'error';
    return;
  }
  // fetched up front so the result renders without a delay
  const productsLoaded = loadProducts().catch(() => null);
  const quizEl = widget.querySelector('.quiz');
  const progressEl = widget.querySelector('progress');
  const stepLabelEl = widget.querySelector('.step-label');
  const prevBtn = widget.querySelector('.prev');
  const nextBtn = widget.querySelector('.next');
  const nextLabel = nextBtn.textContent;
  const total = Math.max(getDecisionTreeDepth(decisionTree), 1);

  const fieldsets = questions.map(buildQuestion);
  quizEl.append(...fieldsets);
  widget.querySelector('.step-total').textContent = total;
  progressEl.max = total;

  let currentNode = decisionTree;
  let trail = [];
  let pendingSelection = null;
  let renderVersion = 0;

  const pushAnswers = () => {
    const url = new URL(window.location.href);
    questions.forEach(({ name }) => url.searchParams.delete(name));
    trail.forEach(({ node, answerIndex }) => {
      const question = questions[node.questionIndex];
      url.searchParams.set(question.name, question.answers[answerIndex].label);
    });
    if (url.href !== window.location.href) {
      window.history.pushState(window.history.state, '', url);
    }
  };

  const updateNext = () => {
    const fieldset = fieldsets[currentNode.questionIndex];
    const selected = fieldset.querySelector('input:checked');
    const selectedIndex = selected ? Number(selected.dataset.answerIndex) : -1;
    const option = currentNode.options.find(({ answerIndex }) => answerIndex === selectedIndex);
    nextBtn.disabled = !option;
    nextBtn.textContent = option?.child.type === 'result' ? 'See My Recommendation' : nextLabel;
  };

  const showResults = async (url, version) => {
    const href = toHref(url);
    if (!href) {
      widget.dataset.stage = 'error';
      return;
    }

    nextBtn.disabled = true;
    const products = await productsLoaded;
    if (version !== renderVersion) return;
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

  const showNode = (node, focus = true) => {
    renderVersion += 1;
    currentNode = node;
    fieldsets.forEach((fs) => { fs.hidden = true; });
    if (node.type === 'result') {
      showResults(node.url, renderVersion);
      return;
    }

    widget.dataset.stage = 'quiz';
    const { questionIndex, options } = node;
    const fieldset = fieldsets[questionIndex];
    fieldset.hidden = false;
    fieldset.querySelectorAll('input').forEach((input) => {
      input.checked = false;
      input.closest('label').hidden = true;
    });
    options.forEach(({ answerIndex }) => {
      const input = fieldset.querySelector(`input[data-answer-index="${answerIndex}"]`);
      input.closest('label').hidden = false;
    });
    if (pendingSelection !== null) {
      const input = fieldset.querySelector(`input[data-answer-index="${pendingSelection}"]`);
      const optionIsAvailable = options.some(
        ({ answerIndex }) => answerIndex === pendingSelection,
      );
      if (input && optionIsAvailable) input.checked = true;
      pendingSelection = null;
    }
    if (focus) fieldset.focus();

    const step = trail.length + 1;
    progressEl.value = step - 1;
    stepLabelEl.textContent = step;
    prevBtn.hidden = trail.length === 0;
    updateNext();
  };

  const restoreAnswers = (focus = true) => {
    const params = new URL(window.location.href).searchParams;
    trail = [];
    pendingSelection = null;
    let node = decisionTree;
    while (node.type === 'question') {
      const question = questions[node.questionIndex];
      const answer = params.get(question.name);
      if (answer === null) break;
      const option = node.options.find(
        ({ answerIndex }) => normalize(question.answers[answerIndex].label) === normalize(answer),
      );
      if (!option) break;
      trail.push({ node, answerIndex: option.answerIndex });
      node = option.child;
    }
    showNode(node, focus);
  };

  nextBtn.addEventListener('click', () => {
    const fieldset = fieldsets[currentNode.questionIndex];
    const selected = fieldset.querySelector('input:checked');
    const selectedIndex = selected ? Number(selected.dataset.answerIndex) : -1;
    const option = currentNode.options.find(({ answerIndex }) => answerIndex === selectedIndex);
    if (!option) return;
    trail.push({ node: currentNode, answerIndex: selectedIndex });
    pushAnswers();
    showNode(option.child);
  });

  prevBtn.addEventListener('click', () => {
    const previous = trail.pop();
    if (!previous) return;
    pendingSelection = previous.answerIndex;
    pushAnswers();
    showNode(previous.node);
  });

  widget.querySelector('button[type="reset"]').addEventListener('click', () => {
    widget.querySelectorAll('input:checked').forEach((input) => { input.checked = false; });
    trail = [];
    pendingSelection = null;
    pushAnswers();
    widget.dataset.stage = 'quiz';
    showNode(decisionTree);
  });

  widget.addEventListener('change', (e) => {
    if (e.target.closest('fieldset') && currentNode.type === 'question') {
      updateNext();
    }
  });

  window.addEventListener('popstate', () => restoreAnswers());

  widget.dataset.stage = 'quiz';
  restoreAnswers(false);
}
