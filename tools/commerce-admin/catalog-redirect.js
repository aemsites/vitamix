/**
 * catalog.html: require OTP auth, then redirect to the catalog shell.
 */
await import('./auth-page-boot.js');
window.location.replace(`/tools/commerce-admin.html${window.location.search}`);
