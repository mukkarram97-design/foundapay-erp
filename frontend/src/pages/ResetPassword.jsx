import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Card, Button, Input, Label, Alert, Logo } from '../components/ui';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [reason, setReason] = useState(null);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setValidating(false);
      setValid(false);
      return;
    }
    api.get(`/api/auth/validate-reset-token?token=${encodeURIComponent(token)}`)
      .then((r) => {
        setValid(r.valid);
        setMaskedEmail(r.email || '');
        setReason(r.reason || null);
      })
      .catch(() => setValid(false))
      .finally(() => setValidating(false));
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (pw !== pw2)    { setErr('Passwords do not match'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, newPassword: pw });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8"><Logo className="text-lg" /></div>

        <Card className="p-8">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Choose a new password</h1>

          {validating && <p className="text-[var(--text-tertiary)] text-sm">Validating link…</p>}

          {!validating && !valid && (
            <>
              <Alert tone="error">
                {reason === 'expired' ? 'This reset link has expired.' :
                 reason === 'used'    ? 'This reset link has already been used.' :
                 'This reset link is invalid.'}
              </Alert>
              <div className="mt-6 text-sm text-center">
                <Link to="/forgot-password" className="text-[var(--accent)] hover:opacity-80">Request a new link</Link>
              </div>
            </>
          )}

          {!validating && valid && !done && (
            <>
              <p className="text-sm text-[var(--text-secondary)] mb-6">Resetting password for <span className="text-[var(--text-primary)] font-mono">{maskedEmail}</span></p>
              {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <Label>New password</Label>
                  <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required />
                </div>
                <div>
                  <Label>Confirm new password</Label>
                  <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Resetting…' : 'Reset Password'}
                </Button>
              </form>
            </>
          )}

          {done && (
            <Alert tone="success">
              Password reset! Redirecting you to login…
            </Alert>
          )}
        </Card>
      </div>
    </div>
  );
}
