import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Card, Button, Input, Label, Alert, Logo } from '../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo className="text-lg" />
        </div>

        <Card className="p-8">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Reset your password</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">Enter your email and we'll send you a reset link.</p>

          {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

          {sent ? (
            <Alert tone="success">
              If this email is registered, a reset link has been sent to your inbox. The link expires in 1 hour.
            </Alert>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send Reset Link'}
              </Button>
            </form>
          )}

          <div className="mt-6 text-sm text-center">
            <Link to="/login" className="text-[var(--accent)] hover:opacity-80">
              ← Back to login
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
