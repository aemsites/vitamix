import { moveInstrumentation } from './ue-utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const setupCardsObserver = () => {
    const cardsBlocks = document.querySelectorAll('div.cards.block');
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        console.log(mutation);
        const addedUlElements = mutation.addedNodes;
        if (mutation.type === 'childList' && mutation.target.tagName === 'DIV') {
          if (addedUlElements.length === 1 && addedUlElements[0].tagName === 'UL') {
            const ulEl = addedUlElements[0];
            const removedDivEl = [...mutation.removedNodes].filter((node) => node.tagName === 'DIV');
            removedDivEl.forEach((div, index) => {
              if (index < ulEl.children.length) {
                moveInstrumentation(div, ulEl.children[index]);
              }
            });
          }

          if (mutation.target.classList.contains('card-image')) {
            const addedPictureElements = [...mutation.addedNodes].filter(node => node.tagName === 'PICTURE');
            const removedPictureElements = [...mutation.removedNodes].filter(node => node.tagName === 'PICTURE');
            
            if (addedPictureElements.length === 1 && removedPictureElements.length === 1) {
              const oldImg = removedPictureElements[0].querySelector('img');
              const newImg = addedPictureElements[0].querySelector('img');
              
              if (oldImg && newImg) {
                moveInstrumentation(oldImg, newImg);
              }
            }
          }
        }
      });
    });

    cardsBlocks.forEach((cardsBlock) => {
      observer.observe(cardsBlock, { childList: true });
    });
  };

  setupCardsObserver();
});
