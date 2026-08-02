/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

export interface ModalRecord {
  id: string;
  onClose: () => void;
  isPhysicalPop?: boolean;
}

declare global {
  interface Window {
    __modalHistoryStack?: ModalRecord[];
    __popstateHandlerAdded?: boolean;
    __isProgrammaticPop?: boolean;
    __onHomeExitRequested?: () => void;
    __getCurrentView?: () => string;
  }
}

// Ensures the base home guard history state is present
export function ensureHomeGuard() {
  if (typeof window === 'undefined') return;
  if (!window.history.state || window.history.state.__appRoot !== true) {
    window.history.replaceState({ __appRoot: true }, '');
    window.history.pushState({ __homeGuard: true }, '');
  }
}

// Initialize popstate listener ONCE globally
if (typeof window !== 'undefined' && !window.__popstateHandlerAdded) {
  window.__modalHistoryStack = window.__modalHistoryStack || [];
  ensureHomeGuard();

  window.addEventListener('popstate', () => {
    // If popstate was triggered programmatically by UI cleanup, ignore it
    if (window.__isProgrammaticPop) {
      window.__isProgrammaticPop = false;
      return;
    }

    const stack = window.__modalHistoryStack || [];

    if (stack.length > 0) {
      // Pop the top modal or subview handler from the stack
      const topRecord = stack.pop();
      if (topRecord) {
        topRecord.isPhysicalPop = true;
        topRecord.onClose();
      }
    } else {
      // Stack is empty! We are at the root/home screen.
      const currentView = window.__getCurrentView ? window.__getCurrentView() : 'home';
      if (currentView === 'home') {
        // Re-push home guard state so pressing back again doesn't exit app if user cancels
        window.history.pushState({ __homeGuard: true }, '');
        if (window.__onHomeExitRequested) {
          window.__onHomeExitRequested();
        }
      }
    }
  });

  window.__popstateHandlerAdded = true;
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

    ensureHomeGuard();

    // Push history state for this modal/subview
    window.history.pushState({ modalId }, '');

    const record: ModalRecord = {
      id: modalId,
      isPhysicalPop: false,
      onClose: () => {
        onCloseRef.current();
      }
    };

    window.__modalHistoryStack = window.__modalHistoryStack || [];
    window.__modalHistoryStack.push(record);

    return () => {
      // Remove record from stack
      if (window.__modalHistoryStack) {
        window.__modalHistoryStack = window.__modalHistoryStack.filter(r => r !== record);
      }

      // If closed programmatically in React UI (not via physical back button popstate),
      // pop the history entry we pushed when opening so history stays cleanly in sync
      if (!record.isPhysicalPop) {
        window.__isProgrammaticPop = true;
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
    // Unmount cleanup handles history pop cleanly
  };

  return { dismiss, dismissWithoutCallback };
}
