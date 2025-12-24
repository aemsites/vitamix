export function pollConnection(ctx, action) {
  ctx.initialized = false;
  let count = 0;
  const interval = setInterval(() => {
    count += 1;
    if (ctx.initialized || count > 120) {
      clearInterval(interval);
      return;
    }
    action?.();
  }, 500);
}

export async function loadStyle(href) {
  return new Promise((resolve) => {
    if (!document.querySelector(`head > link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = resolve;
      document.head.append(link);
    } else {
      resolve();
    }
  });
}

export function setupCloseButton() {
  const button = document.createElement('button');
  button.className = 'quick-edit-close';
  button.title = 'Close Quick Edit';
  
  const icon = document.createElement('i');
  icon.className = 'icon-close';
  button.appendChild(icon);
  
  button.addEventListener('click', () => {
    window.location.reload();
  });
  document.body.appendChild(button);
}