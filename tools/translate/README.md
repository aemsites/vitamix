# Translation Tools

Three tools for translating and rolling out localized pages via [DA Live](https://da.live).

---

## Tools Overview

### 1. Translation Plugin (`plugin.html`)

DA Live editor panel plugin. Translates a text selection in the current document.

**How it works:**
1. Open the plugin panel inside DA Live editor.
2. Selected text from the document is pre-filled in the input area.
3. Choose a target language (French/CA or Spanish/MX).
4. Click **Translate**.
5. On mobile (width < 500px): translated content is sent directly back to the editor.
6. On desktop: review output in the second textarea, then click **Replace** to insert.

---

### 2. Translation App (`app.html`)

Standalone batch translation tool. Translates multiple pages at once.

**How it works:**
1. Open the app inside DA Live.
2. Enter a list of DA Live edit URLs or preview URLs — one per line — or click **load from folder** and enter a `da.live/#/<org>/<repo>/...` folder URL to load all pages from a folder automatically.
3. Select the target language.
4. Click **Translate**. Each page is fetched from DA Admin, translated, and saved back.
5. A per-page status list shows progress and links to the saved pages.

---

### 3. Rollout Plugin (`rollout-plugin.html`)

DA Live editor panel plugin. Rolls out the current page to all configured locales.

**How it works:**
1. Open the plugin panel while editing a page under a locale path: `/<locale>/<language>/...`  
   Example: `/us/en_us/path/to/page`
2. The plugin lists all other configured locales. Uncheck any you want to skip.
3. Choose whether to **Preview** and/or **Publish** after saving (publishing forces preview).
4. Click **Rollout**. For each selected locale:
   - If same language: URLs are adjusted for the target locale, no translation needed.
   - If different language: page is translated then URLs are adjusted.
   - Page is saved to DA, then optionally previewed and published via AEM Admin.

**Configured locales** (defined in `config.js`):

| Prefix | Translate Code | Country |
|--------|----------------|---------|
| `/us/en_us` | `en`    | United States |
| `/ca/en_us` | `en`    | Canada |
| `/ca/fr_ca` | `fr-CA` | Canada |
| `/mx/en_us` | `en`    | Mexico |
| `/mx/es_mx` | `es-MX` | Mexico |
| `/vr/en_us` | `en`    | VR |

For a simpler path structure (e.g. `/en/page`, `/fr/page`), set `LOCALES` in `config.js` to:

```js
export const LOCALES = [
  { prefix: '/en', translateCode: 'en', label: 'English' },
  { prefix: '/fr', translateCode: 'fr-CA', label: 'French' },
];
```

---

## Configuration

### `config.js`

All project-specific settings live in `config.js`. Edit this file when copying the tools to a new project.

| Export | Description |
|--------|-------------|
| `ADMIN_URL` | DA Admin API endpoint. Switch to `localhost:8787` or stage for local dev. |
| `AEM_ADMIN_URL` | AEM Admin API endpoint used for preview/publish. |
| `TRANSLATION_SERVICE_URL` | Google Translate proxy endpoint. |
| `CONFIG_PATH` | Path to the optional config spreadsheet within the repo. |
| `METADATA_FIELDS_TO_TRANSLATE` | Metadata fields translated by default (`title`, `description`). |
| `LANGUAGES` | Language options shown in the plugin/app dropdowns. First entry is the default selection. |
| `LOCALES` | Locale list for the rollout plugin. Each entry has a `prefix` (e.g. `/en` or `/us/en_us`) and a `translateCode`. Works with any path depth. |

### `/.da/translate.json` spreadsheet

Optional runtime config read from DA. Overrides and extends `config.js` defaults.

### `dnt-content-rules` sheet

Defines content fragments that must **not** be translated. Each row must have a `content` column.

| content |
|---------|
| BrandName |
| ProductName |

### `dt-metadata-fields` sheet

Defines additional metadata fields that **should** be translated. By default only `title` and `description` are translated; all other metadata field values are protected.

| metadata |
|----------|
| og:title |
| og:description |

---

## Translation Rules

The following Do-Not-Translate (DNT) rules are applied automatically before sending content to the translation service:

- **Icons**: `:icon-name:` patterns are wrapped in `translate="no"`.
- **Content DNT**: fragments listed in `dnt-content-rules` config sheet are protected.
- **Block names**: first row of every table (block header) is marked `translate="no"`.
- **Section metadata**: `section metadata` / `section-metadata` tables are fully protected.
- **Metadata fields**: all metadata property values are protected except `title`, `description`, and any additional fields listed in `dt-metadata-fields`.

---

## Plugin Registration (Production)

Plugins are registered via the site config spreadsheet in DA Live.

1. Open `https://da.live/config#/<org>/<site>/`
2. Open the **library** sheet (create it if it does not exist).
3. Add one row per plugin:

| Name | URL |
|------|-----|
| Translate | `https://main--<site>--<org>.aem.live/tools/translate/plugin.html` |
| Rollout | `https://main--<site>--<org>.aem.live/tools/translate/rollout-plugin.html` |

The Translation App (`app.html`) is a standalone tool accessed at:
`https://da.live/app/<org>/<site>/tools/translate/app`

---

## Local Development

### 1. Start local server

From the project root:

```sh
aem up
```

Tools available at `http://localhost:3000/tools/translate/`.

### 2. Switch DA Admin endpoint

In `config.js`, comment out the production URL and uncomment the desired target:

```js
// Production (default)
const ADMIN_URL = 'https://admin.da.live';

// Stage
// const ADMIN_URL = 'https://stage-admin.da.live';

// Local DA admin
// const ADMIN_URL = 'http://localhost:8787';
```

### 3. Register plugins in DA Live (local)

Same as production — open `https://da.live/config#/<org>/<site>/`, open the **library** sheet, and add localhost URLs:

| Name | URL |
|------|-----|
| Translate | `http://localhost:3000/tools/translate/plugin.html` |
| Rollout | `http://localhost:3000/tools/translate/rollout-plugin.html` |

For the Translation App, use the DA Live app URL with your localhost origin, or navigate directly to `http://localhost:3000/tools/translate/app.html`.

### 4. Authentication

All DA Admin requests use `daFetch` from the DA SDK, which handles authentication automatically. No additional setup is needed for auth when running inside a DA Live context.
