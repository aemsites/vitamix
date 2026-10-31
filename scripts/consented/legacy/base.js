import { loadScript } from '../../aem.js';

export default function loadBaseClientLibrary() {
  return loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-base.lc-daf5b8dac79e9cf7cb1c0b30d8372e7a-lc.min.js');
}
