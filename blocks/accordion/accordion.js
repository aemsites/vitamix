/*
 * Accordion Block
 * Recreate an accordion
 * https://www.hlx.live/developer/block-collection/accordion
 */

/**
 * Smoothly opens an accordion item
 * @param {HTMLElement} body - Accordion content body element
 * @param {HTMLDetailsElement} details - Details wrapper element
 */
function openAccordion(body, details) {
  details.open = true;
  requestAnimationFrame(() => {
    body.style.height = `${body.scrollHeight}px`;
  });

  // cleanup after animation
  const onEnd = (e) => {
    if (e.propertyName !== 'height') return;
    body.style.height = 'auto';
    body.removeEventListener('transitionend', onEnd);
  };
  body.addEventListener('transitionend', onEnd);
}

/**
 * Smoothly closes an accordion item
 * @param {HTMLElement} body - Accordion content body element
 * @param {HTMLDetailsElement} details - Details wrapper element
 */
function closeAccordion(body, details) {
  details.dataset.closing = true;
  body.style.height = `${body.scrollHeight}px`;
  // eslint-disable-next-line no-unused-expressions
  body.offsetHeight; // force reflow
  body.style.height = '0';

  // cleanup after animation
  const onEnd = (e) => {
    if (e.propertyName !== 'height') return;
    details.open = false;
    details.removeAttribute('data-closing');
    body.removeEventListener('transitionend', onEnd);
  };
  body.addEventListener('transitionend', onEnd);
}

export default function decorate(block) {
  [...block.children].forEach((row) => {
    // decorate accordion item label
    const label = row.children[0];
    const summary = document.createElement('summary');
    summary.className = 'accordion-item-label';
    summary.append(...label.childNodes);
    // decorate accordion item body
    const body = row.children[1];
    body.className = 'accordion-item-body';
    body.style.height = '0px';
    // decorate accordion item
    const details = document.createElement('details');
    details.className = 'accordion-item';
    details.append(summary, body);
    // smooth accordion open/close
    summary.addEventListener('click', (e) => {
      e.preventDefault();
      if (details.open) closeAccordion(body, details);
      else openAccordion(body, details);
    });
    row.replaceWith(details);
  });
}
