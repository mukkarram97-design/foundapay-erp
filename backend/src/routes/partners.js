const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// Hardcoded Q1 reconciled net profit (used in waterfall calc until full ledger backfilled)
const Q1_NET_PROFIT = 49605.97;
const Q1_GROSS = 729024.81;
const Q1_REVENUE = 115563.01;

// GET /api/partners — owners + per-company partners with computed shares
router.get('/', async (req, res) => {
  try {
    // Owners (equity holders)
    const owners = await pool.query(`
      SELECT p.*,
             COALESCE((
               SELECT SUM(paid_amount) FROM partner_distributions WHERE partner_id = p.id
             ), 0) AS total_drawn
        FROM partners p WHERE type = 'owner' ORDER BY share_pct DESC
    `);
    // Each owner is entitled to share_pct of Q1 net profit
    const ownersWithCalc = owners.rows.map(o => {
      const entitled = +(Q1_NET_PROFIT * parseFloat(o.share_pct)).toFixed(2);
      const drawn = parseFloat(o.total_drawn) || 0;
      return {
        ...o,
        q1_entitled: entitled,
        total_drawn: drawn,
        balance_owed: +(entitled - drawn).toFixed(2),
      };
    });

    // Partners (per-company 10% share holders) — derive from entities.partner_name
    const partnerEntities = await pool.query(`
      SELECT e.partner_name AS name,
             COUNT(*) AS entity_count,
             json_agg(json_build_object(
               'id', e.id, 'legal_name', e.legal_name
             )) AS entities,
             COALESCE(SUM((
               SELECT COALESCE(SUM(t.fee_amount),0) FROM transactions t
                WHERE t.entity_id = e.id AND t.type = 'Received'
                  AND t.date_received BETWEEN '2026-04-01' AND '2026-04-30'
             )), 0) AS april_revenue
        FROM entities e
       WHERE e.partner_name IS NOT NULL
       GROUP BY e.partner_name
       ORDER BY april_revenue DESC
    `);
    const partnersWithCalc = partnerEntities.rows.map(p => ({
      ...p,
      partner_share_pct: 0.10,
      april_entitled: +(parseFloat(p.april_revenue) * 0.10).toFixed(2),
    }));

    res.json({
      q1_summary: { gross: Q1_GROSS, revenue: Q1_REVENUE, net_profit: Q1_NET_PROFIT },
      owners: ownersWithCalc,
      partners: partnersWithCalc,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/partners/waterfall — profit distribution steps
router.get('/waterfall', async (req, res) => {
  try {
    const owners = await pool.query(
      `SELECT name, share_pct FROM partners WHERE type = 'owner' ORDER BY share_pct DESC`
    );
    const steps = [
      { label: 'Q1 Gross Processed',     value: Q1_GROSS,        cumulative: Q1_GROSS },
      { label: 'FoundaPay Revenue',       value: Q1_REVENUE,      cumulative: Q1_REVENUE },
      { label: 'After tax (5%)',          value: -(Q1_REVENUE * 0.05),
        cumulative: Q1_REVENUE * 0.95 },
      { label: 'After COR + OpEx',        value: -(Q1_REVENUE * 0.95 - Q1_NET_PROFIT),
        cumulative: Q1_NET_PROFIT },
      { label: 'Net Profit Available',    value: Q1_NET_PROFIT,   cumulative: Q1_NET_PROFIT, divider: true },
    ];
    for (const o of owners.rows) {
      const amt = +(Q1_NET_PROFIT * parseFloat(o.share_pct)).toFixed(2);
      steps.push({
        label: `${o.name} (${(parseFloat(o.share_pct) * 100).toFixed(0)}%)`,
        value: amt, cumulative: amt, owner: true,
      });
    }
    res.json({ steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.type) return res.status(400).json({ error: 'name and type required' });
    const r = await pool.query(`
      INSERT INTO partners (name, type, share_pct, email, status, notes)
      VALUES ($1,$2,$3,$4,COALESCE($5,'active'),$6) RETURNING *
    `, [b.name, b.type, b.share_pct ? parseFloat(b.share_pct) : null, b.email || null, b.status, b.notes || null]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['name','type','share_pct','email','status','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE partners SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
