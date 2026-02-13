(function initBulkLinkChecker() {
  const pageLimitInput = document.getElementById('page-limit');
  const pathFilterInput = document.getElementById('path-filter');
  const filterCountEl = document.getElementById('filter-count');
  const runBtn = document.getElementById('run-check');
  const cancelBtn = document.getElementById('cancel-check');
  const statusSection = document.getElementById('status-section');
  const statusLog = document.getElementById('status-log');
  const progressFill = document.getElementById('progress-fill');
  const resultsSection = document.getElementById('results');
  const resultsSummary = document.getElementById('results-summary');
  const resultsDetail = document.getElementById('results-detail');
  const errorSection = document.getElementById('error');
  const errorMessage = document.getElementById('error-message');

  let abortController = null;
  let allPaths = [];

  function setProgress(percent) {
    progressFill.style.width = `${percent}%`;
    progressFill.parentElement.setAttribute('aria-valuenow', percent);
  }

  function clearStatus() {
    statusLog.innerHTML = '';
  }

  function appendStatus(line) {
    statusSection.hidden = false;
    const entry = document.createElement('div');
    entry.className = 'status-line';
    if (line.type) entry.classList.add(`status-line-${line.type}`);
    if (line.text != null) entry.appendChild(document.createTextNode(line.text));
    if (line.url) {
      const a = document.createElement('a');
      a.href = line.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = line.urlText != null ? line.urlText : line.url;
      entry.appendChild(a);
    }
    if (line.badge != null) {
      const badge = document.createElement('span');
      badge.className = `status-badge status-badge-${line.badgeClass || 'neutral'}`;
      badge.textContent = line.badge;
      entry.appendChild(badge);
    }
    statusLog.appendChild(entry);
    statusLog.scrollTop = statusLog.scrollHeight;
  }

  function showError(msg) {
    errorSection.hidden = false;
    errorMessage.textContent = msg;
  }

  function hideError() {
    errorSection.hidden = true;
  }

  function normalizedPath(p) {
    return p.startsWith('/') ? p : `/${p}`;
  }

  function pathMatchesFilter(path, filterValue) {
    if (!filterValue.trim()) return true;
    const pathNorm = normalizedPath(path);
    let filterNorm = filterValue.trim();
    if (filterNorm && !filterNorm.startsWith('/')) filterNorm = `/${filterNorm}`;
    return pathNorm.startsWith(filterNorm);
  }

  function getFilteredPaths() {
    const filterValue = pathFilterInput.value || '';
    if (!filterValue.trim()) return allPaths;
    return allPaths.filter((p) => pathMatchesFilter(p, filterValue));
  }

  function updateFilterCount() {
    const filtered = getFilteredPaths();
    const total = allPaths.length;
    if (total === 0) {
      filterCountEl.textContent = '';
      return;
    }
    if (pathFilterInput.value.trim()) {
      filterCountEl.textContent = `${filtered.length} of ${total} pages match`;
    } else {
      filterCountEl.textContent = `${total} pages in sitemap`;
    }
  }

  function rewriteToCurrentOrigin(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'www.vitamix.com') {
        return new URL(u.pathname + u.search + u.hash, window.location.origin).href;
      }
      return url;
    } catch (_) {
      return url;
    }
  }

  function extractLinksFromHtml(html, pageUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = document.createElement('base');
    base.href = pageUrl;
    doc.head.appendChild(base);
    const links = [];
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = (a.getAttribute('href') || '').trim();
      if (!href) return;
      if (/^(mailto:|tel:|#|javascript:)/i.test(href)) return;
      try {
        const absolute = new URL(href, pageUrl).href;
        links.push(rewriteToCurrentOrigin(absolute));
      } catch (_) {
        // ignore invalid URLs
      }
    });
    return [...new Set(links)];
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const external = options.signal;
    if (external) {
      external.addEventListener('abort', () => {
        clearTimeout(t);
        ctrl.abort();
      });
    }
    try {
      const res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      clearTimeout(t);
      return res;
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderResults(allLinks, pagesChecked, totalLinks) {
    const byStatus = {
      200: [], 404: [], other: [], error: [], aborted: [],
    };
    Array.from(allLinks.entries()).forEach(([url, info]) => {
      const s = info.status;
      if (s === 200) byStatus[200].push({ url, info });
      else if (s === 404) byStatus[404].push({ url, info });
      else if (s === 'error' || s === 'aborted') byStatus[s].push({ url, info });
      else byStatus.other.push({ url, info });
    });

    const ok = byStatus[200].length;
    const broken = byStatus[404].length;
    const other = byStatus.other.length;
    const failed = byStatus.error.length + byStatus.aborted.length;

    resultsSummary.innerHTML = `
      <p><strong>Pages checked:</strong> ${pagesChecked}</p>
      <p><strong>Links found:</strong> ${totalLinks}</p>
      <p class="status-200"><strong>200 OK:</strong> ${ok}</p>
      <p class="status-404"><strong>404:</strong> ${broken}</p>
      ${other ? `<p class="status-other"><strong>Other status:</strong> ${other}</p>` : ''}
      ${failed ? `<p class="status-error"><strong>Errors:</strong> ${failed}</p>` : ''}
    `;

    const fragment = document.createDocumentFragment();
    if (byStatus[404].length) {
      const h3 = document.createElement('h3');
      h3.textContent = '404 Not Found';
      fragment.appendChild(h3);
      const ul = document.createElement('ul');
      ul.className = 'link-list broken';
      byStatus[404].forEach(({ url, info }) => {
        const li = document.createElement('li');
        li.className = 'broken-item';
        const brokenLink = document.createElement('a');
        brokenLink.href = url;
        brokenLink.target = '_blank';
        brokenLink.rel = 'noopener';
        brokenLink.textContent = url;
        li.appendChild(brokenLink);
        try {
          const u = new URL(url);
          const prodUrl = `https://www.vitamix.com${u.pathname}${u.search}${u.hash}`;
          const prodLink = document.createElement('a');
          prodLink.href = prodUrl;
          prodLink.target = '_blank';
          prodLink.rel = 'noopener';
          prodLink.className = 'prod-link';
          prodLink.textContent = 'View on www.vitamix.com';
          li.appendChild(document.createTextNode(' · '));
          li.appendChild(prodLink);
        } catch (_) {
          // invalid URL, skip prod link
        }
        const from = [...info.fromPages];
        if (from.length) {
          const fromLabel = document.createElement('div');
          fromLabel.className = 'from-pages-label';
          fromLabel.textContent = 'Referenced from:';
          li.appendChild(fromLabel);
          const fromList = document.createElement('ul');
          fromList.className = 'from-pages-list';
          from.forEach((pageUrl) => {
            const fromLi = document.createElement('li');
            const fromA = document.createElement('a');
            fromA.href = pageUrl;
            fromA.target = '_blank';
            fromA.rel = 'noopener';
            fromA.textContent = pageUrl;
            fromLi.appendChild(fromA);
            fromList.appendChild(fromLi);
          });
          li.appendChild(fromList);
        }
        ul.appendChild(li);
      });
      fragment.appendChild(ul);
    }
    if (byStatus.other.length) {
      const h3 = document.createElement('h3');
      h3.textContent = 'Other status';
      fragment.appendChild(h3);
      const ul = document.createElement('ul');
      ul.className = 'link-list other';
      byStatus.other.forEach(({ url, info }) => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a> <span class="status-badge">${info.status}</span>`;
        ul.appendChild(li);
      });
      fragment.appendChild(ul);
    }
    if (byStatus.error.length || byStatus.aborted.length) {
      const h3 = document.createElement('h3');
      h3.textContent = 'Errors / failed';
      fragment.appendChild(h3);
      const ul = document.createElement('ul');
      ul.className = 'link-list errors';
      [...byStatus.error, ...byStatus.aborted].forEach(({ url, info }) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="url">${escapeHtml(url)}</span> <span class="status-badge">${info.status}</span>`;
        ul.appendChild(li);
      });
      fragment.appendChild(ul);
    }
    if (byStatus[200].length && (broken || other || failed)) {
      const h3 = document.createElement('h3');
      h3.textContent = '200 OK (sample)';
      fragment.appendChild(h3);
      const ul = document.createElement('ul');
      ul.className = 'link-list ok';
      byStatus[200].slice(0, 20).forEach(({ url }) => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
        ul.appendChild(li);
      });
      if (byStatus[200].length > 20) {
        const li = document.createElement('li');
        li.className = 'more';
        li.textContent = `… and ${byStatus[200].length - 20} more`;
        ul.appendChild(li);
      }
      fragment.appendChild(ul);
    } else if (byStatus[200].length) {
      const h3 = document.createElement('h3');
      h3.textContent = 'All links returned 200 OK';
      fragment.appendChild(h3);
    }

    resultsDetail.innerHTML = '';
    resultsDetail.appendChild(fragment);
  }

  async function runCheck() {
    hideError();
    resultsSection.hidden = true;
    clearStatus();
    const baseUrl = window.location.origin;
    const limit = Math.max(1, Math.min(500, parseInt(pageLimitInput.value, 10) || 10));
    pageLimitInput.value = limit;
    abortController = new AbortController();
    runBtn.disabled = true;
    cancelBtn.disabled = false;

    try {
      let paths = allPaths.length ? allPaths : null;
      if (!paths) {
        appendStatus({ text: 'Fetching sitemap…', type: 'phase' });
        setProgress(5);
        const sitemapUrl = `${baseUrl}/sitemap.json`;
        const sitemapRes = await fetchWithTimeout(sitemapUrl, { signal: abortController.signal });
        if (!sitemapRes.ok) {
          throw new Error(`Sitemap failed: ${sitemapRes.status} ${sitemapRes.statusText}`);
        }
        const sitemap = await sitemapRes.json();
        const rows = sitemap.data || [];
        paths = rows.map((row) => (row.path != null ? row.path : row[0])).filter(Boolean);
        allPaths = paths;
      } else {
        setProgress(5);
      }
      const filtered = paths.filter((p) => pathMatchesFilter(p, pathFilterInput.value || ''));
      const toCheck = filtered.slice(0, limit);
      appendStatus({ text: `Sitemap loaded. Checking ${toCheck.length} page(s).`, type: 'phase' });

      const allLinks = new Map(); // url -> { status, fromPages: Set }
      let pagesDone = 0;

      await toCheck.reduce(async (prev, path, i) => {
        await prev;
        const pathNorm = path.startsWith('/') ? path : `/${path}`;
        const pageUrl = `${baseUrl}${pathNorm}`;
        appendStatus({
          text: `Page ${i + 1}/${toCheck.length}: `,
          type: 'page',
          url: pageUrl,
        });
        setProgress(10 + (60 * (i + 1)) / toCheck.length);

        const pageRes = await fetchWithTimeout(pageUrl, { signal: abortController.signal });
        const html = await pageRes.text();
        const links = extractLinksFromHtml(html, pageUrl);

        appendStatus({ text: `  Found ${links.length} link(s) on this page.`, type: 'page-links' });

        links.forEach((linkUrl) => {
          if (!allLinks.has(linkUrl)) {
            allLinks.set(linkUrl, { status: null, fromPages: new Set() });
          }
          allLinks.get(linkUrl).fromPages.add(pageUrl);
        });
        pagesDone += 1;
      }, Promise.resolve());

      const linkList = [...allLinks.keys()];
      appendStatus({ text: `Checking ${linkList.length} unique link(s)…`, type: 'phase' });

      await linkList.reduce(async (prev, url, i) => {
        await prev;
        const info = allLinks.get(url);
        appendStatus({ text: '  Checking: ', type: 'link', url });
        try {
          const res = await fetchWithTimeout(url, {
            method: 'HEAD',
            signal: abortController.signal,
            redirect: 'follow',
          });
          info.status = res.status;
        } catch (_) {
          try {
            const res = await fetchWithTimeout(url, {
              method: 'GET',
              signal: abortController.signal,
              redirect: 'follow',
            });
            info.status = res.status;
          } catch (e) {
            info.status = e.name === 'AbortError' ? 'aborted' : 'error';
          }
        }
        let badgeClass = 'warn';
        if (info.status === 200) badgeClass = 'ok';
        else if (info.status === 404) badgeClass = 'fail';
        appendStatus({
          text: '  → ',
          type: 'link-result',
          badge: String(info.status),
          badgeClass,
        });
        setProgress(70 + (25 * (i + 1)) / linkList.length);
      }, Promise.resolve());

      appendStatus({ text: 'Done.', type: 'phase' });
      setProgress(100);
      renderResults(allLinks, pagesDone, linkList.length);
      resultsSection.hidden = false;
    } catch (e) {
      if (e.name === 'AbortError') {
        appendStatus({ text: 'Cancelled.', type: 'phase' });
        setProgress(0);
      } else {
        showError(e.message || 'Check failed.');
        appendStatus({ text: `Error: ${e.message}`, type: 'phase' });
        setProgress(0);
      }
    } finally {
      runBtn.disabled = false;
      cancelBtn.disabled = true;
      abortController = null;
    }
  }

  pathFilterInput.addEventListener('input', updateFilterCount);
  pathFilterInput.addEventListener('change', updateFilterCount);

  cancelBtn.addEventListener('click', () => {
    if (abortController) abortController.abort();
  });

  runBtn.addEventListener('click', runCheck);

  (async function loadSitemap() {
    const baseUrl = window.location.origin;
    try {
      const res = await fetch(`${baseUrl}/sitemap.json`);
      if (!res.ok) return;
      const sitemap = await res.json();
      const rows = sitemap.data || [];
      allPaths = rows.map((row) => (row.path != null ? row.path : row[0])).filter(Boolean);
      updateFilterCount();
    } catch (_) {
      filterCountEl.textContent = 'Sitemap could not be loaded';
    }
  }());
}());
