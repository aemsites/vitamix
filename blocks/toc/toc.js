function buildTocFromH2s(main) {
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
  return toc;
}

async function fetchTocFromLink(link) {
  const url = new URL(link.href);
  const response = await fetch(`${url.pathname}.plain.html`);
  if (!response.ok) return null;

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const links = doc.querySelectorAll('li a');
  links.forEach((l) => {
    if (window.location.pathname.startsWith(new URL(l.href).pathname)) {
      l.closest('li').classList.add('toc-open');
    }
  });
  return doc.querySelector('div');
}

export default async function decorate(block) {
  const main = block.closest('main');
  main.classList.add('toc-left');

  const link = block.querySelector('a');
  let toc;

  if (link) {
    block.classList.add('toc-external');
    toc = await fetchTocFromLink(link);
  }

  if (!toc) {
    block.classList.add('toc-internal');
    toc = buildTocFromH2s(main);
  }

  const container = block.closest('.section');
  if (container.querySelector('h2')) {
    block.classList.add('toc-with-heading');
  } else {
    block.classList.add('toc-no-heading');
  }

  block.replaceChildren(toc);
}
