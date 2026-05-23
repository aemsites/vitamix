import { getMetadata } from '../../scripts/aem.js';

/**
 * Filters the provider list using the `disabled-providers` metadata kill switch.
 * The `?enable-providers=` query param re-enables specific providers for testing.
 * @param {Array<Object>} allProviders
 * @returns {Array<Object>}
 */
export function getActiveProviders(allProviders) {
  const disabled = (getMetadata('disabled-providers') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const reenabled = (new URLSearchParams(window.location.search).get('enable-providers') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return allProviders.filter((p) => {
    if (reenabled.includes(p.id)) return true;
    if (disabled.includes(p.id)) return false;
    return true;
  });
}

const LOCK_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

const CARD_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';

function getProviderMeta(strings) {
  return {
    paypal: {
      label: strings.paypalLabel,
      sublabel: strings.paypalSub,
      icon: '<span class="payment-icon-pp" aria-hidden="true"><b class="pp-pay">Pay</b><b class="pp-pal">Pal</b></span>',
    },
    'apple-pay': {
      label: strings.applePayLabel,
      sublabel: strings.applePaySub,
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>',
    },
    affirm: {
      label: strings.affirmLabel,
      sublabel: strings.affirmSub,
      icon: '<span class="payment-icon-text" aria-hidden="true">Affirm</span>',
    },
  };
}

/**
 * Renders the payment section into the given fieldset.
 * @param {HTMLFieldSetElement} container
 * @param {Array<Object>} activeProviders
 * @param {Object} callbacks
 * @param {Object} strings
 */
export function renderPaymentSection(container, activeProviders, callbacks, strings, config = {}) {
  const providerMeta = getProviderMeta(strings);
  const cardProviderId = config.cardProvider || 'chase';
  const chaseActive = activeProviders.some((p) => p.id === cardProviderId);

  // Security notice banner
  const notice = document.createElement('div');
  notice.className = 'payment-security-notice';

  const noticeIcon = document.createElement('span');
  noticeIcon.className = 'payment-security-icon';
  noticeIcon.innerHTML = LOCK_ICON_SVG;

  const noticeText = document.createElement('div');
  noticeText.className = 'payment-security-text';

  const noticeTitle = document.createElement('strong');
  noticeTitle.textContent = strings.paymentSecureTitle;

  const noticeSub = document.createElement('span');
  noticeSub.textContent = strings.paymentSecureSub;

  noticeText.append(noticeTitle, noticeSub);
  notice.append(noticeIcon, noticeText);
  container.appendChild(notice);

  // Section label
  const howLabel = document.createElement('p');
  howLabel.className = 'payment-how-label';
  howLabel.textContent = strings.paymentHow;
  container.appendChild(howLabel);

  // Options wrapper
  const optionsWrapper = document.createElement('div');
  optionsWrapper.className = 'payment-options';

  // Credit card option
  if (chaseActive) {
    const cardLabel = document.createElement('label');
    cardLabel.className = 'payment-option-card payment-option-active';

    const cardRadio = document.createElement('input');
    cardRadio.type = 'radio';
    cardRadio.name = 'paymentMethod';
    cardRadio.value = cardProviderId;
    cardRadio.checked = true;
    cardRadio.id = 'payment-credit-card';

    const cardIcon = document.createElement('span');
    cardIcon.className = 'payment-option-icon';
    cardIcon.innerHTML = CARD_ICON_SVG;

    const cardContent = document.createElement('div');
    cardContent.className = 'payment-option-content';

    const cardTitle = document.createElement('span');
    cardTitle.className = 'payment-option-label';
    cardTitle.textContent = strings.creditCard;

    const cardSub = document.createElement('span');
    cardSub.className = 'payment-option-sublabel';
    cardSub.textContent = strings.creditCardSub;

    cardContent.append(cardTitle, cardSub);

    const cardBadges = document.createElement('div');
    cardBadges.className = 'payment-option-badges';
    ['VISA', 'MC', 'AMEX'].forEach((name) => {
      const badge = document.createElement('span');
      badge.className = 'card-badge';
      badge.textContent = name;
      cardBadges.appendChild(badge);
    });

    cardLabel.append(cardRadio, cardIcon, cardContent, cardBadges);
    optionsWrapper.appendChild(cardLabel);
  }

  // Provider options (Chase is rendered above as the card block)
  activeProviders.filter((p) => p.id !== cardProviderId).forEach((provider) => {
    const meta = providerMeta[provider.id] || { label: provider.id, sublabel: '', icon: '' };

    const optLabel = document.createElement('label');
    optLabel.className = 'payment-option-card';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'paymentMethod';
    radio.value = provider.id;
    radio.id = `payment-${provider.id}`;

    const optIcon = document.createElement('span');
    optIcon.className = 'payment-option-icon';
    optIcon.innerHTML = meta.icon;

    const optContent = document.createElement('div');
    optContent.className = 'payment-option-content';

    const optTitle = document.createElement('span');
    optTitle.className = 'payment-option-label';
    optTitle.textContent = meta.label || provider.label;

    const optSub = document.createElement('span');
    optSub.className = 'payment-option-sublabel';
    optSub.textContent = meta.sublabel;

    optContent.append(optTitle, optSub);
    optLabel.append(radio, optIcon, optContent);
    optionsWrapper.appendChild(optLabel);

    // Hidden container for provider SDK button (outside label to avoid click conflicts)
    const btnContainer = document.createElement('div');
    btnContainer.className = 'payment-button-container';
    btnContainer.dataset.provider = provider.id;
    btnContainer.setAttribute('aria-hidden', 'true');
    optionsWrapper.appendChild(btnContainer);

    provider.renderCheckoutButton(btnContainer, callbacks);
  });

  container.appendChild(optionsWrapper);

  // When Chase is disabled, default-select the first available provider
  if (!chaseActive) {
    const firstRadio = optionsWrapper.querySelector('input[type="radio"]');
    if (firstRadio) {
      firstRadio.checked = true;
      firstRadio.closest('.payment-option-card')?.classList.add('payment-option-active');
      const firstProvider = activeProviders.find((p) => p.id !== cardProviderId);
      const billingSection = container.closest('form')?.querySelector('.billing-section');
      if (billingSection && firstProvider) {
        billingSection.hidden = firstProvider.hidesBilling ?? false;
      }
    }
  }

  // Wire radio changes
  container.addEventListener('change', (e) => {
    if (e.target.name !== 'paymentMethod') return;
    const selectedId = e.target.value;

    optionsWrapper.querySelectorAll('.payment-option-card').forEach((opt) => {
      const optRadio = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('payment-option-active', optRadio?.value === selectedId);
    });

    // Hide billing for providers that collect it themselves
    const selectedProvider = activeProviders.find((p) => p.id === selectedId);
    const billingSection = container.closest('form')?.querySelector('.billing-section');
    if (billingSection) {
      billingSection.hidden = selectedProvider?.hidesBilling ?? false;
    }
  });
}

/**
 * @param {HTMLFieldSetElement} container
 * @param {Array<Object>} providers
 * @param {Object} callbacks
 * @param {Object} config
 * @param {Object} strings
 */
export async function initPayment(container, providers, callbacks, config, strings, cartTotal) {
  const active = getActiveProviders(providers);

  await Promise.all(
    active.map(async (provider) => {
      try {
        await provider.load(config);
      } catch { /* provider failed to load — will be filtered by isAvailable() */ }
    }),
  );

  const available = active.filter((p) => {
    try { return p.isAvailable(cartTotal, config); } catch { return false; }
  });

  renderPaymentSection(container, available, callbacks, strings, config);

  // Render express buttons on the cart page (order-summary block)
  const expressContainer = document.querySelector('.express-checkout-buttons');
  if (expressContainer) {
    available.filter((p) => p.supportsExpress).forEach((p) => {
      p.renderExpressButton(expressContainer, callbacks);
    });
    const expressSection = expressContainer.closest('.express-checkout-section');
    if (expressSection) {
      expressSection.hidden = !available.some((p) => p.supportsExpress);
    }
  }
}
