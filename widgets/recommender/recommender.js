import { fetchPlaceholders } from '../../scripts/aem.js';
import {
  getLocaleAndLanguage, formatPrice, getOfferPricing, hasSimulatedDate,
} from '../../scripts/scripts.js';

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

  const notice = document.createElement('p');
  notice.className = 'advance-notice';
  notice.id = `recommender-q${index + 1}-notice`;
  notice.textContent = 'Choose an answer to continue automatically. Use Tab to move between answers and Enter or Space to choose.';
  fieldset.setAttribute('aria-describedby', notice.id);
  fieldset.append(notice);

  const options = document.createElement('div');
  options.className = 'options';
  question.answers.forEach((answer, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer';
    button.dataset.answerIndex = i;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-describedby', notice.id);

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

    const selectionCheck = document.createElement('span');
    selectionCheck.className = 'selection-check';
    selectionCheck.setAttribute('aria-hidden', 'true');
    const checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    checkIcon.setAttribute('viewBox', '0 0 24 24');
    checkIcon.setAttribute('focusable', 'false');
    const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'm5 12.5 4.5 4.5L19 7.5');
    checkPath.setAttribute('fill', 'none');
    checkPath.setAttribute('stroke', 'currentColor');
    checkPath.setAttribute('stroke-width', '3');
    checkPath.setAttribute('stroke-linecap', 'round');
    checkPath.setAttribute('stroke-linejoin', 'round');
    checkIcon.append(checkPath);
    selectionCheck.append(checkIcon);

    button.append(text, selectionCheck);
    options.append(button);
  });
  fieldset.append(options);
  return fieldset;
}

/**
 * Loads only the recommended page, using its Product JSON-LD and Open Graph metadata.
 * @param {string} href - Recommended product URL
 * @returns {Promise<Object>} Product card data
 */
async function loadProduct(href) {
  const { hostname } = window.location;
  const isProd = hostname === 'vitamix.com' || hostname.endsWith('.vitamix.com')
    || hostname.endsWith('.aem.network');
  const networkOrigin = 'https://main--vitamix--aemsites.aem.network';
  const pageUrl = new URL(href, window.location.href);
  if (!isProd) {
    pageUrl.protocol = 'https:';
    pageUrl.host = new URL(networkOrigin).host;
    pageUrl.port = '';
  }
  const requestUrl = isProd
    ? pageUrl.href
    : `https://fcors.org/?url=${encodeURIComponent(pageUrl.href)}&key=Mg23N96GgR8O3NjU`;
  const response = await fetch(requestUrl);
  if (!response.ok) throw new Error(`Failed to load recommended product: ${response.status}`);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const metadata = (name) => doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
    ?.content.trim();
  let product;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    if (product) return;
    const parsed = JSON.parse(script.textContent);
    const candidates = (Array.isArray(parsed) ? parsed : [parsed])
      .flatMap((node) => (Array.isArray(node?.['@graph']) ? node['@graph'] : [node]));
    product = candidates.find((node) => node && (
      node['@type'] === 'Product'
      || (Array.isArray(node['@type']) && node['@type'].includes('Product'))
    ));
  });
  if (product && hasSimulatedDate()) {
    const { simulatedJsonLd } = await import('../../scripts/simulated-prices.js');
    product = await simulatedJsonLd(product, pageUrl.pathname);
  }
  const title = product?.name || metadata('og:title') || doc.title.trim();
  if (!title) throw new Error('Recommended product page has no title');
  const offers = product?.offers;
  const variants = (Array.isArray(offers) ? offers : [offers])
    .filter(Boolean)
    .map((offer) => ({
      ...getOfferPricing(offer),
      price: Number(offer.price ?? offer.lowPrice),
      currency: offer.priceCurrency,
    }))
    .filter((offer) => Number.isFinite(offer.price) && offer.price > 0);
  const lowest = variants.reduce(
    (best, offer) => (!best || offer.price < best.price ? offer : best),
    null,
  );
  const image = metadata('og:image');
  const imageBase = isProd ? new URL(response.url || pageUrl.href) : pageUrl;
  const imageUrl = image ? new URL(image, imageBase) : null;
  if (imageUrl && !['http:', 'https:'].includes(imageUrl.protocol)) {
    throw new Error('Recommended product page has an invalid og:image URL');
  }
  if (imageUrl && !isProd) {
    imageUrl.protocol = 'https:';
    imageUrl.host = pageUrl.host;
    imageUrl.port = '';
  }
  return {
    url: href,
    title,
    description: product?.description || metadata('og:description') || metadata('description'),
    image: imageUrl?.href,
    price: lowest?.price,
    regularPrice: lowest?.regular,
    currency: lowest?.currency,
    variants,
    reviewCount: product?.aggregateRating?.reviewCount || product?.aggregateRating?.ratingCount,
    ratingValue: product?.aggregateRating?.ratingValue,
  };
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

function createProductCard(product, ph, answers) {
  const card = document.createElement('div');
  card.className = 'product-card';

  const imageLink = document.createElement('a');
  imageLink.className = 'image';
  imageLink.href = product.url;
  imageLink.tabIndex = -1;
  if (product.image) {
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = product.title;
    image.loading = 'lazy';
    imageLink.append(image);
  }

  const badge = document.createElement('p');
  badge.className = 'match-badge';
  badge.textContent = 'Their perfect match';

  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = product.url;
  titleLink.textContent = product.title;
  title.append(titleLink);
  card.append(imageLink, badge, title);

  if (product.description) {
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = product.description;
    card.append(description);
  }

  if (answers.length) {
    const picks = document.createElement('div');
    picks.className = 'picks';
    const heading = document.createElement('p');
    heading.className = 'picks-heading';
    heading.textContent = 'Matches your picks';
    const list = document.createElement('ul');
    answers.forEach((answer) => {
      const item = document.createElement('li');
      item.textContent = answer;
      list.append(item);
    });
    picks.append(heading, list);
    card.append(picks);
  }

  if (product.price) {
    card.append(createPrice(product, {
      ...ph,
      currencyCode: product.currency || ph.currencyCode,
    }));
  }

  const cta = document.createElement('p');
  cta.className = 'button-wrapper';
  const shopNow = document.createElement('a');
  shopNow.className = 'button emphasis';
  shopNow.href = product.url;
  shopNow.textContent = ph.shopNow || 'Shop Now';
  cta.append(shopNow);
  card.append(cta);
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
  const productPages = new Map();
  const quizEl = widget.querySelector('.quiz');
  const stepLabelEl = widget.querySelector('.step-label');
  const stepNameEl = widget.querySelector('.step-name');
  const prevBtn = widget.querySelector('.prev');
  const stepsEl = widget.querySelector('.steps');
  const matchesEl = widget.querySelector('.matches');
  const matchListEl = widget.querySelector('.match-list');
  const total = Math.max(getDecisionTreeDepth(decisionTree), 1);

  const fieldsets = questions.map(buildQuestion);
  quizEl.append(...fieldsets);
  const stepItems = questions.map((question, index) => {
    const item = document.createElement('span');
    item.className = 'step';
    item.setAttribute('role', 'img');
    item.dataset.questionIndex = index;
    const check = document.createElement('span');
    check.className = 'step-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '\u2713';
    const label = document.createElement('span');
    label.className = 'step-text';
    label.textContent = question.name;
    item.append(check, label);
    stepsEl.append(item);
    return item;
  });
  widget.querySelector('.step-total').textContent = total;

  let currentNode = decisionTree;
  let trail = [];
  let pendingSelection = null;
  let renderVersion = 0;
  let matchRenderVersion = 0;
  let advanceTimer = null;

  const updateSteps = (activeIndex = -1, complete = false) => {
    stepItems.forEach((item, index) => {
      const visited = trail.some(({ node }) => node.questionIndex === index);
      const stepComplete = complete || visited || index < activeIndex;
      item.classList.toggle('is-current', !complete && index === activeIndex);
      item.classList.toggle('is-complete', stepComplete);
      item.setAttribute('aria-label', `${questions[index].name}${stepComplete ? ', complete' : ''}`);
      if (!complete && index === activeIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  };

  const renderMatches = async (version) => {
    matchRenderVersion += 1;
    const matchVersion = matchRenderVersion;
    const selected = Object.fromEntries(trail.map(({ node, answerIndex }) => {
      const question = questions[node.questionIndex];
      return [question.name, question.answers[answerIndex].label];
    }));
    if (currentNode.type === 'question') {
      const currentQuestion = questions[currentNode.questionIndex];
      const checked = fieldsets[currentNode.questionIndex].querySelector('.answer[aria-pressed="true"]');
      if (checked) {
        const answerIndex = Number(checked.dataset.answerIndex);
        selected[currentQuestion.name] = currentQuestion.answers[answerIndex].label;
      } else delete selected[currentQuestion.name];
    }
    const candidates = [];
    recommendations.forEach((row) => {
      let score = 0;
      const matches = Object.entries(selected).every(([name, answer]) => {
        const key = Object.keys(row).find((column) => column.trim() === name);
        const criterion = normalize(key ? row[key] : '');
        if (!criterion) return true;
        if (criterion !== normalize(answer)) return false;
        score += 1;
        return true;
      });
      const href = toHref(row.Recommendation);
      if (matches && href && !candidates.some((candidate) => candidate.href === href)) {
        candidates.push({ href, score });
      }
    });
    candidates.sort((a, b) => b.score - a.score);
    const visible = candidates.slice(0, 3);

    const previews = await Promise.all(visible.map(async ({ href }) => {
      try {
        if (!productPages.has(href)) {
          const { locale, language } = getLocaleAndLanguage();
          productPages.set(href, Promise.all([
            loadProduct(href),
            fetchPlaceholders(`/${locale}/${language}/products/config`),
          ]));
        }
        const [product] = await productPages.get(href);
        return product ? { href, product } : null;
      } catch (error) {
        return null;
      }
    }));
    if (version !== renderVersion || matchVersion !== matchRenderVersion) return;

    matchListEl.replaceChildren();
    previews.filter(Boolean).forEach(({ href, product }) => {
      const link = document.createElement('a');
      link.className = 'match';
      link.href = href;
      if (product.image) {
        const image = document.createElement('img');
        image.src = product.image;
        image.alt = '';
        image.loading = 'lazy';
        link.append(image);
      }
      const title = document.createElement('span');
      title.textContent = product.title;
      link.append(title);
      matchListEl.append(link);
    });
  };

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

  const showResults = async (url, version) => {
    const href = toHref(url);
    if (!href) {
      widget.dataset.stage = 'error';
      return;
    }

    let result;
    try {
      if (!productPages.has(href)) {
        const { locale, language } = getLocaleAndLanguage();
        productPages.set(href, Promise.all([
          loadProduct(href),
          fetchPlaceholders(`/${locale}/${language}/products/config`),
        ]));
      }
      result = await productPages.get(href);
    } catch (error) {
      productPages.delete(href);
      // eslint-disable-next-line no-console
      console.error('Unable to load recommended product card', href, error);
    }
    if (version !== renderVersion) return;
    const [product, ph] = result || [];
    const productEl = widget.querySelector('.results .product');
    const fallbackEl = widget.querySelector('.results .fallback');
    const mobileShopEl = widget.querySelector('.mobile-shop');
    mobileShopEl.hidden = !product;
    if (product) {
      const answers = trail.map(({ node, answerIndex }) => (
        questions[node.questionIndex].answers[answerIndex].label
      ));
      productEl.replaceChildren(createProductCard(product, ph, answers));
      mobileShopEl.href = product.url;
      mobileShopEl.textContent = ph.shopNow || 'Shop Now';
    } else {
      productEl.replaceChildren();
      fallbackEl.querySelector('a').href = href;
    }
    productEl.hidden = !product;
    fallbackEl.hidden = !!product;

    widget.dataset.stage = 'results';
    matchesEl.hidden = true;
    updateSteps(-1, true);
    widget.querySelector('.results h2').focus();
  };

  const showNode = (node, focus = true) => {
    renderVersion += 1;
    clearTimeout(advanceTimer);
    currentNode = node;
    fieldsets.forEach((fs) => { fs.hidden = true; });
    if (node.type === 'result') {
      showResults(node.url, renderVersion);
      return;
    }

    widget.dataset.stage = 'quiz';
    matchesEl.hidden = false;
    const { questionIndex, options } = node;
    updateSteps(questionIndex);
    const fieldset = fieldsets[questionIndex];
    fieldset.hidden = false;
    fieldset.querySelectorAll('.answer').forEach((button) => {
      button.setAttribute('aria-pressed', 'false');
      button.hidden = true;
      button.classList.remove('is-selected');
    });
    options.forEach(({ answerIndex }) => {
      const button = fieldset.querySelector(`.answer[data-answer-index="${answerIndex}"]`);
      button.hidden = false;
    });
    if (pendingSelection !== null) {
      const button = fieldset.querySelector(`.answer[data-answer-index="${pendingSelection}"]`);
      const optionIsAvailable = options.some(
        ({ answerIndex }) => answerIndex === pendingSelection,
      );
      if (button && optionIsAvailable) {
        button.setAttribute('aria-pressed', 'true');
        button.classList.add('is-selected');
      }
      pendingSelection = null;
    }
    if (focus) fieldset.focus();

    const step = trail.length + 1;
    stepLabelEl.textContent = step;
    stepNameEl.textContent = questions[questionIndex].name;
    prevBtn.hidden = trail.length === 0;
    renderMatches(renderVersion);
  };

  /**
   * Advances to the next step shortly after an answer is selected,
   * leaving time for the selection animation to play.
   */
  const scheduleAdvance = () => {
    if (currentNode.type !== 'question') return;
    const fieldset = fieldsets[currentNode.questionIndex];
    const selected = fieldset.querySelector('.answer[aria-pressed="true"]');
    const selectedIndex = selected ? Number(selected.dataset.answerIndex) : -1;
    const option = currentNode.options.find(({ answerIndex }) => answerIndex === selectedIndex);
    if (!option) return;
    clearTimeout(advanceTimer);
    const version = renderVersion;
    advanceTimer = setTimeout(() => {
      if (version !== renderVersion) return;
      trail.push({ node: currentNode, answerIndex: selectedIndex });
      pushAnswers();
      showNode(option.child);
    }, 400);
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

  prevBtn.addEventListener('click', () => {
    const previous = trail.pop();
    if (!previous) return;
    pendingSelection = previous.answerIndex;
    pushAnswers();
    showNode(previous.node);
  });

  widget.querySelector('button[type="reset"]').addEventListener('click', () => {
    trail = [];
    pendingSelection = null;
    pushAnswers();
    widget.dataset.stage = 'quiz';
    showNode(decisionTree);
  });

  quizEl.addEventListener('click', (e) => {
    const button = e.target.closest('.answer');
    if (!button || currentNode.type !== 'question') return;
    const fieldset = fieldsets[currentNode.questionIndex];
    if (!fieldset.contains(button) || button.hidden) return;
    fieldset.querySelectorAll('.answer').forEach((answer) => {
      const selected = answer === button;
      answer.setAttribute('aria-pressed', String(selected));
      answer.classList.toggle('is-selected', selected);
    });
    renderMatches(renderVersion);
    scheduleAdvance();
  });

  window.addEventListener('popstate', () => restoreAnswers());

  widget.dataset.stage = 'quiz';
  restoreAnswers(false);
}
