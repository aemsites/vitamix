export default function decorate(block) {
  const main = block.closest('main');
  main.classList.add('toc-left');

  // build table of contents
  const toc = document.createElement('ul');
  const h2s = main.querySelectorAll('.section:not(.toc-container) h2');
  h2s.forEach((h2) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${h2.id}`;
    a.textContent = h2.textContent;
    li.appendChild(a);
    toc.appendChild(li);
  });

  block.replaceChildren(toc);
}
