const debug = (
  window.location.hostname === 'localhost')
  || (window.location.search.includes('instrumentation=debug')
  );

if (debug) {
  console.log('Adobe Analytics instrumentation loaded');
}
