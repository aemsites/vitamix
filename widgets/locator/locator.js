import { loadCSS } from '../../scripts/aem.js';

const MAX_DISTANCE = 100;

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
  const r0 = results?.[0];

  const comps = r0?.address_components || [];
  const findType = (t) => comps.find((c) => Array.isArray(c.types) && c.types.includes(t));
  const countryComp = findType('country');
  const admin1Comp = findType('administrative_area_level_1');
  return {
    location: r0?.geometry?.location || null,
    country: countryComp ? {
      short: countryComp.short_name,
      long: countryComp.long_name,
      type: 'country',
    } : null,
    region: admin1Comp ? {
      short: admin1Comp.short_name,
      long: admin1Comp.long_name,
      type: 'administrative_area_level_1',
    } : null,
  };
}

function findEventsResults(data, location) {
  // Household Events
  const filteredHHEvents = data.filter((item) => item.PRODUCT_TYPE === 'HH');
  const hhEvents = filteredHHEvents.sort(
    (a, b) => haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng),
  );

  // Commercial Events
  const filteredCommEvents = data.filter((item) => item.PRODUCT_TYPE === 'COMM');
  const commEvents = filteredCommEvents.sort(
    (a, b) => haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng),
  );

  return { hhEvents, commEvents };
}

function findCommResults(data, location, countryShort, regionShort) {
  // Distributors
  const filteredDistributors = data.filter(
    (item) => item.TYPE === 'DEALER/DISTRIBUTOR' && haversineDistance(location.lat, location.lng, item.lat, item.lng) < MAX_DISTANCE,
  );
  const distributors = filteredDistributors.sort(
    (a, b) => haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng),
  );

  // Local Representatives (country-based)
  const wantCountry = (countryShort || '').toUpperCase();
  const wantRegion = (regionShort || '').toUpperCase();

  // Local Representatives (country + region match)
  const localRep = data.filter((item) => {
    if (item.TYPE !== 'LOCAL REP') return false;
    const itemCountry = String(item.COUNTRY || '').toUpperCase();
    const itemRegion = String(item.STATE_PROVINCE || item.STATE || item.PROVINCE || '').toUpperCase();
    return itemCountry === wantCountry && itemRegion === wantRegion;
  });

  return { distributors, localRep };
}

function findHHResults(data, location, country) {
  // Retailers
  const filteredRetailers = data.filter(
    (item) => item.TYPE === 'RETAILERS' && haversineDistance(location.lat, location.lng, item.lat, item.lng) < MAX_DISTANCE,
  );
  const retailers = filteredRetailers.sort(
    (a, b) => haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng),
  );

  // Distributors
  const filteredDistributors = data.filter((item) => item.TYPE === 'DEALER/DISTRIBUTOR');
  const distributors = filteredDistributors.sort(
    (a, b) => haversineDistance(location.lat, location.lng, a.lat, a.lng)
      - haversineDistance(location.lat, location.lng, b.lat, b.lng),
  );

  // Online
  const online = data.filter((item) => item.TYPE === 'ONLINE' && item.COUNTRY === country);

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

    const address = document.createElement('a');
    const addressQuery = `${result.NAME} ${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`;
    address.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
    address.target = '_blank';
    address.rel = 'noopener noreferrer';
    address.textContent = addressQuery;
    address.classList.add('locator-address');
    li.append(address);

    // Phone number
    if (result.PHONE_NUMBER) {
      const phoneWrapper = document.createElement('span');
      phoneWrapper.classList.add('locator-phone');
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
  const { hhEvents, commEvents } = results;
  const formatDate = (excelDate) => {
    // Excel dates are the number of days since January 1, 1900
    // JavaScript dates are milliseconds since January 1, 1970
    // Excel has a bug where it treats 1900 as a leap year, so we adjust for that
    const excelEpoch = new Date(1900, 0, 1); // January 1, 1900
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    // Adjust for Excel's leap year bug
    const adjustedDays = excelDate > 59 ? excelDate - 1 : excelDate;
    const date = new Date(excelEpoch.getTime() + (adjustedDays - 1) * millisecondsPerDay);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const createHHEventResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    const date = document.createElement('span');
    date.textContent = `${formatDate(result.START_DATE)} - ${formatDate(result.END_DATE)}`;
    date.classList.add('locator-date');
    li.append(date);

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);

    const address = document.createElement('a');
    const addressQuery = `${result.NAME} ${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`;
    address.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
    address.target = '_blank';
    address.rel = 'noopener noreferrer';
    address.textContent = addressQuery;
    address.classList.add('locator-address');
    li.append(address);

    return li;
  };

  const createCommEventResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    const date = document.createElement('span');
    date.textContent = `${formatDate(result.START_DATE)} - ${formatDate(result.END_DATE)}`;
    date.classList.add('locator-date');
    li.append(date);

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);

    const address = document.createElement('a');
    const addressQuery = `${result.NAME} ${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`;
    address.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
    address.target = '_blank';
    address.rel = 'noopener noreferrer';
    address.textContent = addressQuery;
    address.classList.add('locator-address');
    li.append(address);

    return li;
  };

  if (hhEvents && hhEvents.length > 0) {
    const hhEventList = document.createElement('ol');
    hhEvents.forEach((event) => {
      hhEventList.appendChild(createHHEventResult(event));
    });
    eventsHHResults.textContent = '';
    eventsHHResults.appendChild(hhEventList);
  } else {
    eventsHHResults.innerHTML = '<p>No household events found</p>';
  }

  if (commEvents && commEvents.length > 0) {
    const commEventList = document.createElement('ol');
    commEvents.forEach((event) => {
      commEventList.appendChild(createCommEventResult(event));
    });
    eventsCommResults.textContent = '';
    eventsCommResults.appendChild(commEventList);
  } else {
    eventsCommResults.innerHTML = '<p>No commercial events found</p>';
  }
}

function displayHHResults(results, location) {
  const { retailers, distributors, online } = results;

  const createOnlineResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);
    if (result.WEB_ADDRESS) {
      const label = document.createElement('span');
      label.textContent = 'Website: ';
      label.classList.add('locator-website-label');

      const website = document.createElement('a');
      website.href = result.WEB_ADDRESS.startsWith('https://') ? result.WEB_ADDRESS : `https://${result.WEB_ADDRESS}`;
      website.textContent = new URL(website.href).hostname;
      website.target = '_blank';
      website.rel = 'noopener noreferrer';
      website.classList.add('locator-website');
      label.append(website);
      li.append(label);
    }
    return li;
  };

  const createDistributorResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);

    const address = document.createElement('a');
    const addressQuery = `${result.NAME} ${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`;
    address.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
    address.target = '_blank';
    address.rel = 'noopener noreferrer';
    address.textContent = addressQuery;
    address.classList.add('locator-address');
    li.append(address);

    return li;
  };

  const createRetailerResult = (result) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = result.NAME;
    li.append(title);

    const distance = document.createElement('span');
    distance.textContent = `${haversineDistance(location.lat, location.lng, result.lat, result.lng).toFixed(1)} miles away`;
    distance.classList.add('locator-distance');
    li.append(distance);

    const address = document.createElement('a');
    const addressQuery = `${result.NAME} ${result.ADDRESS_1}, ${result.CITY}, ${result.STATE_PROVINCE} ${result.POSTAL_CODE}`;
    address.href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
    address.target = '_blank';
    address.rel = 'noopener noreferrer';
    address.textContent = addressQuery;
    address.classList.add('locator-address');
    li.append(address);

    if (result.WEB_ADDRESS) {
      const label = document.createElement('span');
      label.textContent = 'Website: ';
      label.classList.add('locator-website-label');

      const website = document.createElement('a');
      website.href = result.WEB_ADDRESS.startsWith('https://') ? result.WEB_ADDRESS : `https://${result.WEB_ADDRESS}`;
      website.textContent = new URL(website.href).hostname;
      website.target = '_blank';
      website.rel = 'noopener noreferrer';
      website.classList.add('locator-website');
      label.append(website);
      li.append(label);
    }

    if (result.PHONE_NUMBER) {
      const label = document.createElement('span');
      label.textContent = 'Phone: ';
      label.classList.add('locator-phone-label');

      const phone = document.createElement('a');
      phone.textContent = result.PHONE_NUMBER;
      phone.href = `tel:${result.PHONE_NUMBER}`;
      phone.target = '_blank';
      phone.rel = 'noopener noreferrer';
      phone.classList.add('locator-phone');
      label.append(phone);
      li.append(label);
    }
    return li;
  };

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
    const { location, country, region } = await geoCode(data.address);

    if (data.productType === 'HH') {
      if (location) {
        const results = findHHResults(window.locatorData.HH, location, country?.short);
        displayHHResults(results, location);
      } else {
        displayHHResults({});
      }
      showType('hh');
    }

    if (data.productType === 'COMM') {
      if (location) {
        const results = findCommResults(
          window.locatorData.COMM,
          location,
          country?.short,
          region?.short,
        );
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
        displayEventsResults({});
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
