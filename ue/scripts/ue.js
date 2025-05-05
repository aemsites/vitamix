console.log('ue');

document.addEventListener('DOMContentLoaded', () => {
  const setupCardsObserver = () => {
    const cardsBlocks = document.querySelectorAll('div.cards.block');

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        console.log('Cards block mutation detected:', {
          type: mutation.type,
          target: mutation.target,
          addedNodes: mutation.addedNodes,
          removedNodes: mutation.removedNodes,
          attributeName: mutation.attributeName,
          timestamp: new Date().toISOString(),
        });
      });
    });
    
    const config = {
      attributes: true,
      childList: true,
      subtree: false,
      characterData: false,
    };

    cardsBlocks.forEach((cardsBlock) => {
      observer.observe(cardsBlock, config);
      console.log('Mutation observer attached to:', cardsBlock);
    });
  };
  setupCardsObserver();
});
