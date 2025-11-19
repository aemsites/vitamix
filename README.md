# Vitamix

This is a project created by the ESaaS Demo Tool. It is based on [https://github.com/adobe/aem-boilerplate](https://github.com/adobe/aem-boilerplate).

## Environments
- Preview: https://main--vitamix--aemsites.aem.page/
- Live: https://main--vitamix--aemsites.aem.live/

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Local development

1. Create a new repository based on the `aem-boilerplate` template and add a mountpoint in the `fstab.yaml`
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `{repo}` directory in your favorite IDE and start coding :)

## URL Syntax

https://{branch}--vitamix--aemsites.aem.page/

## Tests

### Overview

This project uses Playwright for end-to-end testing. The tests verify that key elements exist and function correctly across different product configurations.

### Available Test Commands

#### Basic Test Commands

```bash
# Runs all Playwright tests in headless mode with parallel execution
npm test

# Opens Playwright's interactive UI mode for debugging and test development
npm run test:ui

# Runs tests with visible browser windows (useful for debugging)
npm run test:headed

# Runs tests in debug mode with step-by-step execution
npm run test:debug

# Installs required browser binaries for Playwright
npm run test:install

# Opens the HTML test report in your browser
npm run test:report
```

### Running Tests via Command Line

> Before any tests will work you must run `npm run test:install` to install the browser dependancies

#### Run All Tests
```bash
npm install
npm run test:install
npm test
```

#### Run Specific Test File
```bash
npx playwright test tests/pdp/integration.spec.js
```

#### Run Tests with Specific Browser
```bash
# Run only on Chromium
npx playwright test --project=chromium

# Run only on Mobile Chrome
npx playwright test --project="Mobile Chrome"
```

#### Run Tests with Custom Base URL (Branch)
```bash
BASE_URL=https://main--vitamix--aemsites.aem.network npm test
```

#### Run Tests for Specific Branch
```bash
BRANCH=staging npm test
```

#### Running Tests in CI

Tests can be manually run within a PR on github by commenting `/run-tests`

### Debugging Tests in VSCode

There are two VCCode launch configurations to debug the tests. There is also an optional `Playwright Test for VS Code extension` you can install to VSCode.

#### Debug Playwright Tests
* Runs all tests in the project with debugging enabled.
* Use when debugging issues that affect multiple tests or investigating test setup problems

#### Debug Current Test File
* Runs only the currently open test file with debugging enabled.
* Use when focusing on debugging a specific test file for faster, targeted debugging
