/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

// Declare global types for custom modal registration
declare global {
  interface Window {
    __activeModals?: { id: string; onClose: () => void }[];
    __popstateListenerAdded?: boolean;
    __ignoreNextPop?: boolean;
  }
}

// Set up the global back button interceptor once on load
if (typeof window !== 'undefined' && !window.__popstateListenerAdded) {
  window.__activeModals = window.__activeModals || [];
  
  window.addEventListener('popstate', (event) => {
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
        youngest.onClose();
      }
    }
  });
  window.__popstateListenerAdded = true;
}

/**
 * A hook to automatically integrate standard modal elements with the device's physical
 * back button (using HTML5 History API popstate).
 * 
 * @param isOpen Whether the modal is currently open.
 * @param onClose Callback function to close the modal.
 * @param modalId Unique identifier for this modal.
 * @returns An object containing:
 *  - `dismiss`: A function to close the modal and trigger the onClose callback (used for standard cancel/close/backdrop clicks).
 *  - `dismissWithoutCallback`: A function to pop the history entry without triggering the onClose callback (used for success/confirm saves where the parent state naturally handles closure).
 */
export function useModalHistory(isOpen: boolean, onClose: () => void, modalId: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Push a new mock history state so there is an entry to go "back" from
    window.history.pushState({ modalId }, '');

    const record = {
      id: modalId,
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
    };
  }, [isOpen, modalId]);

  // Handle standard manual close/cancel/backdrop click (triggers callback)
  const dismiss = () => {
    if (isOpen) {
      window.__ignoreNextPop = true;
      window.history.back();
      onClose();
    }
  };

  // For success saves, confirmations, and submissions where the parent is already closing the modal
  const dismissWithoutCallback = () => {
    if (isOpen) {
      window.__ignoreNextPop = true;
      window.history.back();
    }
  };

  return { dismiss, dismissWithoutCallback };
}
