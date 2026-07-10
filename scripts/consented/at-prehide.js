// Prehiding snippet for Adobe Target with asynchronous Launch deployment
(function prehideBody(windowObj, documentObj, styleContent, timeoutMs) {
  function injectPrehideStyle(headElement, styleId, css) {
    if (headElement) {
      const styleEl = documentObj.createElement('style');
      styleEl.id = styleId;
      styleEl.innerHTML = css;
      headElement.appendChild(styleEl);
    }
  }

  injectPrehideStyle(
    documentObj.getElementsByTagName('head')[0],
    'at-body-style',
    styleContent,
  );

  function removePrehideStyle() {
    const headElement = documentObj.getElementsByTagName('head')[0];
    if (headElement) {
      const styleEl = documentObj.getElementById('at-body-style');
      if (styleEl) {
        headElement.removeChild(styleEl);
      }
    }
  }

  setTimeout(removePrehideStyle, timeoutMs);
}(window, document, 'body {opacity: 0 !important}', 3000));
