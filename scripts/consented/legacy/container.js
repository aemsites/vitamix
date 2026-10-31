import { loadScript } from '../../aem.js';

export default function loadContainerClientLibrary() {
  return loadScript('https://www.vitamix.com/etc.clientlibs/core/wcm/components/commons/site/clientlibs/container.lc-0a6aff292f5cc42142779cde92054524-lc.min.js');
}
