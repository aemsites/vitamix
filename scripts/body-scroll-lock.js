let lockCount = 0;
/** @type {number} */
let scrollY = 0;

/**
 * Freezes document scroll behind overlays (e.g. `<dialog showModal>`). Ref-counted so nested
 * overlays do not restore scroll until the last one closes.
 */
export function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) {
    scrollY = window.scrollY;
    const { body } = document;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  }
  lockCount += 1;
}

/** Call when an overlay is fully closed; pairs with {@link lockBodyScroll}. */
export function unlockBodyScroll() {
  if (typeof document === 'undefined') return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount !== 0) return;
  const { body } = document;
  body.style.removeProperty('overflow');
  body.style.removeProperty('position');
  body.style.removeProperty('top');
  body.style.removeProperty('left');
  body.style.removeProperty('right');
  body.style.removeProperty('width');
  window.scrollTo(0, scrollY);
}
