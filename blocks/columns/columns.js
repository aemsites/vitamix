export default function decorate(block) {
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'columns');
  const cols = [...block.firstElementChild.children];
  block.classList.add(`columns-${cols.length}-cols`);

  // setup image columns
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      // setup image columns
      const pic = col.querySelector('div picture');
      if (pic) {
        const picWrapper = pic.closest('div');
        if (picWrapper.children.length === 1 && !variants.includes('icon-list')) {
          // picture is only content in column
          picWrapper.classList.add('column-img');
        }
      }

      // setup button columns
      const button = col.querySelector('div .button');
      if (button && button.textContent === col.textContent) {
        button.closest('div').classList.add('column-button');
      }
    });
  });

  // decorate icon list variant
  if (variants.includes('icon-list')) {
    const buttons = block.querySelectorAll('a.button');
    buttons.forEach((button) => {
      button.removeAttribute('class');
      const wrapper = button.closest('.button-wrapper');
      if (wrapper) wrapper.removeAttribute('class');
    });
  }
}
