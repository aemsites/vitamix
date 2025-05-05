import { moveInstrumentation } from './ue-utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const setupCardsObserver = () => {
    const cardsBlocks = document.querySelectorAll('div.cards.block');
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        console.log(mutation);
        const addedUlElements = mutation.addedNodes;
        if (mutation.type === 'childList' && addedUlElements.length === 1 && addedUlElements[0].tagName === 'UL') {
          const ulEl = addedUlElements[0];
          const removedDivEl = [...mutation.removedNodes].filter((node) => node.tagName === 'DIV');

          removedDivEl.forEach((div, index) => {
            if (index < ulEl.children.length) {
              moveInstrumentation(div, ulEl.children[index]);
            }
          });
        }
      });
    });

    cardsBlocks.forEach((cardsBlock) => {
      observer.observe(cardsBlock, { childList: true, subtree: true });
    });
  };

  setupCardsObserver();
});
