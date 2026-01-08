// eslint-disable-next-line import/no-cycle
import { loadPage } from '../../scripts/scripts.js';

async function loadMoudle(origin, payload) {
  document.body.classList.add('quick-edit');
  const { default: loadQuickEdit } = await import(`${origin}/nx/public/plugins/quick-edit/quick-edit.js`);
  loadQuickEdit(payload, loadPage);
}

export default function init(payload) {
  const { search } = window.location;
  const ref = new URLSearchParams(search).get('quick-edit');
  let origin;
  if (ref === 'on' || !ref) origin = 'https://main--da-nx--adobe.aem.live';
  if (ref === 'local') origin = 'http://localhost:6456';
  if (!origin) origin = `https://${ref}--da-nx--adobe.aem.live`;
  loadMoudle(origin, payload);
}
