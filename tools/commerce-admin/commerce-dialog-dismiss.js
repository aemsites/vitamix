/* eslint-disable import/prefer-default-export -- single helper; named import at callsites */
/**
 * Ensures Escape dismisses a modal `<dialog>` reliably (capture phase so it fires
 * even when focus is inside nested controls and the native cancel path is skipped).
 *
 * @param {HTMLDialogElement} dialog
 * @param {() => void} onDismiss — typically `dialog.close()` or your close+remove helper
 */
export function wireDialogEscapeDismiss(dialog, onDismiss) {
  dialog.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    },
    true,
  );
}
