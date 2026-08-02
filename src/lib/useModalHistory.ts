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
    __ensureGuardState?: () => void;
  }
}

function ensureGuardState() {
  if (typeof window === 'undefined') return;
  const modals = window.__activeModals || [];
  if (modals.length > 0) {
    if (!window.history.state || window.history.state.appGuard !== true) {
      window.history.pushState({ appGuard: true }, '');
    }
  }
}

// Set up the global back button interceptor once on load
if (typeof window !== 'undefined' && !window.__popstateListenerAdded) {
  window.__activeModals = window.__activeModals || [];
  window.__ensureGuardState = ensureGuardState;

  window.addEventListener('popstate', () => {
    const modals = window.__activeModals || [];
    if (modals.length > 0) {
      // Pop the youngest active close handler and run it
      const youngest = modals.pop();
      if (youngest) {
        youngest.onClose();
      }
      // Re-evaluate if we need a guard state for any remaining active modals/subviews
      setTimeout(() => {
        ensureGuardState();
      }, 50);
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

    const record = {
      id: modalId,
      onClose: () => {
        onCloseRef.current();
      }
    };

    window.__activeModals = window.__activeModals || [];
    window.__activeModals.push(record);

    ensureGuardState();

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
      onClose();
    }
  };

  // For success saves, confirmations, and submissions where parent state handles closure
  const dismissWithoutCallback = () => {
    // Parent state change handles closure
  };

  return { dismiss, dismissWithoutCallback };
}
