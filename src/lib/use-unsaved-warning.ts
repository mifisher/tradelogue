'use client';

import { useEffect } from 'react';

// Module-level registry of dirty form keys. A single set of listeners is
// installed while any form is dirty, so multiple dirty forms don't stack
// multiple confirm() dialogs on one navigation attempt.
const dirtyKeys = new Set<string>();
let installed = false;

const MESSAGE = 'You have unsaved journal changes. Leave without saving?';

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirtyKeys.size === 0) return;
  e.preventDefault();
  e.returnValue = ''; // required for the native prompt in most browsers
}

function onClickCapture(e: MouseEvent) {
  if (dirtyKeys.size === 0) return;
  // Ignore non-primary clicks / modified clicks (open-in-new-tab etc.)
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  const target = e.target as HTMLElement | null;
  const anchor = target?.closest?.('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  if (anchor.target === '_blank') return;
  // Only guard internal navigations
  const isExternal = /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
  if (isExternal) return;
  if (href.startsWith('#')) return;

  if (!window.confirm(MESSAGE)) {
    e.preventDefault();
    e.stopPropagation();
  } else {
    // User chose to leave — stop guarding so the navigation proceeds cleanly.
    dirtyKeys.clear();
  }
}

function install() {
  if (installed) return;
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onClickCapture, true); // capture phase
  installed = true;
}

function uninstall() {
  if (!installed || dirtyKeys.size > 0) return;
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('click', onClickCapture, true);
  installed = false;
}

/** Warn the user before navigating away while `isDirty` is true. `key` must be
 *  stable+unique per form instance (e.g. the session date or trade exec id). */
export function useUnsavedWarning(isDirty: boolean, key: string): void {
  useEffect(() => {
    if (isDirty) {
      dirtyKeys.add(key);
      install();
    } else {
      dirtyKeys.delete(key);
      uninstall();
    }
    return () => {
      dirtyKeys.delete(key);
      uninstall();
    };
  }, [isDirty, key]);
}
