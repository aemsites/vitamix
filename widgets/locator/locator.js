import { loadCSS } from '../../scripts/aem.js';

const MAX_DISTANCE = 200;
const EVENTS_MAX_DISTANCE = 50;


const hhRetailersResults = document.querySelector('#locator-hh-retailers-tabpanel');
const hhDistributorsResults = document.querySelector('#locator-hh-distributors-tabpanel');
const hhOnlineResults = document.querySelector('#locator-hh-online-tabpanel');

const commDistributorsResults = document.querySelector('#locator-comm-distributors-tabpanel');
const commLocalrepResults = document.querySelector('#locator-comm-localrep-tabpanel');

const eventsHHResults = document.querySelector('#locator-events-hh-tabpanel');
const eventsCommResults = document.querySelector('#locator-events-comm-tabpanel');

async function fetchData(form) {
  const fetchSheet = async (src) => {
    const resp = await fetch(`https://little-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(src)}`);
    const { data } = await resp.json();
    data.forEach((item) => {
      item.lat = +item.LAT;
      item.lng = +item.LONG;
    });
    return data;
  };

  const loaded = form.dataset.status;
  if (loaded) return window.locatorData;

  form.dataset.status = 'loading';
  window.locatorData = {};
  window.locatorData.HH = await fetchSheet('https://main--thinktanked--davidnuescheler.aem.live/vitamix/storelocations-hh.json?limit=10000');
  window.locatorData.COMM = await fetchSheet('https://main--thinktanked--davidnuescheler.aem.live/vitamix/storelocations-comm.json?limit=2000');
  window.locatorData.EVENTS = await fetchSheet('https://main--thinktanked--davidnuescheler.aem.live/vitamix/storelocations-events.json');
  form.dataset.status = 'loaded';
  return window.locatorData;
}

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2)
    * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceInKm = R * c;
  // Convert kilometers to miles
  const distanceInMiles = distanceInKm * 0.621371;
  return distanceInMiles;
};

async function geoCode(address) {
    const resp = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=AIzaSyCPlws-m9FD9W0nP-WRR-5ldW2a4nh-t4E`);
  const json = await resp.json();
  const { results } = json;

  const countryComponent = results[0]?.address_components?.find((c) => c.types?.includes('country'));

  return {
    location: results[0]?.geometry?.location,
    countryShort: countryComponent?.short_name,
    countryLong: countryComponent?.long_name,
  };
}


// Common helpers
function norm(v) {
  return (v ?? '').toString().trim();
}
function normLower(v) {
  return norm(v).toLowerCase();
}
function isEnabled(v) {
  return ['true', '1', 'yes', 'y'].includes(normLower(v));
}
function countryMatches(itemCountry, countryShort, countryLong) {
  const c = normLower(itemCountry);
  return c && (c === normLower(countryShort) || c === normLower(countryLong));
}
function recordKey(item) {
  return [
    item.TYPE,
    item.PRODUCT_TYPE,
    item.NAME,
    item.ADDRESS_1,
    item.CITY,
    item.STATE_PROVINCE,
    item.POSTAL_CODE,
    item.COUNTRY,
  ].map(normLower).join('|');
}

function applyAemRules(rows, { countryShort, countryLong, productType, allowedTypes }) {
  const map = new Map();

  (rows || []).forEach((r) => {
    if (!isEnabled(r.ENABLED)) return;

    if (productType && normLower(r.PRODUCT_TYPE) !== normLower(productType)) return;

    if (allowedTypes && !allowedTypes.includes(norm(r.TYPE))) return;

    if (!countryMatches(r.COUNTRY, countryShort, countryLong)) return;

    const action = normLower(r.ACTION);
    const key = recordKey(r);

    if (action === 'remove') {
      map.delete(key);
      return;
    }

    if (action === '' || action === 'add' || action === 'update') {
      map.set(key, r);
    }
  });

  return Array.from(map.values());
}

// EVENTS helpers
function excelSerialToDate(serial) {
  const excelEpoch = new Date(1900, 0, 1);
  const msPerDay = 24 * 60 * 60 * 1000;
  const adjusted = serial > 59 ? serial - 1 : serial; // Excel leap-year bug
  return new Date(excelEpoch.getTime() + (adjusted - 1) * msPerDay);
}

function parseAnyDate(v) {
  if (v == null || v === '') return null;

  if (!Number.isNaN(Number(v)) && String(v).trim() !== '') {
    return excelSerialToDate(Number(v));
  }

  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatMDYFromKey(key) {
  const [yyyy, mm, dd] = key.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

function eventKey(e) {
  const s = parseAnyDate(e.START_DATE);
  const startKey = s ? ymdKey(s) : '';
  return [
    normLower(e.PRODUCT_TYPE),
    normLower(e.NAME),
    normLower(e.ADDRESS_1),
    normLower(e.CITY),
    normLower(e.STATE_PROVINCE),
    normLower(e.POSTAL_CODE),
    normLower(e.COUNTRY),
    startKey,
  ].join('|');
}

function applyAemRulesEvents(rows, { productType }) {
  const map = new Map();

  (rows || []).forEach((r) => {
    if (!isEnabled(r.ENABLED)) return;
    if (productType && normLower(r.PRODUCT_TYPE) !== normLower(productType)) return;

    const action = normLower(r.ACTION);
    const key = eventKey(r);

    if (action === 'remove') {
      map.delete(key);
      return;
    }
    if (action === '' || action === 'add' || action === 'update') {
      map.set(key, r);
    }
  });

  return Array.from(map.values());
}

function filterFutureEvents(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (rows || []).filter((e) => {
    const start = parseAnyDate(e.START_DATE);
    const end = parseAnyDate(e.END_DATE);
    const compare = (end || start);
    if (!compare) return false;

    compare.setHours(0, 0, 0, 0);
    return compare >= today;
  });
}

function groupByStartDate(rows) {
  const groups = new Map();

  (rows || []).forEach((e) => {
    const start = parseAnyDate(e.START_DATE);
    if (!start) return;
    start.setHours(0, 0, 0, 0);

    const key = ymdKey(start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}


function findEventsResults(data, location) {
  
  const hhClean = applyAemRulesEvents(data, { productType: 'HH' });
  const commClean = applyAemRulesEvents(data, { productType: 'COMM' });

  const hhFuture = filterFutureEvents(hhClean);
  const commFuture = filterFutureEvents(commClean);

  const hhNearby = (hhFuture || []).filter((e) =>
    haversineDistance(location.lat, location.lng, e.lat, e.lng) <= EVENTS_MAX_DISTANCE
  );
  const commNearby = (commFuture || []).filter((e) =>
    haversineDistance(location.lat, location.lng, e.lat, e.lng) <= EVENTS_MAX_DISTANCE
  );

  
  const sortEvents = (arr) => {
    arr.sort((a, b) => {
      const ad = parseAnyDate(a.START_DATE)?.getTime() ?? 0;
      const bd = parseAnyDate(b.START_DATE)?.getTime() ?? 0;
      if (ad !== bd) return ad - bd;
      return haversineDistance(location.lat, location.lng, a.lat, a.lng)
        - haversineDistance(location.lat, location.lng, b.lat, b.lng);
    });
  };
  sortEvents(hhNearby);
  sortEvents(commNearby);

  return {
    hhGrouped: groupByStartDate(hhNearby),
    commGrouped: groupByStartDate(commNearby),
  };
}

function findCommResults(data, location, countryShort, countryLong) {
  const allowedTypes = ['DEALER/DISTRIBUTOR', 'LOCAL REP'];

  const cleaned = applyAemRules(data, {
    countryShort,
    countryLong,
    productType: 'COMM',
    allowedTypes,
  });

  const distributors = cleaned
    .filter((i) => i.TYPE === 'DEALER/DISTRIBUTOR'
      && haversineDistance(location.lat, location.lng, i.lat, i.lng) <= MAX_DISTANCE)
    .sort((a, b) =>
      haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng));

  const localRep = cleaned
    .filter((i) => i.TYPE === 'LOCAL REP'
      && haversineDistance(location.lat, location.lng, i.lat, i.lng) <= MAX_DISTANCE)
    .sort((a, b) =>
      haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng));

  return { distributors, localRep };
}




function findHHResults(data, location, countryShort, countryLong) {
  const allowedTypes = ['ONLINE', 'RETAILERS', 'DEALER/DISTRIBUTOR'];

  
  const cleaned = applyAemRules(data, {
    countryShort,
    countryLong,
    productType: 'HH',
    allowedTypes,
  });

  
  const retailers = cleaned
    .filter((i) => i.TYPE === 'RETAILERS'
      && haversineDistance(location.lat, location.lng, i.lat, i.lng) <= MAX_DISTANCE)
    .sort((a, b) =>
      haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng));

  const distributors = cleaned
    .filter((i) => i.TYPE === 'DEALER/DISTRIBUTOR'
      && haversineDistance(location.lat, location.lng, i.lat, i.lng) <= MAX_DISTANCE)
    .sort((a, b) =>
      haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng));

  const online = cleaned
    .filter((i) => i.TYPE === 'ONLINE')
    .sort((a, b) => normLower(a.NAME).localeCompare(normLower(b.NAME)));

  return { retailers, distributors, online };
}


function displayCommResults(results, location) {
  const { distributors, localRep } = results;

  const createDistributorResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);

    if (result.ADDRESS_1) {
      const addressWrapper = document.createElement('span');
      addressWrapper.classList.add('locator-address');

      const addressLabel = document.createElement('strong');
      addressLabel.textContent = 'Address: ';
      addressWrapper.append(addressLabel);

      const addressLink = document.createElement('a');
      const addressQuery = `${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`;
      addressLink.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
      addressLink.target = '_blank';
      addressLink.rel = 'noopener noreferrer';
      addressLink.textContent = addressQuery;

      addressWrapper.append(addressLink);
      li.append(addressWrapper);
    }

    // Phone number
    if (result.PHONE_NUMBER) {
      const phoneWrapper = document.createElement('span');
      phoneWrapper.classList.add('locator-phone');

      const phoneLabel = document.createElement('strong');
      phoneLabel.textContent = 'Phone: ';
      phoneWrapper.append(phoneLabel);

      const phoneLink = document.createElement('a');
      phoneLink.href = `tel:${result.PHONE_NUMBER}`;
      phoneLink.textContent = result.PHONE_NUMBER;
      phoneLink.target = '_blank';
      phoneLink.rel = 'noopener noreferrer';

      phoneWrapper.append(phoneLink);
      li.append(phoneWrapper);
    }
    // Web address
    if (result.WEB_ADDRESS) {
      const webWrapper = document.createElement('span');
      webWrapper.classList.add('locator-web');

      const webLabel = document.createElement('strong');
      webLabel.textContent = 'Website: ';
      webWrapper.append(webLabel);

      const webLink = document.createElement('a');
      const webAddress = result.WEB_ADDRESS.startsWith('http')
        ? result.WEB_ADDRESS
        : `https://${result.WEB_ADDRESS}`;

      webLink.href = webAddress;
      webLink.target = '_blank';
      webLink.rel = 'noopener noreferrer';
      webLink.textContent = result.WEB_ADDRESS_LINK_TEXT || result.WEB_ADDRESS;

      webWrapper.append(webLink);
      li.append(webWrapper);
    }

    return li;
  };

  const createLocalRepResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);

    // Phone number
    if (result.PHONE_NUMBER) {
      const phoneWrapper = document.createElement('span');
      phoneWrapper.classList.add('locator-phone');
      const phoneLabel = document.createElement('strong');
      phoneLabel.textContent = 'Phone: ';
      phoneWrapper.append(phoneLabel);

      const phoneLink = document.createElement('a');
      phoneLink.href = `tel:${result.PHONE_NUMBER}`;
      phoneLink.textContent = result.PHONE_NUMBER;
      phoneWrapper.append(phoneLink);

      li.append(phoneWrapper);
    }

    // Web address
    if (result.WEB_ADDRESS) {
      const webWrapper = document.createElement('span');
      webWrapper.classList.add('locator-web');

      const webLabel = document.createElement('strong');
      webLabel.textContent = 'Website: ';
      webWrapper.append(webLabel);

      const webLink = document.createElement('a');
      const webAddress = result.WEB_ADDRESS.startsWith('http')
        ? result.WEB_ADDRESS
        : `https://${result.WEB_ADDRESS}`;

      webLink.href = webAddress;
      webLink.target = '_blank';
      webLink.textContent = result.WEB_ADDRESS_LINK_TEXT || result.WEB_ADDRESS;
      webWrapper.append(webLink);

      li.append(webWrapper);
    }

    return li;
  };

  if (distributors && distributors.length > 0) {
    const distributorList = document.createElement('ol');
    distributors.forEach((distributor) => {
      distributorList.appendChild(createDistributorResult(distributor));
    });
    commDistributorsResults.textContent = '';
    commDistributorsResults.appendChild(distributorList);
  } else {
    commDistributorsResults.innerHTML = '<p>No distributors found</p>';
  }

  if (localRep && localRep.length > 0) {
    const localRepList = document.createElement('ol');
    localRep.forEach((lr) => {
      localRepList.appendChild(createLocalRepResult(lr));
    });
    commLocalrepResults.textContent = '';
    commLocalrepResults.appendChild(localRepList);
  } else {
    commLocalrepResults.innerHTML = '<p>No local representatives found</p>';
  }
}

function displayEventsResults(results, location) {
  const { hhGrouped, commGrouped } = results;

  const renderGroupedList = (container, grouped) => {
    container.textContent = '';

    if (!grouped || grouped.length === 0) {
      container.innerHTML = '<p>No events found</p>';
      return;
    }

    grouped.forEach(([dateKey, items]) => {
      const heading = document.createElement('h4');
      heading.classList.add('locator-events-dateheading');
      heading.textContent = formatMDYFromKey(dateKey);
      container.append(heading);

      const ol = document.createElement('ol');
      ol.classList.add('locator-events-list');

      items.forEach((e) => {
        const li = document.createElement('li');
        li.classList.add('locator-event-card');

        const title = document.createElement('h3');
        title.textContent = e.NAME;
        li.append(title);

        const start = parseAnyDate(e.START_DATE);
        const end = parseAnyDate(e.END_DATE);
        if (start) {
          const dateLine = document.createElement('span');
          dateLine.classList.add('locator-date');
          const startTxt = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          const endTxt = end
            ? end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : '';
          dateLine.textContent = endTxt ? `${startTxt} - ${endTxt}` : startTxt;
          li.append(dateLine);
        }

        const dist = document.createElement('span');
        dist.classList.add('locator-distance');
        dist.textContent = `${haversineDistance(location.lat, location.lng, e.lat, e.lng).toFixed(1)} miles away`;
        li.append(dist);

        if (e.ADDRESS_1) {
          const addressWrapper = document.createElement('span');
          addressWrapper.classList.add('locator-address');

          const addressLabel = document.createElement('strong');
          addressLabel.textContent = 'Address: ';
          addressWrapper.append(addressLabel);

          const addressLink = document.createElement('a');
          const addressQuery = `${e.ADDRESS_1}, ${e.CITY}, ${e.STATE_PROVINCE} ${e.POSTAL_CODE}`.replace(/\s+/g, ' ').trim();
          addressLink.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
          addressLink.target = '_blank';
          addressLink.rel = 'noopener noreferrer';
          addressLink.textContent = addressQuery;

          addressWrapper.append(addressLink);
          li.append(addressWrapper);
        }

        ol.append(li);
      });

      container.append(ol);
    });
  };

  // render both tab panels
  renderGroupedList(eventsHHResults, hhGrouped);
  renderGroupedList(eventsCommResults, commGrouped);

  // calendar (optional)
  const calendarEl = document.querySelector('#locator-events-calendar');
  if (!calendarEl) return;

  const eventDates = new Set();
  const addDatesFromGrouped = (grouped) => (grouped || []).forEach(([k]) => eventDates.add(k));
  addDatesFromGrouped(hhGrouped);
  addDatesFromGrouped(commGrouped);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let activeDateKey = null;

  const renderCalendar = () => {
    calendarEl.textContent = '';

    const header = document.createElement('div');
    header.classList.add('locator-cal-header');

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      renderCalendar();
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '›';
    nextBtn.addEventListener('click', () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderCalendar();
    });

    const monthTitle = document.createElement('div');
    monthTitle.classList.add('locator-cal-title');
    monthTitle.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    header.append(prevBtn, monthTitle, nextBtn);
    calendarEl.append(header);

    const grid = document.createElement('div');
    grid.classList.add('locator-cal-grid');

    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
      const cell = document.createElement('div');
      cell.classList.add('locator-cal-dow');
      cell.textContent = d;
      grid.append(cell);
    });

    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < startWeekday; i += 1) {
      const blank = document.createElement('div');
      blank.classList.add('locator-cal-cell', 'is-blank');
      grid.append(blank);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(viewYear, viewMonth, day);
      d.setHours(0, 0, 0, 0);
      const key = ymdKey(d);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.classList.add('locator-cal-cell');
      cell.textContent = String(day);

      if (eventDates.has(key)) cell.classList.add('has-event');
      if (activeDateKey === key) cell.classList.add('is-active');

      cell.addEventListener('click', () => {
        activeDateKey = (activeDateKey === key) ? null : key;

        if (activeDateKey) {
          const hhFiltered = (hhGrouped || []).filter(([k]) => k === activeDateKey);
          const commFiltered = (commGrouped || []).filter(([k]) => k === activeDateKey);
          renderGroupedList(eventsHHResults, hhFiltered);
          renderGroupedList(eventsCommResults, commFiltered);
        } else {
          renderGroupedList(eventsHHResults, hhGrouped);
          renderGroupedList(eventsCommResults, commGrouped);
        }

        renderCalendar();
      });

      grid.append(cell);
    }

    calendarEl.append(grid);
  };

  renderCalendar();
}

function displayHHResults(results, location) {
  const { retailers, distributors, online } = results;

  const cleanTel = (v) => (v || '').toString().replace(/[^\d+]/g, '');

  const appendAddress = (li, result) => {
    if (!result.ADDRESS_1) return;

    const addressWrapper = document.createElement('span');
    addressWrapper.classList.add('locator-address');

    const addressLabel = document.createElement('strong');
    addressLabel.textContent = 'Address: ';
    addressWrapper.append(addressLabel);

    const addressLink = document.createElement('a');
    const addressQuery = `${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`.replace(/\s+/g, ' ').trim();
    addressLink.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
    addressLink.target = '_blank';
    addressLink.rel = 'noopener noreferrer';
    addressLink.textContent = addressQuery;

    addressWrapper.append(addressLink);
    li.append(addressWrapper);
  };

  const appendWebsite = (li, result) => {
    if (!result.WEB_ADDRESS) return;

    const webWrapper = document.createElement('span');
    webWrapper.classList.add('locator-web');

    const webLabel = document.createElement('strong');
    webLabel.textContent = 'Website: ';
    webWrapper.append(webLabel);

    const webLink = document.createElement('a');
    const webAddress = result.WEB_ADDRESS.startsWith('http')
      ? result.WEB_ADDRESS
      : `https://${result.WEB_ADDRESS}`;

    webLink.href = webAddress;
    webLink.target = '_blank';
    webLink.rel = 'noopener noreferrer';
    webLink.textContent = result.WEB_ADDRESS_LINK_TEXT || result.WEB_ADDRESS;

    webWrapper.append(webLink);
    li.append(webWrapper);
  };

  const appendPhone = (li, result) => {
    if (!result.PHONE_NUMBER) return;

    const phoneWrapper = document.createElement('span');
    phoneWrapper.classList.add('locator-phone');

    const phoneLabel = document.createElement('strong');
    phoneLabel.textContent = 'Phone: ';
    phoneWrapper.append(phoneLabel);

    const phoneLink = document.createElement('a');
    phoneLink.href = `tel:${cleanTel(result.PHONE_NUMBER)}`;
    phoneLink.textContent = result.PHONE_NUMBER;
    phoneLink.target = '_blank';
    phoneLink.rel = 'noopener noreferrer';

    phoneWrapper.append(phoneLink);
    li.append(phoneWrapper);
  };

  const appendDistance = (li, result) => {
    if (!location?.lat || !location?.lng || result.lat == null || result.lng == null) return;

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);
  };

  const createOnlineResult = (result) => {
    const li = document.createElement('li');

    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    appendAddress(li, result);
    appendWebsite(li, result);
    appendPhone(li, result);

    return li;
  };

  const createDistributorResult = (result) => {
    const li = document.createElement('li');

    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    appendDistance(li, result);
    appendAddress(li, result);
    appendWebsite(li, result);
    appendPhone(li, result);

    return li;
  };

  const createRetailerResult = (result) => {
    const li = document.createElement('li');

    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    appendDistance(li, result);
    appendAddress(li, result);
    appendWebsite(li, result);
    appendPhone(li, result);

    return li;
  };

  // Retailers
  if (retailers && retailers.length > 0) {
    const retailerList = document.createElement('ol');
    retailers.forEach((retailer) => {
      retailerList.appendChild(createRetailerResult(retailer));
    });
    hhRetailersResults.textContent = '';
    hhRetailersResults.appendChild(retailerList);
  } else {
    hhRetailersResults.innerHTML = '<p>No retailers found</p>';
  }

  // Distributors
  if (distributors && distributors.length > 0) {
    const distributorList = document.createElement('ol');
    distributors.forEach((distributor) => {
      distributorList.appendChild(createDistributorResult(distributor));
    });
    hhDistributorsResults.textContent = '';
    hhDistributorsResults.appendChild(distributorList);
  } else {
    hhDistributorsResults.innerHTML = '<p>No distributors found</p>';
  }

  // Online
  if (online && online.length > 0) {
    const onlineList = document.createElement('ol');
    online.forEach((item) => {
      onlineList.appendChild(createOnlineResult(item));
    });
    hhOnlineResults.textContent = '';
    hhOnlineResults.appendChild(onlineList);
  } else {
    hhOnlineResults.innerHTML = '<p>No online retailers found</p>';
  }
}


export default function decorate(widget) {
  widget.style.visibility = 'hidden';
  loadCSS('/blocks/form/form.css').then(() => widget.removeAttribute('style'));

  const form = widget.querySelector('form');

  // set initial values from query params
  const queryParams = Object.fromEntries(new URLSearchParams(window.location.search));
  Object.entries(queryParams).forEach(([key, value]) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) input.value = value;
  });

  // load results data
  setTimeout(() => fetchData(form), 300);

  const tabpanels = widget.querySelectorAll('.locator-tabpanels .locator-tabpanel');
  const tablistButtons = widget.querySelectorAll('.locator-results-tablist button');
  const showTab = (tabButton) => {
    tablistButtons.forEach((b) => b.removeAttribute('aria-selected'));
    tabpanels.forEach((panel) => panel.setAttribute('aria-hidden', true));
    tabButton.setAttribute('aria-selected', 'true');
    const tabpanel = document.getElementById(tabButton.getAttribute('aria-controls'));
    tabpanel.setAttribute('aria-hidden', false);
  };

  const showType = (type) => {
    widget.querySelectorAll('.locator-results').forEach((result) => {
      result.setAttribute('aria-hidden', true);
    });
    widget.querySelector(`.locator-results.locator-${type}-results`).setAttribute('aria-hidden', false);
    showTab(widget.querySelector(`.locator-results.locator-${type}-results button`));
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    const { location, countryShort, countryLong } = await geoCode(data.address);

    if (data.productType === 'HH') {
      if (location) {
        const results = findHHResults(window.locatorData.HH, location, countryShort, countryLong);
        displayHHResults(results, location);
      } else {
        displayHHResults({});
      }
      showType('hh');
    }

    if (data.productType === 'COMM') {
      if (location) {
        const results = findCommResults(window.locatorData.COMM, location, countryShort, countryLong);
        displayCommResults(results, location);
      } else {
        displayCommResults({});
      }
      showType('comm');
    }

    if (data.productType === 'EVENTS') {
      if (location) {
        const results = findEventsResults(window.locatorData.EVENTS, location);
        displayEventsResults(results, location);
      } else {
        displayEventsResults({ hhGrouped: [], commGrouped: [] }, location);
      }
      showType('events');
    }
  });

  tablistButtons.forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      showTab(button);
    });
  });

  widget.querySelector('#productType').addEventListener('change', () => {
    if (widget.querySelector('#address').value) {
      form.requestSubmit();
    }
  });
}
