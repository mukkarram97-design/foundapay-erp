import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToast } from '../../store/toast';

const ICON = {
  success: CheckCircle2,
  danger:  AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

const COLOR = {
  success: 'var(--success)',
  danger:  'var(--danger)',
  warning: 'var(--warning)',
  info:    'var(--info)',
};

export default function Toaster() {
  const { toasts, remove } = useToast();
  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICON[t.tone] || Info;
        return (
          <div
            key={t.id}
            className="fp-card fp-slide-up flex items-start gap-3 p-3 pointer-events-auto"
            style={{ minWidth: 280, maxWidth: 400, borderLeft: `3px solid ${COLOR[t.tone] || COLOR.info}` }}
          >
            <Icon size={18} style={{ color: COLOR[t.tone] || COLOR.info, marginTop: 2 }} />
            <div className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
              {t.title && <div className="font-medium mb-0.5">{t.title}</div>}
              <div style={{ color: 'var(--text-secondary)' }}>{t.message}</div>
            </div>
            <button onClick={() => remove(t.id)} className="opacity-50 hover:opacity-100"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
