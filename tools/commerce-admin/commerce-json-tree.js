/* eslint-disable import/prefer-default-export -- single tree editor API */
import { highlightMatch } from './search-highlight.js';

function iconButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pim-json-icon';
  button.setAttribute('aria-label', label);
  button.title = label;
  if (label === 'Remove') {
    button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
  } else {
    button.classList.add('pim-json-add');
    button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 14h8M12 10v8"/></svg>';
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
  }
  button.addEventListener('click', action);
  return button;
}

function editableText(initial, label, changed, multiline = false) {
  const element = document.createElement('span');
  element.className = 'pim-json-field';
  const display = document.createElement('button');
  display.type = 'button';
  display.className = 'pim-json-text';
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.setAttribute('aria-label', label);
  input.value = initial;
  input.hidden = true;
  if (multiline) input.rows = Math.min(6, Math.max(1, initial.split('\n').length));
  else input.type = 'text';
  const refresh = () => {
    display.textContent = input.value || '(empty)';
    display.setAttribute('aria-label', `Edit ${label.toLowerCase()}: ${input.value || '(empty)'}`);
    element.classList.toggle('pim-json-field-dirty', input.value !== initial);
  };
  const close = () => {
    input.hidden = true;
    display.hidden = false;
    refresh();
  };
  display.addEventListener('click', () => {
    display.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });
  input.addEventListener('input', () => {
    refresh();
    changed();
  });
  input.addEventListener('blur', close);
  let startValue;
  input.addEventListener('focus', () => { startValue = input.value; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      input.value = startValue;
      close();
      changed();
      display.focus();
    } else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      close();
      display.focus();
    }
  });
  element.append(display, input);
  refresh();
  return {
    element,
    read: () => input.value,
    edit: () => display.click(),
  };
}

function emptyValues(value) {
  if (Array.isArray(value)) return value.map(emptyValues);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, child]) => [key, emptyValues(child)]);
    return Object.fromEntries(entries);
  }
  return '';
}

/**
 * Existing scalar types are implied; new properties and items start as strings.
 * @returns {{ read: () => *, element: HTMLElement }}
 */
export function createJsonTree(value, onChange) {
  const refreshers = [];
  let applySearch = () => {};
  const changed = () => {
    refreshers.forEach((refresh) => refresh());
    applySearch();
    onChange();
  };

  function createNode(initialValue, label, depth = 0, arrayItem = false) {
    const element = document.createElement('div');
    element.className = 'pim-json-node';
    const row = document.createElement('div');
    row.className = 'pim-json-row';
    row.append(label);
    const dirty = document.createElement('span');
    dirty.className = 'pim-json-dirty';
    dirty.textContent = 'Modified';
    dirty.hidden = true;
    let read;
    let blank = () => '';
    let valueField;
    const container = initialValue !== null && typeof initialValue === 'object';
    if (container) {
      const array = Array.isArray(initialValue);
      const details = document.createElement('details');
      details.open = arrayItem || depth === 0;
      const summary = document.createElement('summary');
      summary.hidden = true;
      if (!arrayItem) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'pim-json-icon pim-json-toggle';
        toggle.setAttribute('aria-label', 'Expand or collapse');
        toggle.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 3 5 5-5 5"/></svg>';
        const updateToggle = () => {
          toggle.setAttribute('aria-expanded', String(details.open));
        };
        toggle.addEventListener('click', () => {
          details.open = !details.open;
          updateToggle();
        });
        details.addEventListener('toggle', updateToggle);
        updateToggle();
        row.append(toggle);
      }
      const children = document.createElement('div');
      children.className = 'pim-json-children';
      const entries = [];
      const appendEntry = (key, entryValue, added = false) => {
        const keyControl = array ? document.createElement('span')
          : editableText(key, 'Property name', changed);
        if (array) keyControl.hidden = true;
        const childLabel = array ? keyControl : keyControl.element;
        const child = createNode(entryValue, childLabel, depth + 1, array);
        child.element.dataset.property = key;
        const entry = { key: keyControl, node: child };
        child.row.append(iconButton('Remove', () => {
          entries.splice(entries.indexOf(entry), 1);
          child.element.remove();
          changed();
        }));
        if (added) {
          const badge = document.createElement('span');
          badge.className = 'pim-json-dirty';
          badge.textContent = 'Added';
          child.row.append(badge);
        }
        entries.push(entry);
        children.append(child.element);
        return { child, field: array ? child.valueField : keyControl };
      };
      Object.entries(initialValue).forEach(([key, entryValue]) => appendEntry(key, entryValue));
      const add = iconButton(array ? 'Add item' : 'Add property', () => {
        let key = 'property';
        let suffix = 1;
        const keys = array ? [] : entries.map((entry) => entry.key.read());
        while (keys.includes(key)) {
          key = `property${suffix}`;
          suffix += 1;
        }
        const template = array
          ? entries[0]?.node.blank() ?? emptyValues(initialValue[0])
          : '';
        const { child, field } = appendEntry(key, template, true);
        details.open = true;
        children.querySelectorAll('details').forEach((branch) => { branch.open = true; });
        changed();
        if (field) field.edit();
        else child.element.querySelector('.pim-json-text')?.focus();
      });
      if (!arrayItem || array) row.append(add);
      const updateAdd = () => { add.hidden = !details.open; };
      details.addEventListener('toggle', updateAdd);
      updateAdd();
      details.append(summary, children);
      element.append(row, details);
      if (array) {
        const expandChildren = () => {
          if (details.open) {
            children.querySelectorAll('details').forEach((child) => { child.open = true; });
          }
        };
        details.addEventListener('toggle', expandChildren);
        expandChildren();
      }
      read = () => {
        if (array) return entries.map((entry) => entry.node.read());
        const keys = entries.map((entry) => entry.key.read());
        if (new Set(keys).size !== keys.length) {
          throw new Error('Property names must be unique within each object.');
        }
        return Object.fromEntries(entries.map((entry) => [entry.key.read(), entry.node.read()]));
      };
      blank = () => (array
        ? entries.map((entry) => entry.node.blank())
        : Object.fromEntries(entries.map((entry) => [entry.key.read(), entry.node.blank()])));
    } else {
      const field = editableText(String(initialValue), 'Value', changed, true);
      row.append(field.element);
      element.append(row);
      read = () => {
        const text = field.read();
        if (typeof initialValue === 'number') {
          if (!text.trim() || !Number.isFinite(Number(text))) {
            throw new Error('Enter a valid, finite number for every number value.');
          }
          return Number(text);
        }
        if (typeof initialValue === 'boolean') {
          if (text !== 'true' && text !== 'false') {
            throw new Error('Enter true or false for a boolean value.');
          }
          return text === 'true';
        }
        if (initialValue === null && text === 'null') return null;
        return text;
      };
      valueField = field;
    }
    row.append(dirty);
    refreshers.push(() => {
      try {
        dirty.hidden = JSON.stringify(read()) === JSON.stringify(initialValue)
          && !label.classList.contains('pim-json-field-dirty');
      } catch {
        dirty.hidden = false;
      }
    });
    return {
      element, row, read, blank, valueField,
    };
  }

  const label = document.createElement('strong');
  label.textContent = 'Product';
  const root = createNode(value, label);
  const editor = document.createElement('div');
  editor.className = 'pim-json-tree';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'pim-json-search';
  search.setAttribute('aria-label', 'Search property names');
  search.placeholder = 'Search property names...';
  const empty = document.createElement('p');
  empty.textContent = 'No matching properties.';
  empty.setAttribute('role', 'status');
  empty.hidden = true;
  const expanded = new Map();
  applySearch = () => {
    const query = search.value.trim();
    const lowerQuery = query.toLowerCase();
    function filter(node, parentMatches = false) {
      const row = node.querySelector(':scope > .pim-json-row');
      const name = row.querySelector(':scope > .pim-json-field input');
      const display = name?.parentElement.querySelector('.pim-json-text');
      const matches = Boolean(query && name?.value.toLowerCase().includes(lowerQuery));
      if (display) display.innerHTML = highlightMatch(name.value || '(empty)', query);
      const details = node.querySelector(':scope > details');
      let descendantMatches = false;
      details?.querySelector(':scope > .pim-json-children')?.childNodes.forEach((child) => {
        if (filter(child, parentMatches || matches)) descendantMatches = true;
      });
      const visible = !query || matches || parentMatches || descendantMatches
        || node.contains(document.activeElement);
      node.hidden = !visible;
      if (details) {
        if (query) {
          if (!expanded.has(details)) expanded.set(details, details.open);
          if (visible) details.open = true;
        } else if (expanded.has(details)) {
          details.open = expanded.get(details);
          expanded.delete(details);
        }
      }
      return visible;
    }
    empty.hidden = filter(root.element);
  };
  search.addEventListener('input', applySearch);
  root.element.addEventListener('focusout', () => {
    if (search.value.trim()) queueMicrotask(applySearch);
  });
  editor.append(search, empty, root.element);
  return { element: editor, read: root.read };
}
