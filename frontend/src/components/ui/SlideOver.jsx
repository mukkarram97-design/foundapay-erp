import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function SlideOver({ open, onClose, title, badge, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onEsc); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end fp-fade-in" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="fp-slide-in flex flex-col h-full overflow-hidden"
        style={{
          width: `${width}px`,
          maxWidth: '100vw',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            {title && <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h3>}
            {badge}
          </div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100 p-1 rounded"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-3 flex justify-end gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
