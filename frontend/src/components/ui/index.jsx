import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// ━━━ Primitives ─────────────────────────────────────────────

export const Card = ({ className = '', children, ...rest }) => (
  <div className={`fp-card ${className}`} {...rest}>{children}</div>
);

export const Button = React.forwardRef(({ variant = 'primary', size = 'md', className = '', children, ...rest }, ref) => {
  const variantClass = {
    primary: 'fp-btn-primary',
    secondary: 'fp-btn-secondary',
    ghost: 'fp-btn-ghost',
    danger: 'fp-btn-danger',
    success: 'fp-btn-success',
  }[variant] || 'fp-btn-primary';
  const sizeClass = {
    sm: 'h-7 px-2.5 !text-xs',
    md: '',
    lg: 'h-11 px-5 !text-sm',
    xl: 'h-12 px-6 !text-base',
  }[size] || '';
  return <button ref={ref} className={`fp-btn ${variantClass} ${sizeClass} ${className}`} {...rest}>{children}</button>;
});
Button.displayName = 'Button';

export const Input = React.forwardRef(({ className = '', ...rest }, ref) => (
  <input ref={ref} className={`fp-input ${className}`} {...rest} />
));
Input.displayName = 'Input';

export const Select = React.forwardRef(({ className = '', children, ...rest }, ref) => (
  <select ref={ref} className={`fp-input cursor-pointer ${className}`} {...rest}>{children}</select>
));
Select.displayName = 'Select';

export const Textarea = React.forwardRef(({ className = '', ...rest }, ref) => (
  <textarea ref={ref} className={`fp-input resize-none ${className}`} {...rest} />
));
Textarea.displayName = 'Textarea';

export const Label = ({ children, className = '' }) => (
  <label
    className={`block text-[10px] font-semibold uppercase tracking-widest mb-1.5 ${className}`}
    style={{ color: 'var(--text-secondary)' }}
  >{children}</label>
);

export const Badge = ({ tone = 'neutral', children, className = '' }) => {
  const cls = {
    success: 'fp-badge-success',
    warning: 'fp-badge-warning',
    danger:  'fp-badge-danger',
    info:    'fp-badge-info',
    accent:  'fp-badge-accent',
    neutral: 'fp-badge-neutral',
    // Friendly aliases
    green:   'fp-badge-success',
    amber:   'fp-badge-warning',
    red:     'fp-badge-danger',
    blue:    'fp-badge-info',
    violet:  'fp-badge-accent',
    zinc:    'fp-badge-neutral',
  }[tone] || 'fp-badge-neutral';
  return <span className={`fp-badge ${cls} ${className}`}>{children}</span>;
};

export const Alert = ({ tone = 'info', icon, children, className = '' }) => {
  const cls = {
    info:    'fp-badge-info',
    success: 'fp-badge-success',
    warning: 'fp-badge-warning',
    error:   'fp-badge-danger',
  }[tone] || 'fp-badge-info';
  return (
    <div
      className={`flex items-start gap-2 px-4 py-3 border rounded-xl text-sm ${cls} ${className}`}
      style={{ borderRadius: '12px' }}
    >
      {icon && <span className="mt-0.5">{icon}</span>}
      <div className="flex-1">{children}</div>
    </div>
  );
};

export const Spinner = ({ size = 16, className = '' }) => (
  <span
    className={`fp-spin inline-block rounded-full border-2 border-current border-t-transparent ${className}`}
    style={{ width: size, height: size }}
  />
);

export const Logo = ({ size = 32, className = '' }) => (
  <img src="/logo.svg" alt="FoundaPay" style={{ height: size }} className={className} />
);

export const LogoMark = ({ size = 32, className = '' }) => (
  <img src="/logo-mark.svg" alt="FoundaPay" style={{ height: size, width: size }} className={className} />
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="flex items-end justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h1>
      {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

// ━━━ Modal ──────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onEsc); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 fp-fade-in" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fp-card fp-slide-up w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
      >
        {title && (
          <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
            <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={18} /></button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && (
          <div className="px-5 py-3 flex justify-end gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ━━━ Tables ─────────────────────────────────────────────────

export const Table = ({ children, className = '' }) => (
  <div className={`overflow-x-auto ${className}`}>
    <table className="fp-table">{children}</table>
  </div>
);
export const Thead = ({ children }) => <thead>{children}</thead>;
export const Th    = ({ children, className = '' }) => <th className={className}>{children}</th>;
export const Tr    = ({ children, className = '', clickable, ...rest }) => (
  <tr className={`${clickable ? 'clickable' : ''} ${className}`} {...rest}>{children}</tr>
);
export const Td    = ({ children, className = '' }) => <td className={className}>{children}</td>;

// ━━━ Format helpers ─────────────────────────────────────────

export const money = (n, currency = 'USD') => {
  const v = parseFloat(n);
  if (isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
};
export const pct = (n) => {
  const v = parseFloat(n);
  if (isNaN(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
};
export const dateOnly = (d) => {
  if (!d) return '—';
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
};
export const relativeTime = (d) => {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(d).toLocaleDateString();
};
