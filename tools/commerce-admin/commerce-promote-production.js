/* eslint-disable import/prefer-default-export -- one mount function; named import at call sites */
/**
 * Cross-environment copy control for commerce detail modals (coupon type, cart rule, promotion).
 * Direction depends on the active API environment:
 * - **Staging** → "Promote to Production" (writes to prod).
 * - **Production** → "Copy to Staging" (writes to stage).
 * The write is env-targeted (target base URL + the target's OTP token) while the UI stays on the
 * source env.
 *
 * Rules:
 * - The button is disabled unless an OTP session exists for the **target** env (see auth helpers).
 * - When the entity already exists in the target, a JSON diff (source → target) is shown and the
 *   user must confirm before the write.
 * - Coupons copy the **type/definition only** — coupon codes (`coupons` / `coupons/batch`) are
 *   maintained separately per environment and are never touched here.
 */

import { getApiEnvironment, getAuthStateForEnv, apiFetch } from './commerce-otp-api.js';
import { escapeHtml } from './commerce-otp-ui.js';
import { jsonDiffLines, renderJsonDiffHtml, jsonEqual } from './commerce-json-diff.js';
import {
  fetchCartPriceRules,
  putCartPriceRules,
  fetchCatalogPriceRules,
  putCatalogPriceRules,
} from './price-rules-api.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';

/** Metadata that must not show up as a diff or be meaningfully copied. */
const VOLATILE_KEYS = ['createdAt', 'updatedAt', 'created_at', 'updated_at'];

async function readError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

/**
 * Direction config from the active env: which env we write to and how to label the flow.
 * `stageParam` is the `?stage=` value that opens the target env in a new tab (see auth-page-boot).
 *
 * @returns {null | { active: 'stage'|'prod', target: 'stage'|'prod', verb: string,
 *   verbPast: string, targetLabel: string, targetLower: string, sourceLabel: string,
 *   actionLabel: string, stageParam: string }}
 */
function directionConfig() {
  const active = getApiEnvironment();
  if (active === 'stage') {
    return {
      active,
      target: 'prod',
      verb: 'Promote',
      verbPast: 'Promoted',
      targetLabel: 'Production',
      targetLower: 'production',
      sourceLabel: 'Staging',
      actionLabel: 'Open production ↗',
      stageParam: 'false',
    };
  }
  if (active === 'prod') {
    return {
      active,
      target: 'stage',
      verb: 'Copy',
      verbPast: 'Copied',
      targetLabel: 'Staging',
      targetLower: 'staging',
      sourceLabel: 'Production',
      actionLabel: 'Open staging ↗',
      stageParam: 'true',
    };
  }
  return null;
}

/** Open the current admin page in a new tab pinned to a specific env via `?stage=`. */
function openEnvWindow(stageParam) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('stage', stageParam);
    window.open(url.toString(), '_blank', 'noopener');
  } catch {
    // ignore — nothing actionable if the URL can't be built
  }
}

/**
 * Per-entity adapters. Each resolves the entity id + API-shaped payload from the modal's
 * `getPayload()`, reads the current copy in `env`, and writes the copy to `env`. `quiet`/
 * `skipAuthRedirect` keep cross-env failures from signing the user out of the active env — they
 * surface as thrown errors instead.
 */
const COPY_ADAPTERS = {
  coupon: {
    label: 'coupon',
    omitKeys: [...VOLATILE_KEYS, 'codes', 'code'],
    idOf: (p) => String(p?.id ?? '').trim(),
    entityOf: (p) => {
      const entity = { ...(p || {}) };
      // Never copy codes — they are environment-specific.
      delete entity.codes;
      delete entity.code;
      return entity;
    },
    read: async (org, site, id, env) => {
      const resp = await apiFetch(org, site, `coupons/types/${encodeURIComponent(id)}`, {
        method: 'GET', env, quiet: true, skipAuthRedirect: true,
      });
      if (resp.status === 404) return { existing: null };
      if (!resp.ok) throw new Error(await readError(resp));
      return { existing: await resp.json() };
    },
    write: async (org, site, id, entity, existed, env) => {
      const method = existed ? 'PUT' : 'POST';
      const path = existed ? `coupons/types/${encodeURIComponent(id)}` : 'coupons/types';
      const resp = await apiFetch(org, site, path, {
        method, body: JSON.stringify(entity), env, quiet: true, skipAuthRedirect: true,
      });
      if (!resp.ok) throw new Error(await readError(resp));
    },
  },

  'cart-rule': {
    label: 'cart rule',
    omitKeys: VOLATILE_KEYS,
    idOf: (p) => String(p?.apiRule?.id ?? p?.rule?.id ?? '').trim(),
    entityOf: (p) => p?.apiRule ?? p?.rule ?? null,
    read: async (org, site, id, env) => {
      const doc = await fetchCartPriceRules(org, site, { env });
      const rules = Array.isArray(doc?.rules) ? doc.rules : [];
      return { existing: rules.find((r) => String(r?.id) === id) || null };
    },
    write: async (org, site, id, entity, existed, env) => {
      // Re-read immediately before writing to shrink the read-modify-write window.
      const doc = await fetchCartPriceRules(org, site, { env });
      const rules = Array.isArray(doc?.rules) ? [...doc.rules] : [];
      const i = rules.findIndex((r) => String(r?.id) === id);
      if (i === -1) rules.push(entity);
      else rules[i] = entity;
      await putCartPriceRules(org, site, rules, { env });
    },
  },

  promotion: {
    label: 'promotion',
    omitKeys: VOLATILE_KEYS,
    idOf: (p) => String(p?.promotion?.id ?? '').trim(),
    entityOf: (p) => p?.promotion ?? null,
    read: async (org, site, id, env) => {
      const doc = await fetchCatalogPriceRules(org, site, { env });
      const promotions = Array.isArray(doc?.promotions) ? doc.promotions : [];
      return { existing: promotions.find((p) => String(p?.id) === id) || null };
    },
    write: async (org, site, id, entity, existed, env) => {
      const doc = await fetchCatalogPriceRules(org, site, { env });
      const promotions = Array.isArray(doc?.promotions) ? [...doc.promotions] : [];
      const i = promotions.findIndex((p) => String(p?.id) === id);
      if (i === -1) promotions.push(entity);
      else promotions[i] = entity;
      await putCatalogPriceRules(org, site, { promotions }, { env });
    },
  },
};

/**
 * Cross-env copy dialog. Drives the whole flow — read target → show the source→target JSON diff →
 * confirm → write — reporting every state (checking / in sync / working / success / error) in a
 * **status bar at the bottom of the dialog** (same footer pattern as the promotion edit dialog).
 * Feedback stays on top of the detail modal instead of behind it (which is where toasts land).
 *
 * @param {ReturnType<typeof directionConfig>} cfg
 * @param {object} args
 * @param {string} args.org
 * @param {string} args.site
 * @param {typeof COPY_ADAPTERS[keyof typeof COPY_ADAPTERS]} args.adapter
 * @param {string} args.id
 * @param {unknown} args.entity
 */
function openCopyDialog(cfg, {
  org, site, adapter, id, entity,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'coupons-dialog commerce-promote-dialog';
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <div class="coupons-dialog-scroll" tabindex="-1">
        <h2 class="coupons-dialog-title" data-promote-title>${cfg.verb} to ${cfg.targetLabel}</h2>
        <p class="commerce-promote-lead" data-promote-lead></p>
        <div data-promote-diff></div>
      </div>
      <div class="commerce-promote-statusbar">
        <p class="commerce-promote-status" data-promote-status role="status" aria-live="polite" hidden></p>
        <div class="commerce-promote-actions">
          <button type="button" class="coupons-btn" data-promote-cancel>Cancel</button>
          <button type="button" class="coupons-btn coupons-btn-primary" data-promote-confirm hidden></button>
          <button type="button" class="coupons-btn coupons-btn-primary" data-promote-open hidden>${cfg.actionLabel}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const titleEl = dialog.querySelector('[data-promote-title]');
  const leadEl = dialog.querySelector('[data-promote-lead]');
  const diffEl = dialog.querySelector('[data-promote-diff]');
  const statusEl = /** @type {HTMLElement} */ (dialog.querySelector('[data-promote-status]'));
  const cancelBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-promote-cancel]'));
  const confirmBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-promote-confirm]'));
  const openBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-promote-open]'));

  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const setStatus = (msg, kind) => {
    statusEl.textContent = msg || '';
    statusEl.className = `commerce-promote-status${kind ? ` is-${kind}` : ''}`;
    statusEl.hidden = !msg;
  };
  const setLead = (text) => {
    leadEl.innerHTML = `${escapeHtml(text)} <code>${escapeHtml(id)}</code>`;
  };

  wireDialogEscapeDismiss(dialog, close);
  cancelBtn.addEventListener('click', close);
  openBtn.addEventListener('click', () => openEnvWindow(cfg.stageParam));
  dialog.showModal();

  (async () => {
    if (!id || !entity) {
      titleEl.textContent = `Cannot ${cfg.verb.toLowerCase()}`;
      setStatus(`Nothing to ${cfg.verb.toLowerCase()} for this ${adapter.label}.`, 'error');
      cancelBtn.textContent = 'Close';
      return;
    }
    setStatus(`Checking ${cfg.targetLower}…`, 'info');

    let existing = null;
    try {
      ({ existing } = await adapter.read(org, site, id, cfg.target));
    } catch (err) {
      setStatus(err?.message || `Could not read ${cfg.targetLower}.`, 'error');
      cancelBtn.textContent = 'Close';
      return;
    }

    if (existing && jsonEqual(existing, entity, adapter.omitKeys)) {
      titleEl.textContent = `Already in ${cfg.targetLabel}`;
      setLead(`This ${adapter.label} already matches ${cfg.targetLower}.`);
      setStatus(`Nothing to ${cfg.verb.toLowerCase()}.`, 'success');
      cancelBtn.textContent = 'Close';
      return;
    }

    titleEl.textContent = existing
      ? `${cfg.verb} changes to ${cfg.targetLabel}`
      : `Create in ${cfg.targetLabel}`;
    setLead(existing
      ? `This ${adapter.label} already exists in ${cfg.targetLower}. Review the changes before continuing.`
      : `This ${adapter.label} does not exist in ${cfg.targetLower} yet — it will be created.`);
    diffEl.innerHTML = renderJsonDiffHtml(
      jsonDiffLines(existing ?? null, entity, adapter.omitKeys),
    );
    confirmBtn.textContent = existing ? `${cfg.verb} to ${cfg.targetLabel}` : `Create in ${cfg.targetLabel}`;
    confirmBtn.hidden = false;
    setStatus('');

    confirmBtn.addEventListener('click', async () => {
      setStatus(`${cfg.verb === 'Promote' ? 'Promoting' : 'Copying'}…`, 'info');
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        await adapter.write(org, site, id, entity, Boolean(existing), cfg.target);
        titleEl.textContent = `${cfg.verbPast} to ${cfg.targetLabel}`;
        setStatus(`${cfg.verbPast} ${adapter.label} “${id}” to ${cfg.targetLower}.`, 'success');
        confirmBtn.hidden = true;
        openBtn.hidden = false;
        cancelBtn.textContent = 'Close';
        cancelBtn.disabled = false;
      } catch (err) {
        setStatus(err?.message || `${cfg.verb} failed`, 'error');
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });
  })();
}

/**
 * Adds the cross-env copy button to the modal toolbar (left cluster). No-op unless the active API
 * env is staging or production.
 *
 * @param {HTMLElement} toolbarMain
 * @param {object} opts
 * @param {string} opts.org
 * @param {string} opts.site
 * @param {'coupon'|'cart-rule'|'promotion'} opts.entityKind
 * @param {() => unknown} opts.getPayload
 */
export function mountCrossEnvCopyInToolbar(toolbarMain, {
  org, site, entityKind, getPayload,
}) {
  const cfg = directionConfig();
  if (!toolbarMain || !cfg) return;
  const adapter = COPY_ADAPTERS[entityKind];
  if (!adapter) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'commerce-promote-production-btn';
  if (cfg.target === 'stage') btn.classList.add('commerce-promote-production-btn-stage');
  btn.textContent = `${cfg.verb} to ${cfg.targetLabel}`;

  const refreshEnabled = () => {
    const hasTarget = Boolean(getAuthStateForEnv(org, site, cfg.target)?.token);
    btn.disabled = !hasTarget;
    btn.title = hasTarget
      ? `${cfg.verb} this ${adapter.label} to ${cfg.targetLower} — you'll review and confirm any changes first.`
      : `Sign in to ${cfg.targetLabel} to enable: set the header environment to ${cfg.targetLabel}, complete OTP, then switch back to ${cfg.sourceLabel}.`;
  };
  refreshEnabled();

  // Re-enable live when a target session appears (login in another tab / after a header switch).
  // Handlers self-remove once the button leaves the DOM (modal closed).
  const cleanup = () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onFocus);
  };
  function onStorage(e) {
    if (!btn.isConnected) { cleanup(); return; }
    if (!e || e.key == null || String(e.key).includes('pbus-auth')) refreshEnabled();
  }
  function onFocus() {
    if (!btn.isConnected) { cleanup(); return; }
    refreshEnabled();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onFocus);

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (!getAuthStateForEnv(org, site, cfg.target)?.token) {
      refreshEnabled();
      return;
    }
    const payload = getPayload();
    openCopyDialog(cfg, {
      org,
      site,
      adapter,
      id: adapter.idOf(payload),
      entity: adapter.entityOf(payload),
    });
  });

  toolbarMain.prepend(btn);
}
