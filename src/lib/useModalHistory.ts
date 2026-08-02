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
  }
}

// Ensures base app root history state is present
function initRootHistory() {
  if (typeof window === 'undefined') return;
  if (!window.history.state || !window.history.state.__appRoot) {
    window.history.replaceState({ __appRoot: true }, '');
  }
}

// Initialize popstate listener ONCE globally
if (typeof window !== 'undefined' && !window.__popstateListenerAdded) {
  window.__activeModalStack = window.__activeModalStack || [];
  initRootHistory();

  window.addEventListener('popstate', () => {
    // If popstate was triggered programmatically by UI button cleanup, skip handling
    if (window.__ignoreNextPopCount && window.__ignoreNextPopCount > 0) {
      window.__ignoreNextPopCount--;
      return;
    }

    const stack = window.__activeModalStack || [];
    if (stack.length > 0) {
      // Pop the youngest modal/subview handler from top of stack
      const topRecord = stack.pop();
      if (topRecord) {
        topRecord.poppedByBrowser = true;
        topRecord.onClose();
      }
    }
  });

  window.__popstateListenerAdded = true;
}

/**
 * A hook to automatically integrate standard modal elements and subviews with the device's physical
 * back button (using HTML5 History API popstate).
 * 
 * @param isOpen Whether the modal or subview is currently active/open.
 * @param onClose Callback function to execute when back button is pressed.
 * @param modalId Unique identifier for this modal or subview.
 * @returns An object containing `dismiss` and `dismissWithoutCallback` functions.
 */
export function useModalHistory(isOpen: boolean, onClose: () => void, modalId: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    initRootHistory();

    // Push a new history state for this modal/subview
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
      // Remove record from active stack
      if (window.__activeModalStack) {
        window.__activeModalStack = window.__activeModalStack.filter(r => r !== record);
      }

      // If closed programmatically in React UI (not via physical back button popstate),
      // pop the history entry we pushed when opening so history stays cleanly in sync
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
    // Component unmount cleanup handles history pop cleanly
  };

  return { dismiss, dismissWithoutCallback };
}
