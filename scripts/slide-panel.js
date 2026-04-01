/**
 * Creates a reusable slide-out dialog panel.
 * @param {string} id - Element ID for the dialog
 * @param {string} title - Header title text
 * @param {string} className - CSS class for the dialog
 * @returns {{ dialog: HTMLDialogElement, content: HTMLElement, open: Function, close: Function }}
 */
export default function createSlidePanel(id, title, className) {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = className;
  dialog.setAttribute('aria-expanded', 'false');

  const headerRow = document.createElement('div');
  headerRow.className = 'slide-panel-header';

  const titleEl = document.createElement('h2');
  titleEl.textContent = title;
  headerRow.append(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'slide-panel-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.setAttribute('aria-label', 'Close');
  headerRow.append(closeBtn);

  const content = document.createElement('div');
  content.className = 'slide-panel-content';

  dialog.append(headerRow, content);

  function open() {
    dialog.showModal();
    dialog.setAttribute('aria-expanded', 'true');
  }

  function close() {
    dialog.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      dialog.close();
    }, 300);
  }

  closeBtn.addEventListener('click', close);

  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const inside = rect.top <= e.clientY
      && e.clientY <= rect.top + rect.height
      && rect.left <= e.clientX
      && e.clientX <= rect.left + rect.width;
    if (!inside) close();
  });

  return {
    dialog, content, open, close,
  };
}
