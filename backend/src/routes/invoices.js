// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Invoices — full CRUD, send-by-email, PDF, mark-paid, soft-delete.
//
// Endpoints (all under /api/invoices, authRequired):
//   GET    /                         list with filters/summary
//   POST   /                         create (auto-numbered INV-YYYY-NNNN)
//   GET    /:id                      detail + line items
//   PUT    /:id                      update (only when status='draft')
//   POST   /:id/send                 email + status → 'sent'
//   GET    /:id/pdf                  inline PDF
//   POST   /:id/mark-paid            manual paid (with optional tx link)
//   DELETE /:id                      soft-delete
//
// Numbering: INV-{YYYY}-{NNNN}, auto-incrementing per calendar year.
// Race-safe via UNIQUE(invoice_number) + retry-on-collision.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { buildInvoice } = require('../services/pdfReceipt');

const router = express.Router();
router.use(authRequired);

const ROLES_FULL = ['super_admin', 'owner', 'admin', 'finance_manager'];

function blockClientUser(req, res, next) {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Compute totals server-side so reports never re-derive.
function computeTotals(lineItems = [], taxRate = 0, discount = 0) {
  const subtotal = (lineItems || []).reduce((sum, li) => {
    const q = parseFloat(li.quantity) || 0;
    const p = parseFloat(li.unit_price) || 0;
    return sum + (q * p);
  }, 0);
  const disc = parseFloat(discount) || 0;
  const tr = parseFloat(taxRate) || 0;
  const taxedBase = Math.max(0, subtotal - disc);
  const taxAmount = +(taxedBase * tr).toFixed(2);
  const total = +(taxedBase + taxAmount).toFixed(2);
  return {
    subtotal: +subtotal.toFixed(2),
    tax_amount: taxAmount,
    discount_amount: +disc.toFixed(2),
    total_amount: total,
  };
}

// Generate next invoice number for a given year. Race-handled by caller.
async function nextInvoiceNumber(year) {
  const r = await pool.query(`
    SELECT invoice_number FROM invoices
     WHERE invoice_number LIKE $1
     ORDER BY invoice_number DESC
     LIMIT 1
  `, [`INV-${year}-%`]);
  if (!r.rows.length) return `INV-${year}-0001`;
  const last = r.rows[0].invoice_number;
  const seq = parseInt(last.slice(-4), 10) || 0;
  return `INV-${year}-${String(seq + 1).padStart(4, '0')}`;
}

// ━━━ GET /api/invoices ━━━
router.get('/', blockClientUser, async (req, res) => {
  try {
    const { tab = 'all', q, client_id, from, to, page = 1, limit = 20 } = req.query;
    const where = ['i.is_deleted = false'];
    const params = [];

    if (tab && tab !== 'all') {
      params.push(tab); where.push(`i.status = $${params.length}`);
    }
    if (client_id) { params.push(client_id); where.push(`i.client_id = $${params.length}`); }
    if (from)      { params.push(from);      where.push(`i.issue_date >= $${params.length}`); }
    if (to)        { params.push(to);        where.push(`i.issue_date <= $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        i.invoice_number ILIKE $${params.length} OR
        i.customer_name  ILIKE $${params.length} OR
        i.customer_email ILIKE $${params.length} OR
        i.notes          ILIKE $${params.length}
      )`);
    }

    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const off = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
    params.push(lim, off);

    const rows = await pool.query(`
      SELECT i.*,
             c.name AS client_name,
             e.legal_name AS entity_name,
             u.name AS created_by_name
        FROM invoices i
        LEFT JOIN clients c  ON c.id = i.client_id
        LEFT JOIN entities e ON e.id = i.entity_id
        LEFT JOIN users u    ON u.id = i.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Total count for pagination — uses same filters minus limit/offset
    const cntParams = params.slice(0, -2);
    const cnt = await pool.query(`
      SELECT COUNT(*)::int AS n FROM invoices i WHERE ${where.join(' AND ')}
    `, cntParams);

    // Summary across ALL non-deleted invoices (so dashboard cards aren't filtered out)
    const sum = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')::int     AS draft_count,
        COUNT(*) FILTER (WHERE status = 'sent')::int      AS sent_count,
        COUNT(*) FILTER (WHERE status = 'viewed')::int    AS viewed_count,
        COUNT(*) FILTER (WHERE status = 'paid')::int      AS paid_count,
        COUNT(*) FILTER (WHERE status = 'overdue')::int   AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
        COUNT(*)::int AS total_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0)::numeric(15,2)        AS total_paid,
        COALESCE(SUM(total_amount) FILTER (WHERE status NOT IN ('paid','cancelled','draft')), 0)::numeric(15,2) AS total_outstanding
      FROM invoices WHERE is_deleted = false
    `);

    res.json({
      results: rows.rows,
      total: cnt.rows[0].n,
      page: parseInt(page, 10) || 1,
      limit: lim,
      summary: sum.rows[0],
    });
  } catch (err) {
    console.error('[invoices list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /api/invoices ━━━
router.post('/', blockClientUser, async (req, res) => {
  if (!ROLES_FULL.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const b = req.body || {};
    if (!Array.isArray(b.line_items) || b.line_items.length === 0) {
      return res.status(400).json({ error: 'At least one line item required' });
    }
    if (!b.customer_name && !b.customer_email) {
      return res.status(400).json({ error: 'customer_name or customer_email required' });
    }

    // Normalize line items — server adds line_total
    const normalized = b.line_items.map((li) => {
      const q = parseFloat(li.quantity) || 0;
      const p = parseFloat(li.unit_price) || 0;
      return {
        description: String(li.description || '').slice(0, 500),
        quantity: q,
        unit_price: p,
        line_total: +(q * p).toFixed(2),
      };
    });

    const totals = computeTotals(normalized, b.tax_rate, b.discount_amount);

    const year = new Date().getFullYear();
    let invoiceNumber = b.invoice_number || (await nextInvoiceNumber(year));

    let r;
    let attempt = 0;
    while (true) {
      try {
        r = await pool.query(`
          INSERT INTO invoices
            (invoice_number, client_id, entity_id,
             customer_name, customer_email, customer_phone, customer_address,
             issue_date, due_date,
             line_items, subtotal, tax_rate, tax_amount, discount_amount, total_amount, currency,
             notes, footer_text, status, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,
                  COALESCE($8::date, CURRENT_DATE), $9,
                  $10::jsonb,$11,$12,$13,$14,$15,COALESCE($16,'USD'),
                  $17,$18,COALESCE($19,'draft'),$20)
          RETURNING *
        `, [
          invoiceNumber,
          b.client_id || null, b.entity_id || null,
          b.customer_name || null, b.customer_email || null,
          b.customer_phone || null, b.customer_address || null,
          b.issue_date || null, b.due_date || null,
          JSON.stringify(normalized),
          totals.subtotal, b.tax_rate || 0, totals.tax_amount,
          totals.discount_amount, totals.total_amount, b.currency,
          b.notes || null, b.footer_text || null, b.status,
          req.user.id,
        ]);
        break;
      } catch (e) {
        if (e.code === '23505' && attempt < 3) {
          attempt++;
          invoiceNumber = await nextInvoiceNumber(year);
          continue;
        }
        throw e;
      }
    }

    await logAudit({
      action: 'invoice.created',
      entityType: 'invoices', entityId: r.rows[0].id,
      userId: req.user.id,
      metadata: { invoice_number: invoiceNumber, total: totals.total_amount, customer: b.customer_email },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[invoices create]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/invoices/:id ━━━
router.get('/:id', blockClientUser, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT i.*,
             c.name AS client_name, c.logo_url AS client_logo_url,
             e.legal_name AS entity_name, e.logo_url AS entity_logo_url,
             u.name AS created_by_name
        FROM invoices i
        LEFT JOIN clients c  ON c.id = i.client_id
        LEFT JOIN entities e ON e.id = i.entity_id
        LEFT JOIN users u    ON u.id = i.created_by
       WHERE i.id = $1 AND i.is_deleted = false
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    // Pull audit timeline
    const tl = await pool.query(`
      SELECT id, action, new_value, ip_address, created_at,
             (SELECT name FROM users WHERE id = al.user_id) AS actor_name
        FROM audit_logs al
       WHERE resource = 'invoices' AND resource_id = $1
       ORDER BY created_at ASC
    `, [req.params.id]);

    res.json({ invoice: r.rows[0], timeline: tl.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ PUT /api/invoices/:id ━━━
router.put('/:id', blockClientUser, async (req, res) => {
  if (!ROLES_FULL.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const cur = await pool.query('SELECT status FROM invoices WHERE id = $1 AND is_deleted = false', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!['draft', 'sent', 'viewed'].includes(cur.rows[0].status)) {
      return res.status(409).json({ error: `Cannot edit invoice in status '${cur.rows[0].status}'` });
    }

    const b = req.body || {};
    const sets = [], params = [];

    const scalar = ['client_id', 'entity_id', 'customer_name', 'customer_email',
      'customer_phone', 'customer_address', 'issue_date', 'due_date',
      'notes', 'footer_text', 'currency', 'status',
      'payment_link_url', 'payment_link_id'];
    for (const f of scalar) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }

    // If line items / tax / discount changed, recompute totals
    if (b.line_items !== undefined || b.tax_rate !== undefined || b.discount_amount !== undefined) {
      const cur2 = await pool.query('SELECT line_items, tax_rate, discount_amount FROM invoices WHERE id = $1', [req.params.id]);
      const items = b.line_items !== undefined
        ? (b.line_items || []).map((li) => {
            const q = parseFloat(li.quantity) || 0;
            const p = parseFloat(li.unit_price) || 0;
            return {
              description: String(li.description || '').slice(0, 500),
              quantity: q, unit_price: p, line_total: +(q * p).toFixed(2),
            };
          })
        : cur2.rows[0].line_items;
      const tr = b.tax_rate !== undefined ? b.tax_rate : cur2.rows[0].tax_rate;
      const dis = b.discount_amount !== undefined ? b.discount_amount : cur2.rows[0].discount_amount;
      const totals = computeTotals(items, tr, dis);

      params.push(JSON.stringify(items)); sets.push(`line_items = $${params.length}::jsonb`);
      params.push(tr);                    sets.push(`tax_rate = $${params.length}`);
      params.push(totals.subtotal);       sets.push(`subtotal = $${params.length}`);
      params.push(totals.tax_amount);     sets.push(`tax_amount = $${params.length}`);
      params.push(totals.discount_amount);sets.push(`discount_amount = $${params.length}`);
      params.push(totals.total_amount);   sets.push(`total_amount = $${params.length}`);
    }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE invoices SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );

    await logAudit({
      action: 'invoice.updated',
      entityType: 'invoices', entityId: req.params.id,
      userId: req.user.id,
      metadata: { fields: Object.keys(b) },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.json(r.rows[0]);
  } catch (err) {
    console.error('[invoices update]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /api/invoices/:id/send ━━━
router.post('/:id/send', blockClientUser, async (req, res) => {
  if (!ROLES_FULL.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const cur = await pool.query(`
      SELECT i.*, c.name AS client_name
        FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1 AND i.is_deleted = false
    `, [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const inv = cur.rows[0];
    if (!inv.customer_email) return res.status(400).json({ error: 'Invoice has no customer_email' });

    // Inline send (no separate template helper needed) — uses email.js's brand wrapper
    const nodemailer = require('nodemailer');
    const portalUrl = process.env.PORTAL_URL || 'https://portal.foundapay.com';
    const subject = `Invoice ${inv.invoice_number} — ${inv.client_name || 'FoundaPay'}`;
    const amount = parseFloat(inv.total_amount).toLocaleString('en-US', { style: 'currency', currency: inv.currency || 'USD' });
    const html = `
      <!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,'Segoe UI',sans-serif;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin-top:24px;">
          <div style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:#fff;padding:28px 32px;">
            <div style="font-size:13px;opacity:0.85;letter-spacing:0.06em;text-transform:uppercase;">Invoice</div>
            <div style="font-size:26px;font-weight:700;margin-top:6px;">${inv.invoice_number}</div>
          </div>
          <div style="padding:32px;color:#1a1027;font-size:15px;line-height:1.6;">
            <p>Hi ${inv.customer_name || 'there'},</p>
            <p>${inv.client_name || 'A FoundaPay client'} has issued an invoice for your records.</p>
            <div style="background:#f5f3ff;border-radius:10px;padding:16px;margin:20px 0;">
              <div style="color:#6b7280;font-size:12px;">AMOUNT DUE</div>
              <div style="color:#7C3AED;font-size:28px;font-weight:700;">${amount}</div>
              ${inv.due_date ? `<div style="color:#6b7280;font-size:12px;margin-top:10px;">DUE BY</div><div style="color:#1a1027;">${inv.due_date}</div>` : ''}
            </div>
            ${inv.payment_link_url ? `
              <p style="margin:24px 0;">
                <a href="${inv.payment_link_url}" style="display:inline-block;background:#7C3AED;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Pay Now</a>
              </p>` : ''}
            <p style="margin:24px 0;">
              <a href="${portalUrl}/api/invoices/${inv.id}/pdf" style="display:inline-block;background:#fff;border:1px solid #d1d5db;color:#1a1027;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:600;">Download PDF</a>
            </p>
            ${inv.notes ? `<p style="color:#6b7280;font-size:13px;margin-top:24px;">${String(inv.notes).slice(0, 300)}</p>` : ''}
          </div>
          <div style="padding:18px 32px;background:#f5f3ff;color:#6b7280;font-size:11px;border-top:1px solid #e5e7eb;">
            FoundaPay · portal.foundapay.com
          </div>
        </div>
      </body></html>`;

    let sendResult = { mode: 'console' };
    if (process.env.MAIL_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.MAIL_HOST,
          port: parseInt(process.env.MAIL_PORT || '587', 10),
          secure: process.env.MAIL_SECURE === 'true',
          auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
        });
        const info = await transporter.sendMail({
          from: process.env.MAIL_FROM || 'FoundaPay <noreply@foundapay.com>',
          to: inv.customer_email,
          subject,
          html,
        });
        sendResult = { mode: 'smtp', messageId: info.messageId };
        try {
          await pool.query(
            `INSERT INTO email_logs (recipient_email, recipient_name, subject, template, status)
             VALUES ($1,$2,$3,'invoice','sent')`,
            [inv.customer_email, inv.customer_name || null, subject]
          );
        } catch {}
      } catch (e) {
        sendResult = { mode: 'failed', error: e.message };
        console.warn('[invoice send] smtp failed:', e.message);
      }
    } else {
      console.log('[invoice send:console-mode]', { to: inv.customer_email, subject });
    }

    // Flip status to 'sent' (preserve 'paid', 'cancelled', 'overdue')
    if (['draft', 'viewed', 'sent'].includes(inv.status)) {
      await pool.query(
        `UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
    }

    await logAudit({
      action: 'invoice.sent',
      entityType: 'invoices', entityId: req.params.id,
      userId: req.user.id,
      metadata: { to: inv.customer_email, mode: sendResult.mode, error: sendResult.error || null },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, sent_to: inv.customer_email, mode: sendResult.mode });
  } catch (err) {
    console.error('[invoices send]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/invoices/:id/pdf ━━━
// Public-friendly: a logged-in staff or client_user (if scoped) can fetch.
// To support the email "Download PDF" button without login, we accept an
// optional ?token= signed link (TODO future). For now: authRequired only.
router.get('/:id/pdf', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT i.*,
             c.name AS client_name, c.logo_url AS client_logo_url,
             c.email AS client_email, c.phone AS client_phone,
             e.legal_name AS entity_name, e.logo_url AS entity_logo_url,
             e.address AS entity_address, e.phone AS entity_phone,
             e.owner_email AS entity_email
        FROM invoices i
        LEFT JOIN clients c  ON c.id = i.client_id
        LEFT JOIN entities e ON e.id = i.entity_id
       WHERE i.id = $1 AND i.is_deleted = false
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const inv = r.rows[0];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="${inv.invoice_number}.pdf"`);

    buildInvoice(inv, {
      logo_url: inv.entity_logo_url || inv.client_logo_url,
      client_name: inv.client_name,
      client_email: inv.client_email,
      client_phone: inv.client_phone,
      entity_name: inv.entity_name,
      entity_address: inv.entity_address,
      entity_phone: inv.entity_phone,
      entity_email: inv.entity_email,
    }, res);
  } catch (err) {
    console.error('[invoices pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /api/invoices/:id/mark-paid ━━━
router.post('/:id/mark-paid', blockClientUser, async (req, res) => {
  if (!ROLES_FULL.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const cur = await pool.query('SELECT * FROM invoices WHERE id = $1 AND is_deleted = false', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    if (cur.rows[0].status === 'paid') return res.status(409).json({ error: 'Already paid' });

    const { transaction_id, paid_amount, paid_at } = req.body || {};
    const r = await pool.query(`
      UPDATE invoices
         SET status = 'paid',
             paid_at = COALESCE($1::timestamptz, NOW()),
             paid_amount = COALESCE($2, total_amount),
             transaction_id = $3,
             updated_at = NOW()
       WHERE id = $4
       RETURNING *
    `, [paid_at || null, paid_amount || null, transaction_id || null, req.params.id]);

    await logAudit({
      action: 'invoice.marked_paid',
      entityType: 'invoices', entityId: req.params.id,
      userId: req.user.id,
      metadata: { transaction_id, paid_amount: paid_amount || cur.rows[0].total_amount },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ DELETE /api/invoices/:id ━━━
router.delete('/:id', blockClientUser, async (req, res) => {
  if (!['super_admin', 'owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const cur = await pool.query('SELECT invoice_number, status FROM invoices WHERE id = $1 AND is_deleted = false', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    if (cur.rows[0].status === 'paid') {
      return res.status(409).json({ error: 'Paid invoices cannot be deleted' });
    }
    await pool.query('UPDATE invoices SET is_deleted = true, updated_at = NOW() WHERE id = $1', [req.params.id]);

    await logAudit({
      action: 'invoice.deleted',
      entityType: 'invoices', entityId: req.params.id,
      userId: req.user.id,
      metadata: { invoice_number: cur.rows[0].invoice_number },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
