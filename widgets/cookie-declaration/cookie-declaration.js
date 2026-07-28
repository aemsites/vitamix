/**
 * Injects the Cookiebot Cookie Declaration script into the widget.
 * Cookiebot renders the declaration in place of its script element when it loads.
 * @param {Element} widget - The widget element to inject into
 */
export default function decorate(widget) {
  const script = document.createElement('script');
  script.id = 'CookieDeclaration';
  script.src = 'https://consent.cookiebot.com/1d1d4c74-9c10-49e5-9577-f8eb4ba520fb/cd.js';
  script.async = true;
  widget.append(script);
}
