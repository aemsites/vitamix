/**
 * Builds a deduped list of recipe titles mapped to paths, longest titles first.
 * @param {Object[]} recipes - Raw recipe index rows
 * @param {string} excludePath - Current page path to skip
 * @param {string} excludeTitle - Current recipe title to skip
 * @returns {{ title: string, path: string }[]}
 */
function dedupeRecipeTitles(recipes, excludePath, excludeTitle) {
  const titleMap = new Map();
  recipes.forEach((recipe) => {
    const title = (recipe.title || '').trim();
    const path = (recipe.path || '').trim();
    if (!title || !path) return;
    if (path === excludePath || title === excludeTitle) return;
    if (!titleMap.has(title)) {
      titleMap.set(title, path);
    }
  });
  return Array.from(titleMap.entries())
    .map(([title, path]) => ({ title, path }))
    .sort((a, b) => b.title.length - a.title.length);
}

/**
 * Finds non-overlapping title matches in plain text (longest titles win overlaps).
 * @param {string} text
 * @param {{ title: string, path: string }[]} titles
 * @returns {{ start: number, end: number, path: string }[]}
 */
function findTitleMatches(text, titles) {
  const lowerText = text.toLowerCase();
  const matches = [];

  titles.forEach(({ title, path }) => {
    const lowerTitle = title.toLowerCase();
    let start = 0;
    while (start < text.length) {
      const idx = lowerText.indexOf(lowerTitle, start);
      if (idx === -1) break;
      const end = idx + title.length;
      const overlaps = matches.some((match) => idx < match.end && end > match.start);
      if (!overlaps) {
        matches.push({ start: idx, end, path });
      }
      start = idx + lowerTitle.length;
    }
  });

  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Wraps recipe title mentions in a text node with links.
 * @param {Text} textNode
 * @param {{ title: string, path: string }[]} titles
 */
function linkTitlesInTextNode(textNode, titles) {
  const { textContent } = textNode;
  const matches = findTitleMatches(textContent, titles);
  if (!matches.length) return;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  matches.forEach(({ start, end, path }) => {
    if (start > lastIndex) {
      fragment.append(document.createTextNode(textContent.slice(lastIndex, start)));
    }
    const link = document.createElement('a');
    link.href = path;
    link.textContent = textContent.slice(start, end);
    fragment.append(link);
    lastIndex = end;
  });

  if (lastIndex < textContent.length) {
    fragment.append(document.createTextNode(textContent.slice(lastIndex)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

/**
 * Collects linkable text nodes within a recipe section.
 * @param {Element} section
 * @returns {Text[]}
 */
function collectTextNodes(section) {
  const nodes = [];
  const walker = document.createTreeWalker(
    section,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('a, h2')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

/**
 * Links recipe title mentions inside a section when its text includes any title.
 * @param {Element} section
 * @param {{ title: string, path: string }[]} titles
 */
function linkRecipeTitlesInSection(section, titles) {
  const haystack = section.textContent.toLowerCase();
  const sectionTitles = titles.filter(({ title }) => haystack.includes(title.toLowerCase()));
  if (!sectionTitles.length) return;

  collectTextNodes(section).forEach((textNode) => {
    linkTitlesInTextNode(textNode, sectionTitles);
  });
}

/**
 * Loads the recipe index and links mentions of other recipe titles in ingredients
 * and directions sections.
 * @param {Element} block
 * @param {string} locale
 * @param {string} language
 * @param {string} currentTitle
 */
export default async function linkRecipeMentions(block, locale, language, currentTitle) {
  const sections = [
    block.querySelector('.recipe-ingredients'),
    block.querySelector('.recipe-directions'),
  ].filter(Boolean);

  if (!sections.length) return;

  const currentPath = window.location.pathname;

  try {
    let recipes = window.recipeIndex?.data;
    if (!recipes) {
      const response = await fetch(`/${locale}/${language}/recipes/query-index.json`);
      if (!response.ok) return;
      const data = await response.json();
      recipes = data.data || [];
    }

    const titles = dedupeRecipeTitles(recipes, currentPath, currentTitle);
    if (!titles.length) return;

    const haystack = sections.map((section) => section.textContent).join('\n').toLowerCase();
    const matchingTitles = titles.filter(({ title }) => haystack.includes(title.toLowerCase()));
    if (!matchingTitles.length) return;

    sections.forEach((section) => {
      linkRecipeTitlesInSection(section, matchingTitles);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error linking recipe mentions:', error);
  }
}
