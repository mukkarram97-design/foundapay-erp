const nodemailer = require('nodemailer');
const { pool } = require('../db');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.MAIL_USER) return null; // console-only mode
  _transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
  return _transporter;
}

function brand(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden;">
    <div style="padding:24px 32px;border-bottom:1px solid #27272a;background:#0a0a0a;">
      <span style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;padding:6px 12px;border-radius:8px;font-size:14px;letter-spacing:.5px;">FP</span>
      <span style="margin-left:10px;color:#fafafa;font-size:18px;font-weight:600;">FoundaPay ERP</span>
    </div>
    <div style="padding:32px;color:#e4e4e7;font-size:15px;line-height:1.6;">
      ${content}
    </div>
    <div style="padding:18px 32px;background:#0a0a0a;border-top:1px solid #27272a;color:#71717a;font-size:12px;">
      FoundaPay &nbsp;|&nbsp; portal.foundapay.com &nbsp;|&nbsp; <a href="${process.env.PORTAL_URL || '#'}" style="color:#71717a;">Portal</a>
    </div>
  </div>
</body></html>`;
}

async function logEmail({ recipient_email, recipient_name, subject, template, status, error_message }) {
  try {
    await pool.query(
      `INSERT INTO email_logs (recipient_email, recipient_name, subject, template, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [recipient_email, recipient_name || null, subject, template, status, error_message || null]
    );
  } catch (e) {
    console.warn('[email] failed to log:', e.message);
  }
}

async function send({ to, name, subject, html, template }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[email:console-mode] MAIL_USER not configured');
    console.log('  to:', to);
    console.log('  subject:', subject);
    console.log('  template:', template);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await logEmail({ recipient_email: to, recipient_name: name, subject, template, status: 'console' });
    return { mode: 'console' };
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || 'FoundaPay <noreply@foundapay.com>',
      to,
      subject,
      html,
    });
    await logEmail({ recipient_email: to, recipient_name: name, subject, template, status: 'sent' });
    return { mode: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.error('[email] send failed:', err.message);
    await logEmail({ recipient_email: to, recipient_name: name, subject, template, status: 'failed', error_message: err.message });
    return { mode: 'failed', error: err.message };
  }
}

// ── 1. PASSWORD RESET ────────────────────────────────────────
async function sendPasswordReset(email, name, resetToken) {
  const link = `${process.env.PORTAL_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
  const html = brand(`
    <h2 style="color:#fafafa;margin-top:0;">Reset your password</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your FoundaPay portal password. Click the button below to choose a new one. This link expires in <strong>1 hour</strong>.</p>
    <p style="margin:32px 0;">
      <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
    </p>
    <p style="color:#a1a1aa;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
    <p style="color:#71717a;font-size:12px;word-break:break-all;">${link}</p>
  `);
  return send({ to: email, name, subject: 'Reset Your FoundaPay Portal Password', html, template: 'password_reset' });
}

// ── 2. WELCOME ───────────────────────────────────────────────
async function sendWelcome(email, name, tempPassword) {
  const link = process.env.PORTAL_URL || 'http://localhost:5173';
  const html = brand(`
    <h2 style="color:#fafafa;margin-top:0;">Welcome to FoundaPay</h2>
    <p>Hi ${name},</p>
    <p>An account has been created for you on the FoundaPay Partner Portal.</p>
    <div style="background:#0a0a0a;border:1px solid #27272a;border-radius:8px;padding:16px;margin:20px 0;">
      <div style="color:#a1a1aa;font-size:12px;">EMAIL</div>
      <div style="color:#fafafa;font-family:monospace;">${email}</div>
      <div style="color:#a1a1aa;font-size:12px;margin-top:12px;">TEMPORARY PASSWORD</div>
      <div style="color:#fafafa;font-family:monospace;">${tempPassword}</div>
    </div>
    <p>Please log in and change your password right away.</p>
    <p style="margin:32px 0;">
      <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open Portal</a>
    </p>
  `);
  return send({ to: email, name, subject: 'Welcome to FoundaPay Partner Portal', html, template: 'welcome' });
}

// ── 3. PAYMENT LINK ──────────────────────────────────────────
async function sendPaymentLinkToClient(clientEmail, clientName, paymentLink, amount, description) {
  const html = brand(`
    <h2 style="color:#fafafa;margin-top:0;">Payment Link Ready</h2>
    <p>Hi ${clientName},</p>
    <p>A payment link has been generated for the following:</p>
    <div style="background:#0a0a0a;border:1px solid #27272a;border-radius:8px;padding:16px;margin:20px 0;">
      <div style="color:#a1a1aa;font-size:12px;">AMOUNT</div>
      <div style="color:#10b981;font-size:24px;font-weight:700;">$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      ${description ? `<div style="color:#a1a1aa;font-size:12px;margin-top:12px;">DESCRIPTION</div><div style="color:#fafafa;">${description}</div>` : ''}
    </div>
    <p style="margin:32px 0;">
      <a href="${paymentLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Payment Link</a>
    </p>
  `);
  return send({ to: clientEmail, name: clientName, subject: 'Payment Link Ready — FoundaPay', html, template: 'payment_link' });
}

// ── 4. PAYOUT CONFIRMATION ───────────────────────────────────
async function sendPayoutConfirmation(clientEmail, clientName, amount, method, reference) {
  const html = brand(`
    <h2 style="color:#fafafa;margin-top:0;">Payout Sent</h2>
    <p>Hi ${clientName},</p>
    <p>Your payout has been sent. Details:</p>
    <div style="background:#0a0a0a;border:1px solid #27272a;border-radius:8px;padding:16px;margin:20px 0;">
      <div style="color:#a1a1aa;font-size:12px;">AMOUNT</div>
      <div style="color:#10b981;font-size:22px;font-weight:700;">$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      <div style="color:#a1a1aa;font-size:12px;margin-top:12px;">METHOD</div>
      <div style="color:#fafafa;">${method}</div>
      <div style="color:#a1a1aa;font-size:12px;margin-top:12px;">REFERENCE</div>
      <div style="color:#fafafa;font-family:monospace;">${reference}</div>
    </div>
    <p style="color:#a1a1aa;font-size:13px;">Funds typically arrive in 1–3 business days.</p>
  `);
  return send({ to: clientEmail, name: clientName, subject: 'Payout Sent — FoundaPay', html, template: 'payout_confirmation' });
}

// ── 5. STATEMENT READY ───────────────────────────────────────
async function sendStatementReady(clientEmail, clientName, period, downloadUrl) {
  const html = brand(`
    <h2 style="color:#fafafa;margin-top:0;">Your Statement is Ready</h2>
    <p>Hi ${clientName},</p>
    <p>Your statement for <strong>${period}</strong> is now available.</p>
    <p style="margin:32px 0;">
      <a href="${downloadUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Download Statement</a>
    </p>
  `);
  return send({ to: clientEmail, name: clientName, subject: `Your ${period} Statement is Ready — FoundaPay`, html, template: 'statement_ready' });
}

// ── 6. CHARGEBACK ALERT ──────────────────────────────────────
async function sendChargebackAlert(adminEmail, clientName, amount, deadline) {
  const days = Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24));
  const html = brand(`
    <h2 style="color:#ef4444;margin-top:0;">⚠ Chargeback Alert — Evidence Required</h2>
    <p>A new chargeback requires your attention:</p>
    <div style="background:#0a0a0a;border:1px solid #ef4444;border-radius:8px;padding:16px;margin:20px 0;">
      <div style="color:#a1a1aa;font-size:12px;">CLIENT</div>
      <div style="color:#fafafa;">${clientName}</div>
      <div style="color:#a1a1aa;font-size:12px;margin-top:12px;">AMOUNT</div>
      <div style="color:#ef4444;font-size:22px;font-weight:700;">$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      <div style="color:#a1a1aa;font-size:12px;margin-top:12px;">EVIDENCE DEADLINE</div>
      <div style="color:#f59e0b;font-weight:600;">${deadline} &nbsp;(${days} days remaining)</div>
    </div>
    <p>Log in to upload supporting evidence as soon as possible.</p>
  `);
  return send({ to: adminEmail, name: 'Admin', subject: '⚠ Chargeback Alert — Evidence Required', html, template: 'chargeback_alert' });
}

module.exports = {
  sendPasswordReset,
  sendWelcome,
  sendPaymentLinkToClient,
  sendPayoutConfirmation,
  sendStatementReady,
  sendChargebackAlert,
};
