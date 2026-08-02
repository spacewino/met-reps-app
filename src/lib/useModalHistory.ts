/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

// Declare global types for custom modal registration
declare global {
  interface Window {
    __activeModals?: { id: string; onClose: () => void; pushedHistory?: boolean }[];
    __popstateListenerAdded?: boolean;
    __ignoreNextPop?: boolean;
  }
}

// Set up the global back button interceptor once on load
if (typeof window !== 'undefined' && !window.__popstateListenerAdded) {
  window.__activeModals = window.__activeModals || [];
  
  window.addEventListener('popstate', () => {
    // If we programmatically went back, ignore this popstate event
    if (window.__ignoreNextPop) {
      window.__ignoreNextPop = false;
      return;
    }

    const modals = window.__activeModals || [];
    if (modals.length > 0) {
      // Pop the youngest active close handler and run it
      const youngest = modals.pop();
      if (youngest) {
        youngest.pushedHistory = false; // Browser already popped the history entry
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
 * @modalId Unique identifier for this modal or subview.
 * @returns An object containing `dismiss` and `dismissWithoutCallback` functions.
 */
export function useModalHistory(isOpen: boolean, onClose: () => void, modalId: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Push a new mock history state so there is an entry to go "back" from
    window.history.pushState({ modalId }, '');

    const record: { id: string; onClose: () => void; pushedHistory: boolean } = {
      id: modalId,
      pushedHistory: true,
      onClose: () => {
        onCloseRef.current();
      }
    };

    window.__activeModals = window.__activeModals || [];
    window.__activeModals.push(record);

    return () => {
      // Clean up the handler if the component unmounts or state changes
      if (window.__activeModals) {
        window.__activeModals = window.__activeModals.filter(r => r !== record);
      }

      // If history entry was pushed and hasn't been popped by a physical back button press yet,
      // pop it now so history stack stays in sync with UI
      if (record.pushedHistory) {
        record.pushedHistory = false;
        window.__ignoreNextPop = true;
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

  // For success saves, confirmations, and submissions where the parent state handles closure
  const dismissWithoutCallback = () => {
    if (isOpen) {
      // Parent state change handles closure, cleanup hook auto-pops history
    }
  };

  return { dismiss, dismissWithoutCallback };
}

