/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// DOM/formatting helpers shared by rollout-plugin.js (single page) and
// rollout-app.js (batch grid) so both tools present identical status icons,
// tooltips and warnings.

export const EDIT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
export const PREVIEW_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
export const PUBLISH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
export const WARNING_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormatter.format(date);
}

export function buildStatusIcon(svg, active, title, href) {
  const a = document.createElement('a');
  a.className = `rollout-status-icon${active ? ' active' : ''}`;
  a.innerHTML = svg;
  a.title = title;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function buildPendingStatusIcons() {
  const container = document.createElement('span');
  container.className = 'rollout-status-icons rollout-status-icons-pending';
  const spinner = document.createElement('span');
  spinner.className = 'rollout-status-spinner';
  spinner.title = 'Checking preview/publish status…';
  container.appendChild(spinner);
  return container;
}

export function buildRedirectIcon(href) {
  const a = document.createElement('a');
  a.className = 'rollout-status-icon rollout-status-icon-redirect';
  a.textContent = '301';
  a.title = 'Redirects (301) — open destination';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function buildWarningIcon() {
  const span = document.createElement('span');
  span.className = 'rollout-warning-icon';
  span.innerHTML = WARNING_ICON_SVG;
  span.title = 'This page was modified since the last rollout — rolling out will overwrite those changes.';
  return span;
}

/** Edit/preview/publish icon row for a single target page. */
export function buildStatusIcons(entry, targetPagePath, context) {
  const container = document.createElement('span');
  container.className = 'rollout-status-icons';

  const previewDate = formatDate(entry?.previewLastModified);
  const publishDate = formatDate(entry?.publishLastModified);

  const previewTitle = previewDate ? `Previewed ${previewDate}` : 'Not previewed';
  const publishTitle = publishDate ? `Published ${publishDate}` : 'Not published';
  const editUrl = `https://da.live/edit#/${context.org}/${context.repo}${targetPagePath}`;
  const previewUrl = `https://main--${context.repo}--${context.org}.aem.page${targetPagePath}`;
  const liveUrl = `https://main--${context.repo}--${context.org}.aem.live${targetPagePath}`;
  container.appendChild(buildStatusIcon(EDIT_ICON_SVG, true, 'Edit', editUrl));
  container.appendChild(buildStatusIcon(PREVIEW_ICON_SVG, !!previewDate, previewTitle, previewUrl));
  container.appendChild(buildStatusIcon(PUBLISH_ICON_SVG, !!publishDate, publishTitle, liveUrl));

  return container;
}

/** Resolves a redirect destination (if any) into an absolute URL. */
export function redirectDestinationUrl(destination, context) {
  return destination.startsWith('http')
    ? destination
    : `https://main--${context.repo}--${context.org}.aem.live${destination}`;
}
