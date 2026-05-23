const debug = (
  window.location.hostname === 'localhost')
  || (window.location.search.includes('instrumentation=debug')
  );

if (debug) {
  /* eslint-disable-next-line no-console */
  console.log('Adobe Analytics instrumentation loaded');
}
