import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, AlertCircle,
  Activity, Percent, Building2, Moon, Sun,
  Shield, FileText, ArrowRight, Copy, Check, Clock,
} from 'lucide-react';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';

export default function Login() {
  const [email, setEmail] = useState('admin@foundapay.com');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);

  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await login(email, password);
      const dest = user.role === 'client_user'
        ? '/client-portal'
        : (location.state?.from?.pathname || '/dashboard');
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  function copy(key, value) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-primary)' }}>
      {/* ━━━━━━━━━━ LEFT PANEL (55%) — purple gradient hero ━━━━━━━━━━ */}
      <div
        className="hidden lg:flex flex-col p-12 relative overflow-hidden"
        style={{
          width: '55%',
          background: 'linear-gradient(145deg, #1A0533 0%, #2D0A6B 35%, #4C1D95 65%, #6D28D9 100%)',
          color: '#FFFFFF',
        }}
      >
        {/* Decorative blurred orbs */}
        <div style={{
          position: 'absolute', top: -80, right: -80,
          width: 350, height: 350, borderRadius: '50%',
          background: 'rgba(139,92,246,0.25)', filter: 'blur(60px)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 40, left: -60,
          width: 280, height: 280, borderRadius: '50%',
          background: 'rgba(124,58,237,0.20)', filter: 'blur(80px)', pointerEvents: 'none',
        }} />
        {/* Subtle grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          pointerEvents: 'none',
        }} />

        {/* TOP — branded pill */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 999,
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
            }}>
              <Clock size={12} color="#FFFFFF" />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: 0.2 }}>FoundaPay</span>
          </div>
          <p style={{ fontSize: 13, marginTop: 8, opacity: 0.7, letterSpacing: '0.05em' }}>
            Master Operations Portal
          </p>
        </div>

        {/* CENTER — hero */}
        <div style={{ position: 'relative', zIndex: 1, marginTop: 'auto', marginBottom: 'auto', maxWidth: 520 }}>
          <h1 style={{
            fontSize: 40, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em',
            marginBottom: 16,
          }}>
            Empower Your<br />Operations
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.7, maxWidth: 380 }}>
            Real-time settlement, automated commission tracking, and multi-entity management — built for FoundaPay's global operations.
          </p>

          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Feature icon={Activity} title="Real-time Transaction Tracking" sub="348 transactions · $285,497 processed this period" />
            <Feature icon={Percent}  title="Automated Commission Calculation" sub="42 active clients · method-specific rates auto-applied" />
            <Feature icon={Building2} title="Multi-entity Settlement Engine" sub="32 US companies · 67 merchant accounts · smart routing" />
          </div>
        </div>

        {/* BOTTOM — copyright */}
        <div style={{ position: 'relative', zIndex: 1, fontSize: 12, opacity: 0.4 }}>
          © 2026 FoundaPay — portal.foundapay.com
        </div>
      </div>

      {/* ━━━━━━━━━━ RIGHT PANEL (45%) — form ━━━━━━━━━━ */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 relative">
        {/* Theme toggle, top-right */}
        <button
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            position: 'absolute', top: 20, right: 20,
            width: 36, height: 36, borderRadius: 8,
            border: 'none', cursor: 'pointer',
            background: 'transparent', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 150ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Mobile logo (visible only when left panel is hidden) */}
        <div className="lg:hidden mb-8 flex items-center gap-2">
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #7C3AED, #5B21B6)',
          }}>
            <Clock size={16} color="white" />
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>FoundaPay</span>
        </div>

        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* Header */}
          <h2 style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}>Welcome back</h2>
          <p style={{ fontSize: 14, marginTop: 6, color: 'var(--text-secondary)' }}>
            Sign in to your FoundaPay account
          </p>

          {/* Form */}
          <form onSubmit={onSubmit} style={{ marginTop: 32 }}>
            {/* Email */}
            <FieldLabel>Email address</FieldLabel>
            <div style={{ position: 'relative' }}>
              <Mail
                size={16}
                style={{
                  position: 'absolute', left: 14, top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@foundapay.com"
                required
                style={inputStyle()}
                onFocus={(e) => focusStyle(e.currentTarget, true)}
                onBlur={(e) => focusStyle(e.currentTarget, false)}
              />
            </div>

            {/* Password */}
            <div style={{ marginTop: 16 }} />
            <FieldLabel>Password</FieldLabel>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute', left: 14, top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ ...inputStyle(), paddingRight: 48 }}
                onFocus={(e) => focusStyle(e.currentTarget, true)}
                onBlur={(e) => focusStyle(e.currentTarget, false)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
                style={{
                  position: 'absolute', right: 14, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  padding: 0, display: 'inline-flex',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Forgot password */}
            <div style={{ marginTop: 10, textAlign: 'right' }}>
              <Link
                to="/forgot-password"
                style={{ color: '#7C3AED', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#6D28D9'; e.currentTarget.style.textDecoration = 'underline'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#7C3AED'; e.currentTarget.style.textDecoration = 'none'; }}
              >
                Forgot password?
              </Link>
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 24,
                width: '100%', height: 48,
                background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                border: 'none', borderRadius: 12,
                color: '#FFFFFF',
                fontSize: 15, fontWeight: 600, letterSpacing: '0.01em',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'transform 200ms, box-shadow 200ms, opacity 200ms',
                opacity: loading ? 0.85 : 1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={(e) => {
                if (loading) return;
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(124,58,237,0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {loading ? (
                <>
                  <span className="fp-spin" style={{
                    width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#FFFFFF', borderRadius: '50%',
                  }} />
                  Signing in…
                </>
              ) : (
                <>Sign in <ArrowRight size={16} /></>
              )}
            </button>

            {/* Error banner */}
            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 16,
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.30)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}
              >
                <AlertCircle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.4 }}>{error}</span>
              </div>
            )}
          </form>

          {/* Divider */}
          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>or</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Contact admin */}
          <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>New to FoundaPay?</span>{' '}
            <span style={{ color: '#7C3AED', fontWeight: 500 }}>Contact your administrator</span>
          </p>

          {/* Trust badges */}
          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Trust icon={Lock}      label="JWT Secured" />
            <Trust icon={Shield}    label="Role-based Access" />
            <Trust icon={FileText}  label="Audit Logged" />
          </div>

          {/* Dev creds */}
          {import.meta.env.DEV && (
            <div
              style={{
                marginTop: 20,
                background: 'var(--bg-tertiary)',
                border: '0.5px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <div style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em',
                color: 'var(--text-tertiary)',
                marginBottom: 6,
              }}>Dev credentials</div>
              <DevCred
                line="admin@foundapay.com / StrongAdmin@123"
                copyVal="StrongAdmin@123"
                onCopy={() => copy('admin', 'StrongAdmin@123')}
                copied={copiedKey === 'admin'}
                strong
              />
              <DevCred
                line="finance@foundapay.com / Finance@123"
                copyVal="Finance@123"
                onCopy={() => copy('finance', 'Finance@123')}
                copied={copiedKey === 'finance'}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ━━━ Helpers ─────────────────────────────────────────────

function FieldLabel({ children }) {
  return (
    <label style={{
      display: 'block',
      fontSize: 12, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      color: 'var(--text-secondary)',
      marginBottom: 6,
    }}>{children}</label>
  );
}

function inputStyle() {
  return {
    width: '100%',
    height: 48,
    paddingLeft: 44,
    paddingRight: 16,
    background: 'var(--bg-tertiary)',
    border: '1.5px solid var(--border)',
    borderRadius: 12,
    fontSize: 14,
    color: 'var(--text-primary)',
    outline: 'none',
    transition: 'border-color 150ms, box-shadow 150ms',
  };
}

function focusStyle(el, focused) {
  if (focused) {
    el.style.borderColor = '#7C3AED';
    el.style.boxShadow = '0 0 0 4px rgba(124,58,237,0.12)';
  } else {
    el.style.borderColor = 'var(--border)';
    el.style.boxShadow = 'none';
  }
}

function Feature({ icon: Icon, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 36, height: 36, borderRadius: '50%',
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.16)',
        flexShrink: 0,
      }}>
        <Icon size={16} color="#FFFFFF" />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

function Trust({ icon: Icon, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, color: 'var(--text-tertiary)',
    }}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function DevCred({ line, copyVal, onCopy, copied, strong }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
      <code style={{
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 11,
        color: strong ? 'var(--text-secondary)' : 'var(--text-tertiary)',
        userSelect: 'all',
      }}>{line}</code>
      <button
        onClick={onCopy}
        title="Copy password"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-tertiary)', padding: 2, display: 'inline-flex',
        }}
      >
        {copied ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
