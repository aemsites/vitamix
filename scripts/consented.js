import { loadScript, fetchPlaceholders } from './aem.js';

function showMinimizedTeaser(text, newsletterLink) {
  const teaser = document.createElement('div');
  teaser.className = 'newsletter-minimized-teaser';
  teaser.innerHTML = `
    <span class="newsletter-minimized-teaser-text">${text}</span>
    <span class="newsletter-minimized-teaser-divider" aria-hidden="true"></span>
    <button type="button" class="newsletter-minimized-teaser-close" aria-label="Close">×</button>
  `;
  const style = document.createElement('style');
  style.textContent = `
    .newsletter-minimized-teaser {
      position: fixed;
      bottom: var(--spacing-100);
      left: var(--spacing-100);
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 0;
      padding: var(--spacing-80) var(--spacing-100);
      background: var(--color-dark-charcoal);
      color: var(--color-white);
      font-family: var(--body-font-family);
      font-size: var(--body-size-s);
      line-height: var(--line-height-m);
      border-radius: var(--rounding-l);
      box-shadow: 0 4px 12px var(--shadow-200);
      cursor: pointer;
    }
    .newsletter-minimized-teaser-text { padding-right: var(--spacing-80); }
    .newsletter-minimized-teaser-divider {
      width: var(--border-s);
      height: var(--spacing-200);
      background: var(--overlay-lighter);
      flex-shrink: 0;
    }
    .newsletter-minimized-teaser-close {
      margin-left: var(--spacing-80);
      padding: 0 0 2px;
      min-width: var(--spacing-300);
      height: var(--spacing-300);
      border: none;
      background: transparent;
      color: inherit;
      font-size: var(--font-size-300);
      line-height: var(--line-height-xs);
      cursor: pointer;
      border-radius: var(--rounding-m);
    }
    .newsletter-minimized-teaser-close:hover { background: var(--overlay-lighter); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(teaser);

  const textEl = teaser.querySelector('.newsletter-minimized-teaser-text');
  const closeBtn = teaser.querySelector('.newsletter-minimized-teaser-close');

  const markShown = () => {
    localStorage.setItem('newsletter-popped-up', 'true');
  };

  textEl.addEventListener('click', (e) => {
    e.stopPropagation();
    window.leadSourceOverride = 'minimizedmodal';
    markShown();
    newsletterLink.click();
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    markShown();
    teaser.remove();
  });
}

async function initNewsletterPrompt() {
  if (localStorage.getItem('newsletter-popped-up') === 'true') return;

  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  const locale = pathSegments[0] || 'us';
  const language = pathSegments[1] || 'en_us';
  const placeholders = await fetchPlaceholders(`/${locale}/${language}`);
  const minimizedText = placeholders.newsletterMinimized?.trim?.();

  const newsletterLink = document.querySelector('a[href*="/modals/sign-up"]');

  if (minimizedText && newsletterLink) {
    showMinimizedTeaser(minimizedText, newsletterLink);
    return;
  }

  if (newsletterLink) {
    localStorage.setItem('newsletter-popped-up', 'true');
    setTimeout(() => newsletterLink.click(), 5000);
  }
}

initNewsletterPrompt();

// add delayed functionality here
window.config = {
  POOLID: 'us-east-1:d54ecd7d-db6e-456d-bf35-d26346122a63',
  REGION: 'us-east-1',
  BOTID: 'JBPXLTC0LW',
  BOTALIASID: 'HUKYDI5LGI',
};

window.adobeDataLayer = window.adobeDataLayer || [];

const currentEnvironment = document.createElement('div');
currentEnvironment.classList.add('currentEnvironment');
currentEnvironment.dataset.deploymentEnv = 'prod';
currentEnvironment.dataset.templatePath = '/conf/vitamix/settings/wcm/templates/default-page';
document.body.appendChild(currentEnvironment);

const chatbot = document.createElement('div');
chatbot.id = 'chatbot-container';
document.body.appendChild(chatbot);

loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-chatbot.lc-dd65664b07118365206104c205ccc20e-lc.min.js');
loadScript('https://www.vitamix.com/etc.clientlibs/core/wcm/components/commons/site/clientlibs/container.lc-0a6aff292f5cc42142779cde92054524-lc.min.js');

await loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-library.lc-259cf15444c5fe1f89e5c54df7b6e1e9-lc.min.js');
await loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-analytics.lc-26814920488a848ff91c1f425646d010-lc.min.js');
loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-base.lc-daf5b8dac79e9cf7cb1c0b30d8372e7a-lc.min.js');

loadScript('https://assets.adobedtm.com/launch-EN40f2d69539754c3ea73511e70c65c801.min.js');

/* eslint-disable */

loadScript('https://www.googletagmanager.com/gtag/js?id=AW-1070742187', { 'data-cookieconsent': 'marketing' });
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'AW-1070742187');

loadScript('https://www.googletagmanager.com/gtag/js?id=G-XJB3SPQE38');
gtag('js', new Date());
gtag('config', 'G-XJB3SPQE38');

// Replace Innovid Conversion Tag with Google Consent Mode

loadScript('https://www.googletagmanager.com/gtag/js?id=DC-15266370');
gtag('js', new Date());
gtag('config', 'DC-15266370');

const path = window.location.pathname;
const isHome = path === '/us/en_us/';
const isAscentXcategory = path === '/us/en_us/shop/ascent-x-series-blenders';

if (isHome) {
  gtag('event', 'conversion', {
    allow_custom_scripts: true,
    send_to: 'DC-15266370/2026u0/vitam0+standard',
  });
}

if (isAscentXcategory) {
  gtag('event', 'conversion', {
    allow_custom_scripts: true,
    send_to: 'DC-15266370/2026u0/vitam00+standard',
  });
}

//End Floodlight tag

loadScript('https://arttrk.com/pixel/?ad_log=referer&action=content&pixid=82dc3545-14a0-41d8-9870-2156059087d9');
loadScript('https://cdn.evgnet.com/beacon/vitamixmgmtcorp/vitamix_us/scripts/evergage.min.js');

loadScript('https://www.googletagmanager.com/gtag/js?id=DC-10418690');
gtag('js', new Date());
gtag('config', 'DC-10418690');


// Facebook Pixel Code

!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1597403650511067');
fbq('track', 'PageView');

// End Facebook Pixel Code


// Pinterest Tag
!function(e){
if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(
Array.prototype.slice.call(arguments))};
var n=window.pintrk;n.queue=[],n.version="3.0";
var t=document.createElement("script");t.async=!0,t.src=e;
var r=document.getElementsByTagName("script")[0];
r.parentNode.insertBefore(t,r)}}
("https://s.pinimg.com/ct/core.js");
pintrk('load', '2621075961855'); pintrk('page');
// End of Pinterest Tag

/* eslint-enable */

// LinkedIn Insight Tag
try {
  const lpids = '_linkedin_data_partner_ids';
  window[lpids] = window[lpids] || [];
  window[lpids].push('2976369');
  loadScript('https://snap.licdn.com/li.lms-analytics/insight.min.js');
} catch (error) {
  /* eslint-disable-next-line no-console */
  console.error('LinkedIn Insight Tag failed to load', error);
}

// End of LinkedIn Insight Tag

/* eslint-disable */

// TV Scientific Pixel Code
try {
setTimeout(function () {var p, s, d, w;d = document;w = window.location;p = d.createElement("IMG");s = w.protocol + "//tvspix.com/t.png?&t=" + (new Date).getTime() + "&l=tvscientific-pix-o-4b66e973-23f2-45e9-91e5-aa5f89462df5&u3=" + encodeURIComponent(w.href);p.setAttribute("src", s);
p.setAttribute("height", "0");p.setAttribute("width", "0");p.setAttribute("alt", "");p.style.setProperty("display", "none");p.style.setProperty("position", "absolute");
p.style.setProperty("visibility", "hidden");d.body.appendChild(p);},500);
} catch (error) {
  console.error('TV Scientific Pixel Code failed to load', error);
}


// Tune Pixel Code
!function(){var e=window.tdl=window.tdl||[];if(e.invoked)window.console&&console.error&&console.error("Tune snippet has been included more than once.");else{e.invoked=!0,e.methods=["init","identify","convert"],e.factory=function(t){return function(){var n=Array.prototype.slice.call(arguments);return n.unshift(t),e.push(n),e}};for(var t=0;t<e.methods.length;t++){var n=e.methods[t];e[n]=e.factory(n)}e.init=function(t){var n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src="https://js.go2sdk.com/v2/tune.js";var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(n,r),e.domain=t}}}();
tdl.init("https://perkspot.go2cloud.org");
tdl.identify();
// End of Tune Pixel Code

// Krateo pixel
    (function(a,b,c,d){
        var cookieUrl = encodeURIComponent("https://www.vitamix.com/us/en_us/cookie/index/index");
        a='https://www.mczbf.com/tags/11931/tag.js?cookieUrl='+cookieUrl;
        b=document;c='script';d=b.createElement(c);d.src=a;
        d.type='text/java'+c;d.async=true;
        d.id='cjapitag';
        a=b.getElementsByTagName(c)[0];a.parentNode.insertBefore(d,a)
    })();



await loadScript('https://www.googletagmanager.com/gtag/js?id=AW-992994739');
gtag('js', new Date());
gtag('config', 'AW-992994739');



loadScript('https://cdn.datasteam.io/js/D26F66D1AD707A.js');

(function(w,d,t,r,u)
{
  var f,n,i;
  w[u]=w[u]||[],f=function()
  {
    var o={ti:"355047220", enableAutoSpaTracking: true};
    o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")
  },
  n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function()
  {
    var s=this.readyState;
    s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)
  },
  i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)
})
(window,document,"script","//bat.bing.com/bat.js","uetq");

(function(w, d){
  var id='spdt-capture', n='script';
  if (!d.getElementById(id)) {
    w.spdt =
      w.spdt ||
      function() {
        (w.spdt.q = w.spdt.q || []).push(arguments);
      };
    var e = d.createElement(n); e.id = id; e.async=1;
    e.src = 'https://pixel.byspotify.com/ping.min.js';
    var s = d.getElementsByTagName(n)[0];
    s.parentNode.insertBefore(e, s);
  }
  w.spdt('conf', { key: '18858202ee0c4082a0f7e6d3d8b53c94' });
  w.spdt('view');
})(window, document);

