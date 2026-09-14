/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Evaluated in each viewed frame. Native OS select popups are absent from CDP
// screencasts. Use an in-page native listbox while keeping the application's
// closed select, layout, options and form events intact.
export function installSelectMenu(): () => void {
  if (typeof HTMLElement.prototype.showPopover !== 'function')
    return () => {};
  const key = Symbol.for('playwright.dashboard.selectMenu');
  const globals = window as unknown as Record<symbol, { retain(): () => void }>;
  if (globals[key])
    return globals[key].retain();

  let references = 0;
  let closeMenu: (() => void) | undefined;
  let activeSelect: HTMLSelectElement | undefined;

  function open(select: HTMLSelectElement) {
    if (activeSelect === select)
      return;
    closeMenu?.();
    select.focus();
    const bounds = select.getBoundingClientRect();
    const computed = getComputedStyle(select);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;width:0;height:0;';
    const shadow = host.attachShadow({ mode: 'open' });
    const popup = document.createElement('div');
    popup.popover = 'auto';
    popup.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:auto;';
    const list = document.createElement('select');
    list.setAttribute('aria-label', select.getAttribute('aria-label') || select.labels?.[0]?.textContent || 'Select an option');
    list.size = Math.max(2, Math.min(12, select.options.length + select.querySelectorAll('optgroup').length));
    list.style.cssText = 'display:block;box-sizing:border-box;margin:0;border:1px solid;padding:2px;';
    list.style.font = computed.font;
    list.style.color = computed.color;
    list.style.backgroundColor = computed.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'Canvas' : computed.backgroundColor;
    list.style.colorScheme = computed.colorScheme;
    list.style.minWidth = `${Math.min(bounds.width, innerWidth)}px`;
    list.style.maxWidth = `${innerWidth}px`;
    list.style.maxHeight = `${innerHeight}px`;
    const options = Array.from(select.options);
    const copyOption = (option: HTMLOptionElement) => {
      const copy = new Option(option.label, option.value);
      copy.disabled = option.disabled;
      copy.hidden = option.hidden || getComputedStyle(option).display === 'none';
      return copy;
    };
    for (const child of select.children) {
      if (child instanceof HTMLOptionElement) {
        list.appendChild(copyOption(child));
      } else if (child instanceof HTMLOptGroupElement) {
        const group = document.createElement('optgroup');
        group.label = child.label;
        group.disabled = child.disabled;
        group.hidden = child.hidden || getComputedStyle(child).display === 'none';
        for (const option of child.querySelectorAll('option'))
          group.appendChild(copyOption(option));
        list.appendChild(group);
      }
    }
    list.selectedIndex = select.selectedIndex;
    popup.appendChild(list);
    shadow.appendChild(popup);
    document.documentElement.appendChild(host);
    activeSelect = select;
    const close = () => {
      if (activeSelect !== select)
        return;
      activeSelect = undefined;
      closeMenu = undefined;
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
      host.remove();
    };
    const onScroll = (event: Event) => {
      if (!event.composedPath().includes(host))
        close();
    };
    closeMenu = close;
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
    const commit = () => {
      const option = options[list.selectedIndex];
      if (!select.isConnected || select.matches(':disabled') || !option || option.matches(':disabled')) {
        close();
        return;
      }
      const index = Array.from(select.options).indexOf(option);
      if (index < 0) {
        close();
        return;
      }
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close();
      select.focus();
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    list.addEventListener('click', event => {
      if (event.target instanceof HTMLOptionElement && !event.target.matches(':disabled'))
        commit();
    });
    // Only committed changes on the application's select should escape.
    list.addEventListener('input', event => event.stopPropagation());
    list.addEventListener('change', event => event.stopPropagation());
    list.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowUp')) {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape')
          event.preventDefault();
        close();
        select.focus();
      }
    });
    popup.addEventListener('toggle', () => {
      if (!popup.matches(':popover-open'))
        close();
    });
    popup.showPopover();
    const menu = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(0, Math.min(bounds.left, innerWidth - menu.width))}px`;
    const below = innerHeight - bounds.bottom;
    popup.style.top = `${Math.max(0, below >= menu.height || below >= bounds.top ? Math.min(bounds.bottom, innerHeight - menu.height) : bounds.top - menu.height)}px`;
    list.focus();
    list.options[list.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function target(event: Event): HTMLSelectElement | undefined {
    const select = event.composedPath().find(node => node instanceof HTMLSelectElement) as HTMLSelectElement | undefined;
    if (!select || select.multiple || select.size > 1 || select.matches(':disabled') || !select.options.length)
      return;
    // Customizable selects already render their picker inside the page.
    if (getComputedStyle(select).appearance === 'base-select')
      return;
    return select;
  }

  const onMouse = (event: MouseEvent) => {
    const select = target(event);
    if (!select || event.button !== 0 || event.defaultPrevented)
      return;
    event.preventDefault();
    if (event.type === 'mousedown')
      select.focus();
    else
      open(select);
  };
  const onKey = (event: KeyboardEvent) => {
    const select = target(event);
    if (!select || event.defaultPrevented || ![' ', 'ArrowDown', 'ArrowUp'].includes(event.key))
      return;
    event.preventDefault();
    open(select);
  };
  document.addEventListener('mousedown', onMouse, true);
  // Covers label activation and keyboard/assistive clicks as well.
  document.addEventListener('click', onMouse, true);
  document.addEventListener('keydown', onKey, true);
  const state = {
    retain() {
      ++references;
      let released = false;
      return () => {
        if (released)
          return;
        released = true;
        if (--references)
          return;
        closeMenu?.();
        document.removeEventListener('mousedown', onMouse, true);
        document.removeEventListener('click', onMouse, true);
        document.removeEventListener('keydown', onKey, true);
        delete globals[key];
      };
    },
  };
  globals[key] = state;
  return state.retain();
}

// The stack's pinned CLI can install the same renderer without replacing its
// Playwright protocol/runtime. This is a browser-context capability: keep it
// across viewer detach, and install it in future documents and frames too.
export function selectMenuBootstrap(): string {
  const script = `(() => {
    if (!window[Symbol.for('playwright.dashboard.selectMenu')])
      (${installSelectMenu.toString()})();
  })()`;
  return `async page => {
    const context = page.context();
    const key = Symbol.for('carapa.browser.selectMenu.init');
    if (!context[key]) {
      context[key] = context.addInitScript({ content: ${JSON.stringify(script)} }).catch(error => {
        delete context[key];
        throw error;
      });
    }
    await context[key];
    await Promise.all(context.pages().flatMap(tab => tab.frames()).map(frame =>
      frame.evaluate(${JSON.stringify(script)}).catch(() => {})
    ));
    await page.evaluate(${JSON.stringify(script)});
    return { selectMenus: true };
  }`;
}
