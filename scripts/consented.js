import { loadScript } from './aem.js';
import './consented/newsletter.js';
import loadLegacyClientLibraries from './consented/legacy/client-libraries.js';
import {
  configureAnalyticsTrackingServers,
  ensureAnalyticsTrackingConfigured,
  initDigitalDataPage,
  initInstrumentation,
  bootstrapEarlyTracking,
  syncDigitalDataPageContext,
  trackCartChange,
  trackCheckoutShipping,
  trackLogin,
  trackSocialEvents,
  trackFormEvents,
} from './consented/instrumentation/index.js';

bootstrapEarlyTracking();

document.body.classList.add('consented');
// Populate digitalData.page (pageType, categories, user profile) before Launch page view.
initDigitalDataPage();
// Register cart:change / analytics:cart-add listeners before Launch loads so edge
// add-to-cart and Magento redirect paths are never missed. Idempotent — safe if
// called again; initInstrumentation() intentionally does not re-register.
trackCartChange();
trackCheckoutShipping();
trackLogin();
trackSocialEvents();
trackFormEvents();

// Load the legacy AEM client libraries from the local legacy directory.
const currentEnvironment = await loadLegacyClientLibraries();

let metaPixelId = 2138559226702249;

const launchConfigByEnv = {
  prod: {
    pixelId: 1597403650511067,
    scriptUrl: 'https://assets.adobedtm.com/launch-EN40f2d69539754c3ea73511e70c65c801.min.js',
  },
  stage: {
    pixelId: 1241297614751799,
    scriptUrl: 'https://assets.adobedtm.com/8639b8ee2552/0f7a35c4f04b/launch-EN10955306e5aa4722aaabcdd1910448ad-development.min.js',
  },
  uat: {
    pixelId: 1371926081780272,
    scriptUrl: 'https://assets.adobedtm.com/8639b8ee2552/0f7a35c4f04b/launch-EN10955306e5aa4722aaabcdd1910448ad-development.min.js',
  },
  localhost: {
    pixelId: 2138559226702249,
    scriptUrl: 'https://assets.adobedtm.com/8639b8ee2552/0f7a35c4f04b/launch-EN10955306e5aa4722aaabcdd1910448ad-development.min.js',
  },
};

const launchConfig = launchConfigByEnv[currentEnvironment.dataset.deploymentEnv];
if (launchConfig) {
  metaPixelId = launchConfig.pixelId;
  await loadScript(launchConfig.scriptUrl);
}

// Re-apply tracker config after Launch creates late AppMeasurement instances.
configureAnalyticsTrackingServers();
// Launch overwrites pageType to defaultpage — restore Edge page-specific values.
syncDigitalDataPageContext();

// Page events (prodView, scView, scCheckout, purchase)
// and Target orderConfirmPage after Launch is available.
initInstrumentation();
ensureAnalyticsTrackingConfigured();

const { pathname } = window.location;

if (pathname.startsWith('/us/en_us/')) {
  import('./consented/adobe-target.js');
}

/* eslint-disable */

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }

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

// Arttrk pixel returns image/gif — load as Image, not script
new Image().src = 'https://arttrk.com/pixel/?ad_log=referer&action=content&pixid=82dc3545-14a0-41d8-9870-2156059087d9';
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
fbq('init', metaPixelId);
fbq('track', 'PageView');

// End Facebook Pixel Code

// Amazon DSP
!function(w,d,s,t,a){
if(w.amzn)return;w.amzn=a=function(){w.amzn.q.push([arguments,(new
Date).getTime()])};a.q=[];a.version="0.0";s=d.createElement("script");
s.src="https://c.amazon-adsystem.com/aat/amzn.js";s.id="amznpixel";
s.async=true;t=d.getElementsByTagName("script")[0];
t.parentNode.insertBefore(s,t)
}(window,document); amzn("setRegion", "NA");
amzn("addTag", "56d3e600-30c0-4b2f-b290-4e44c553d164");
amzn("trackEvent", "PageView");
// End of Amazon DSP


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

// OpenAI Measurement Pixel (US only)
if (pathname.startsWith('/us/en_us/')) {
  window.oaiq = window.oaiq || function () {
    (window.oaiq.q = window.oaiq.q || []).push(arguments);
  };
  window.oaiq('init', { pixelId: 'LEcZwKFjd4d3hhUqz2tJaf' });
  loadScript('https://bzrcdn.openai.com/sdk/oaiq.min.js');
}
// End OpenAI Measurement Pixel

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

// Commission Junction Universal Tag — click capture on landing pages.
// The order confirmation page publishes its conversion payload via scripts/cj.js,
// which adds this same tag if it is not already present.
if (!document.getElementById('cjapitag')) {
    (function(a,b,c,d){
        var cookieUrl = encodeURIComponent("https://www.vitamix.com/us/en_us/cookie-statement");
        a='https://www.mczbf.com/tags/11931/tag.js?cookieUrl='+cookieUrl;
        b=document;c='script';d=b.createElement(c);d.src=a;
        d.type='text/java'+c;d.async=true;
        d.id='cjapitag';
        a=b.getElementsByTagName(c)[0];a.parentNode.insertBefore(d,a)
    })();
}



await loadScript('https://www.googletagmanager.com/gtag/js?id=AW-992994739');
gtag('js', new Date());
gtag('config', 'AW-992994739');
gtag('config', 'AW-1070742187', { allow_enhanced_conversions: true });



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

/* eslint-enable */

// Order confirmation page (EDS checkout parity with isOrderSuccessPage() in
// instrumentation/shared.js): loads the purchase/conversion pixels below.
const isOrderConfirmation = /\/order\/complete\/?$/.test(pathname);

if (isOrderConfirmation) {
  import('./consented/conversion.js');
}
