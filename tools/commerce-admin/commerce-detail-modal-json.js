/* eslint-disable import/prefer-default-export -- helpers; named imports at callsites */
/**
 * Muted JSON link + close (×) cluster — caller wires JSON behavior when not using
 * `createDetailModalHeaderCloseAndJson`.
 *
 * @param {() => void} onClose
 */
export function createDetailModalHeaderShell(onClose) {
  const headerRight = document.createElement('div');
  headerRight.className = 'commerce-detail-modal-header-actions';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'commerce-detail-modal-close-x';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    onClose();
  });

  const jsonLink = document.createElement('button');
  jsonLink.type = 'button';
  jsonLink.className = 'commerce-detail-modal-json-link';
  jsonLink.textContent = 'JSON';
  jsonLink.setAttribute('aria-pressed', 'false');

  headerRight.append(jsonLink, closeBtn);

  return {
    headerRight,
    closeBtn,
    jsonLink,
  };
}

/**
 * Standard detail header: muted JSON / Details then ×, and JSON vs human body toggle.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.bodyHost
 * @param {() => Node} opts.getHumanNode
 * @param {() => unknown} opts.getJsonValue
 * @param {() => void} opts.onClose
 * @returns {object} `headerRight`, `resetToHuman`, `jsonLink`, `closeBtn`
 */
export function createDetailModalHeaderCloseAndJson({
  bodyHost,
  getHumanNode,
  getJsonValue,
  onClose,
}) {
  const { headerRight, closeBtn, jsonLink } = createDetailModalHeaderShell(onClose);

  function showHuman() {
    jsonLink.textContent = 'JSON';
    jsonLink.setAttribute('aria-pressed', 'false');
    bodyHost.replaceChildren();
    bodyHost.appendChild(getHumanNode());
  }

  function showJson() {
    jsonLink.textContent = 'Details';
    jsonLink.setAttribute('aria-pressed', 'true');
    bodyHost.replaceChildren();
    const pre = document.createElement('pre');
    pre.className = 'commerce-detail-modal-json-pre';
    try {
      pre.textContent = JSON.stringify(getJsonValue(), null, 2);
    } catch {
      pre.textContent = String(getJsonValue());
    }
    bodyHost.appendChild(pre);
  }

  jsonLink.addEventListener('click', () => {
    if (jsonLink.getAttribute('aria-pressed') === 'true') showHuman();
    else showJson();
  });

  return {
    headerRight,
    resetToHuman: showHuman,
    jsonLink,
    closeBtn,
  };
}
