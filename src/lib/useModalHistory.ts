/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

// Declare global types for custom modal registration
declare global {
  interface Window {
    __activeModals?: { id: string; onClose: () => void; pushed: boolean }[];
    __popstateListenerAdded?: boolean;
    __ignoreNextPops?: number;
  }
}

// Set up the global back button interceptor once on load
if (typeof window !== 'undefined' && !window.__popstateListenerAdded) {
  window.__activeModals = window.__activeModals || [];

  window.addEventListener('popstate', () => {
    // If we programmatically called history.back() due to UI state change, ignore this popstate event
    if (window.__ignoreNextPops && window.__ignoreNextPops > 0) {
      window.__ignoreNextPops--;
      return;
    }

    const modals = window.__activeModals || [];
    if (modals.length > 0) {
      // Pop the youngest active close handler and run it
      const youngest = modals.pop();
      if (youngest) {
        youngest.pushed = false; // History entry was popped by physical back button
        youngest.onClose();
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

    // Push a new history state for this modal/view
    window.history.pushState({ modalId }, '');

    const record = {
      id: modalId,
      pushed: true,
      onClose: () => {
        onCloseRef.current();
      }
    };

    window.__activeModals = window.__activeModals || [];
    window.__activeModals.push(record);

    return () => {
      // Remove from active modals list
      if (window.__activeModals) {
        window.__activeModals = window.__activeModals.filter(r => r !== record);
      }

      // If the browser history entry was pushed and has NOT been popped by physical back button yet,
      // pop it programmatically so browser history stays 100% in sync with React state
      if (record.pushed) {
        record.pushed = false;
        window.__ignoreNextPops = (window.__ignoreNextPops || 0) + 1;
        window.history.back();
      }
    };
  }, [isOpen, modalId]);

  // Handle standard manual close/cancel/backdrop click (triggers callback)
  const dismiss = () => {
    if (isOpen) {
      onClose();
    }
  };

  // For success saves, confirmations, and submissions where parent state handles closure
  const dismissWithoutCallback = () => {
    // Parent state change handles closure, cleanup hook auto-pops history
  };

  return { dismiss, dismissWithoutCallback };
}
