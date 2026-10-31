import { loadScript } from '../../aem.js';

export default function loadChatbotClientLibrary() {
  const url = window.location.hostname === 'uat.vitamix.com'
    ? 'https://uat.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-chatbot.lc-0714245cb61f874967f99f575877978f-lc.min.js'
    : 'https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-chatbot.lc-dd65664b07118365206104c205ccc20e-lc.min.js';
  return loadScript(url);
}
