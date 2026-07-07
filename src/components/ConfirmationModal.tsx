/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

interface ConfirmationModalProps {
  visible: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  isProcessing?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  dismissOnBackdropPress?: boolean;
}

export function ConfirmationModal({
  visible,
  title = 'Please confirm',
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  isProcessing = false,
  onConfirm,
  onCancel,
  dismissOnBackdropPress = true,
}: ConfirmationModalProps) {
  if (!visible) return null;

  return (
    <div 
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={dismissOnBackdropPress ? onCancel : undefined}
    >
      <div 
        className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm overflow-hidden flex flex-col shadow-2xl shadow-indigo-950/40 animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Icon & Title */}
        <div className="p-5 pb-3 flex items-start gap-3.5 font-sans">
          <div className={`p-2.5 rounded-none border shrink-0 ${
            confirmVariant === 'danger'
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
          }`}>
            {confirmVariant === 'danger' ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <Check className="w-5 h-5" />
            )}
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              {title}
            </h3>
            <p className="text-[11px] text-slate-400 font-bold leading-relaxed mt-1">
              {message}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-950/40 px-4 py-3 border-t border-slate-850 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-300 hover:text-white border border-slate-850 font-black text-xs uppercase tracking-wider rounded-none transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isProcessing}
            className={`px-4 py-2.5 text-white font-black text-xs uppercase tracking-wider rounded-none transition flex items-center gap-1.5 shadow ${
              confirmVariant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-500 disabled:bg-rose-800'
                : 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800'
            }`}
          >
            {isProcessing ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;
