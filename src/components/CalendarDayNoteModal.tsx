import React, { useEffect, useRef, useState } from 'react';
import { Pill, Plane, StickyNote, Trash2, X } from 'lucide-react';
import { CalendarDayNote, CalendarNoteType } from '../types';
import { parseLocalDate } from '../lib/dateUtils';
import { useModalHistory } from '../lib/useModalHistory';
import { ConfirmationModal } from './ConfirmationModal';

interface Props {
  visible: boolean;
  date: string;
  note: CalendarDayNote | null;
  onSave: (type: CalendarNoteType, text: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export const NOTE_TYPE_DETAILS = {
  general: { label: 'General', Icon: StickyNote },
  sick: { label: 'Sick', Icon: Pill },
  travel: { label: 'Travel', Icon: Plane },
} as const;

export function CalendarDayNoteModal({ visible, date, note, onSave, onDelete, onClose }: Props) {
  const [type, setType] = useState<CalendarNoteType>('general');
  const [text, setText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { dismiss, dismissWithoutCallback } = useModalHistory(visible, onClose, 'calendar-day-note-modal');

  useEffect(() => {
    if (!visible) return;
    setType(note?.type || 'general'); setText(note?.text || ''); setConfirmDelete(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [visible, date, note]);
  useEffect(() => {
    if (!visible) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [visible, dismiss]);
  if (!visible) return null;

  const save = () => {
    if (!text.trim()) return;
    dismissWithoutCallback(); onSave(type, text.trim());
  };
  const formattedDate = parseLocalDate(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return <>
    <div role="dialog" aria-modal="true" aria-labelledby="calendar-note-title" className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={e => e.target === e.currentTarget && dismiss()}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-md shadow-2xl">
        <header className="p-4 border-b border-slate-800 flex justify-between gap-3">
          <div><h2 id="calendar-note-title" className="font-black text-white uppercase text-sm">{note ? 'Edit' : 'Add'} Calendar Day Note</h2><p className="text-xs text-slate-400 mt-1">{formattedDate}</p></div>
          <button aria-label="Close note editor" onClick={dismiss} className="text-slate-400 hover:text-white"><X /></button>
        </header>
        <div className="p-4 space-y-4">
          <fieldset><legend className="text-xs font-bold text-slate-300 mb-2">Note type</legend><div className="grid grid-cols-3 gap-2">
            {(Object.keys(NOTE_TYPE_DETAILS) as CalendarNoteType[]).map(key => { const { label, Icon } = NOTE_TYPE_DETAILS[key]; return <button type="button" key={key} aria-pressed={type === key} onClick={() => setType(key)} className={`py-3 border flex flex-col items-center gap-1 text-xs font-bold ${type === key ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-950 border-slate-700 text-slate-300'}`}><Icon className="w-4 h-4" />{label}</button>; })}
          </div></fieldset>
          <div><label htmlFor="calendar-note-text" className="text-xs font-bold text-slate-300">Note</label><textarea ref={textareaRef} id="calendar-note-text" maxLength={300} rows={5} value={text} onChange={e => setText(e.target.value)} className="mt-2 w-full bg-slate-950 border border-slate-700 p-3 text-sm text-white focus:border-indigo-400 outline-none resize-y" /><p className="text-right text-[11px] text-slate-400" aria-live="polite">{text.length}/300</p></div>
        </div>
        <footer className="p-4 border-t border-slate-800 flex items-center gap-2">
          {note && <button onClick={() => setConfirmDelete(true)} className="mr-auto text-rose-400 border border-rose-500/40 px-3 py-2 text-xs font-bold flex gap-1"><Trash2 className="w-4 h-4" /> Delete Note</button>}
          <button onClick={dismiss} className="border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">Cancel</button>
          <button disabled={!text.trim()} onClick={save} className="bg-indigo-600 disabled:opacity-40 px-4 py-2 text-xs font-bold text-white">Save</button>
        </footer>
      </div>
    </div>
    <ConfirmationModal visible={confirmDelete} disableHistory title="Delete Note?" message="This calendar day note will be permanently deleted." confirmLabel="Delete Note" confirmVariant="danger" onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); dismissWithoutCallback(); onDelete(); }} />
  </>;
}
