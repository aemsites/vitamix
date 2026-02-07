/*
 * AEM Embed WebComponent
 * Include content from one Helix page in any other web surface.
 * https://www.hlx.live/developer/block-collection/TBD
 */

// eslint-disable-next-line import/prefer-default-export
export class AEMEmbed extends HTMLElement {
  constructor() {
    super();

    // Attaches a shadow DOM tree to the element
    // With mode open the shadow root elements are accessible from JavaScript outside the root
    this.attachShadow({ mode: 'open' });

    // Keep track if we have rendered the fragment yet.
    this.initialized = false;

    window.hlx = window.hlx || {};
    window.hlx.suppressLoadPage = true;
    // codeBasePath is set in connectedCallback from the embed url (embedded site root)
  }

  // eslint-disable-next-line class-methods-use-this
  async loadBlock(body, block, blockName, origin) {
    const blockCss = `${origin}${window.hlx.codeBasePath}/blocks/${blockName}/${blockName}.css`;
    if (!this.shadowRoot.querySelector(`link[href="${blockCss}"]`)) {
      const link = document.createElement('link');
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('href', blockCss);

      const cssLoaded = new Promise((resolve) => {
        link.onload = resolve;
        link.onerror = resolve;
      });

      this.shadowRoot.appendChild(link);
      // eslint-disable-next-line no-await-in-loop
      await cssLoaded;
    }

    try {
      const blockScriptUrl = `${origin}${window.hlx.codeBasePath}/blocks/${blockName}/${blockName}.js`;
      // eslint-disable-next-line no-await-in-loop
      const decorateBlock = await import(blockScriptUrl);
      if (decorateBlock.default) {
        // eslint-disable-next-line no-await-in-loop
        await decorateBlock.default(block);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('An error occured while loading the content');
    }
  }

  async handleHeader(htmlText, body, origin) {
    await this.pseudoDecorateMain(htmlText, body, origin);

    const main = body.querySelector('main');
    const header = document.createElement('header');
    body.append(header);
    const { buildBlock } = await import(`${origin}${window.hlx.codeBasePath}/scripts/aem.js`);
    const block = buildBlock('header', '');
    header.append(block);

    const cell = block.firstElementChild.firstElementChild;
    const nav = document.createElement('nav');
    cell.append(nav);
    while (main.firstElementChild) nav.append(main.firstElementChild);
    main.remove();

    await this.loadBlock(body, block, 'header', origin);

    block.dataset.blockStatus = 'loaded';

    body.style.height = 'var(--nav-height)';
    body.classList.add('appear');
    this.attachModalLinkHandler(origin);
  }

  async handleFooter(htmlText, body, origin) {
    await this.pseudoDecorateMain(htmlText, body, origin);

    const main = body.querySelector('main');
    const footer = document.createElement('footer');
    body.append(footer);
    const { buildBlock } = await import(`${origin}${window.hlx.codeBasePath}/scripts/aem.js`);
    const block = buildBlock('footer', '');
    footer.append(block);

    const cell = block.firstElementChild.firstElementChild;
    const nav = document.createElement('nav');
    cell.append(nav);
    while (main.firstElementChild) nav.append(main.firstElementChild);
    main.remove();

    await this.loadBlock(body, block, 'footer', origin);

    block.dataset.blockStatus = 'loaded';
    body.classList.add('appear');
    this.attachModalLinkHandler(origin);
  }

  async pseudoDecorateMain(htmlText, body, origin) {
    const main = document.createElement('main');
    body.append(main);
    main.innerHTML = htmlText;

    const { decorateMain } = await import(`${origin}${window.hlx.codeBasePath}/scripts/scripts.js`);
    if (decorateMain) {
      await decorateMain(main, true);
    }

    // Query all the blocks in the aem content
    // The blocks are in the first div inside the main tag
    const blockElements = main.querySelectorAll('.block');

    // Did we find any blocks or all default content?
    if (blockElements.length > 0) {
      // Get the block names
      const blocks = Array.from(blockElements).map((block) => block.classList.item(0));

      // For each block in the embed load it's js/css (sequential to avoid race)
      for (let i = 0; i < blockElements.length; i += 1) {
        const blockName = blocks[i];
        const block = blockElements[i];
        // eslint-disable-next-line no-await-in-loop
        await this.loadBlock(body, block, blockName, origin);
      }
    }

    const sections = main.querySelectorAll('.section');
    sections.forEach((s) => {
      s.dataset.sectionStatus = 'loaded';
      s.style = '';
    });
  }

  async handleMain(htmlText, body, origin) {
    await this.pseudoDecorateMain(htmlText, body, origin);
    body.classList.add('appear');
    this.attachModalLinkHandler(origin);
  }

  /**
   * Listens for clicks on /modals/ links inside the shadow root and opens the modal
   * using the embedded site's modal block (so the host page doesn't need scripts.js).
   * @param {string} origin - Embedded site origin (e.g. https://example.aem.live)
   */
  attachModalLinkHandler(origin) {
    if (this.modalHandlerAttached) return;
    this.modalHandlerAttached = true;
    const base = `${origin}${window.hlx.codeBasePath || ''}`.replace(/\/?$/, '/');
    const root = this.shadowRoot;
    this.shadowRoot.addEventListener('click', async (e) => {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const link = path.find((el) => el?.tagName === 'A' && el.href && el.href.includes('/modals/'));
      if (!link) return;
      e.preventDefault();
      try {
        const { openModal } = await import(`${base}blocks/modal/modal.js`);
        await openModal(link.href, { root });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log('Modal open failed', err);
      }
    });
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents
   * have been fully parsed.
   */
  async connectedCallback() {
    if (!this.initialized) {
      const urlAttribute = this.attributes.getNamedItem('url');
      const url = urlAttribute?.value?.trim();
      if (!url) {
        return;
      }

      try {
        const type = this.getAttribute('type') || 'main';

        const body = document.createElement('body');
        body.style = 'display: none';
        this.shadowRoot.append(body);

        const plainUrl = url.endsWith('/') ? `${url}index.plain.html` : `${url}.plain.html`;
        const { href, origin } = new URL(plainUrl);

        // Load embedded site's assets from its root
        // (works regardless of where aem-embed.js is hosted)
        window.hlx.codeBasePath = '';

        // Load fragment
        const resp = await fetch(href);
        if (!resp.ok) {
          throw new Error(`Unable to fetch ${href}`);
        }

        const styles = document.createElement('link');
        styles.setAttribute('rel', 'stylesheet');
        styles.setAttribute('href', `${origin}${window.hlx.codeBasePath}/styles/styles.css`);
        const stylesLoaded = new Promise((resolve) => {
          styles.onload = () => { body.style = ''; resolve(); };
          styles.onerror = () => { body.style = ''; resolve(); };
        });
        this.shadowRoot.appendChild(styles);

        const fontsHref = `${origin}${window.hlx.codeBasePath}/styles/fonts.css`;
        const fonts = document.createElement('link');
        fonts.setAttribute('rel', 'stylesheet');
        fonts.setAttribute('href', fontsHref);
        const fontsLoaded = new Promise((resolve) => {
          fonts.onload = resolve;
          fonts.onerror = resolve;
        });
        this.shadowRoot.appendChild(fonts);

        await Promise.all([stylesLoaded, fontsLoaded]);

        let htmlText = await resp.text();
        // Fix relative image urls
        const regex = /.\/media/g;
        htmlText = htmlText.replace(regex, `${origin}/media`);

        // Set initialized to true so we don't run through this again
        this.initialized = true;

        if (type === 'main') await this.handleMain(htmlText, body, origin);
        if (type === 'header') await this.handleHeader(htmlText, body, origin);
        if (type === 'footer') await this.handleFooter(htmlText, body, origin);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(err || 'An error occured while loading the content');
      }
    }
  }

  /**
   * Imports a script and appends to document body
   * @param {*} url
   * @returns
   */

  // eslint-disable-next-line class-methods-use-this
  async importScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.type = 'module';
      script.onload = resolve;
      script.onerror = reject;

      document.body.appendChild(script);
    });
  }
}

customElements.define('aem-embed', AEMEmbed);
