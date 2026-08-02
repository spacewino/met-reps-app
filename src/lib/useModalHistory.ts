/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

export interface ModalRecord {
  id: string;
  onClose: () => void;
  poppedByBrowser?: boolean;
}

declare global {
  interface Window {
    __activeModalStack?: ModalRecord[];
    __popstateListenerAdded?: boolean;
    __ignoreNextPopCount?: number;
    __onHomeExitRequested?: () => void;
  }
}

/**
 * Ensures the browser history has a __homeGuard state above __appRoot
 * so pressing physical BACK on the Home screen triggers popstate rather than exiting immediately.
 */
export function initHomeGuard() {
  if (typeof window === 'undefined') return;
  try {
    if (!window.history.state || !window.history.state.__appRoot) {
      window.history.replaceState({ __appRoot: true }, '');
    }
    if (!window.history.state || !window.history.state.__homeGuard) {
      window.history.pushState({ __homeGuard: true }, '');
    }
  } catch (e) {
    console.warn('History pushState failed:', e);
  }
}

// Attach user gesture listeners to ensure history state is initialized even if browser delays initial pushState
if (typeof window !== 'undefined') {
  const ensureGuard = () => {
    initHomeGuard();
  };
  window.addEventListener('pointerdown', ensureGuard, { once: true });
  window.addEventListener('touchstart', ensureGuard, { once: true });
  window.addEventListener('click', ensureGuard, { once: true });
}

// Initialize global popstate listener ONCE
if (typeof window !== 'undefined' && !window.__popstateListenerAdded) {
  window.__activeModalStack = window.__activeModalStack || [];
  initHomeGuard();

  window.addEventListener('popstate', () => {
    // If popstate was triggered programmatically by React UI button cleanup, ignore it
    if (window.__ignoreNextPopCount && window.__ignoreNextPopCount > 0) {
      window.__ignoreNextPopCount--;
      return;
    }

    const stack = window.__activeModalStack || [];
    if (stack.length > 0) {
      // Pop the topmost handler from stack (most recently opened modal / subview / dropdown)
      const topRecord = stack.pop();
      if (topRecord) {
        topRecord.poppedByBrowser = true;
        topRecord.onClose();
      }
    } else {
      // Stack is empty -> User is on Home screen and pressed physical BACK button!
      if (window.__onHomeExitRequested) {
        window.__onHomeExitRequested();
      }
    }
  });

  window.__popstateListenerAdded = true;
}

/**
 * A hook to automatically integrate standard modal elements, subviews, and expanded drop-downs
 * with the device's physical back button (using HTML5 History API popstate).
 * 
 * @param isOpen Whether the modal, subview, or dropdown is currently active/open.
 * @param onClose Callback function to execute when back button is pressed.
 * @param modalId Unique identifier for this modal, subview, or dropdown.
 * @returns An object containing `dismiss` and `dismissWithoutCallback` functions.
 */
export function useModalHistory(isOpen: boolean, onClose: () => void, modalId: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    initHomeGuard();

    // Push a history state entry for this specific modal/subview/dropdown
    window.history.pushState({ modalId }, '');

    const record: ModalRecord = {
      id: modalId,
      poppedByBrowser: false,
      onClose: () => {
        onCloseRef.current();
      }
    };

    window.__activeModalStack = window.__activeModalStack || [];
    window.__activeModalStack.push(record);

    return () => {
      // Remove record from stack
      if (window.__activeModalStack) {
        window.__activeModalStack = window.__activeModalStack.filter(r => r !== record);
      }

      // If closed programmatically in React UI (e.g. user clicked on-screen Close button),
      // pop the browser history entry we pushed when opening so history stays cleanly in sync
      if (!record.poppedByBrowser) {
        window.__ignoreNextPopCount = (window.__ignoreNextPopCount || 0) + 1;
        window.history.back();
      }
    };
  }, [isOpen, modalId]);

  const dismiss = () => {
    if (isOpen) {
      onClose();
    }
  };

  const dismissWithoutCallback = () => {
    // Unmount cleanup handles history pop
  };

  return { dismiss, dismissWithoutCallback };
}
