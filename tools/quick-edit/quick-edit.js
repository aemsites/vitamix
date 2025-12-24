const hostname = window.location.hostname;

import { loadPage } from '../../scripts/scripts.js';
import { setupContentEditableListeners, setupImageDropListeners, updateImageSrc, handleImageError } from './images.js';
import { setEditorState } from './prose.js';
import { setCursors } from './cursors.js';
import { pollConnection, setupCloseButton, loadStyle } from './utils.js';

loadStyle('/tools/quick-edit/quick-edit.css');

const QUICK_EDIT_ID = 'quick-edit-iframe';
const QUICK_EDIT_SRC =
  hostname != "localhost"
    ? "https://main--da-live--adobe.aem.live/drafts/wysiwyg/init?nx=da-fusion"
    : `https://main--da-live--adobe.aem.live/drafts/wysiwyg/init?nx=local&ref=local`;

async function setBody(body, ctx) {
  const doc = new DOMParser().parseFromString(body, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  await loadPage();
  setupContentEditableListeners(ctx);
  setupImageDropListeners(ctx, document.body.querySelector('main'));
  setupCloseButton();
}

function onMessage(e, ctx) {
  ctx.initialized = true;
  if (e.data.type === 'set-body') {
    setBody(e.data.body, ctx);
  } else if (e.data.type === 'set-editor-state') {
    const { editorState, cursorOffset } = e.data;
    setEditorState(cursorOffset, editorState, ctx);
  } else if (e.data.type === 'set-cursors') {
    setCursors(e.data.body, ctx);
  } else if (e.data.type === 'update-image-src') {
    const { newSrc, originalSrc } = e.data;
    updateImageSrc(originalSrc, newSrc);
  } else if (e.data.type === 'image-error') {
    handleImageError(e.data.error);
  }
} 

function handleLoad(target, config, location, ctx) {
  const CHANNEL = new MessageChannel();
  const { port1, port2 } = CHANNEL;
  ctx.port = port1;

  target.contentWindow.postMessage({ init: config, location }, "*", [port2]);
  ctx.port.onmessage = (e) => onMessage(e, ctx);
}

export default async function loadQuickEdit({ detail: payload }) {
  if (document.getElementById(QUICK_EDIT_ID)) return;

  const ctx = {
    initialized: false,
  };

  const iframe = document.createElement("iframe");
  iframe.id = QUICK_EDIT_ID;
  iframe.src = QUICK_EDIT_SRC;
  iframe.allow = "local-network-access *; clipboard-write *";

  pollConnection(ctx, () => {
    handleLoad(iframe, payload.config, payload.location, ctx);
  });
  document.documentElement.append(iframe);
  iframe.id = 'quick-edit-iframe';
  iframe.style.visibility = 'hidden';
}
