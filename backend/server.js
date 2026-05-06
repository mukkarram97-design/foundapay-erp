require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { pool } = require('./src/db');

const authRoutes         = require('./src/routes/auth');
const transactionsRoutes = require('./src/routes/transactions');
const clientsRoutes      = require('./src/routes/clients');
const entitiesRoutes     = require('./src/routes/entities');
const merchantsRoutes    = require('./src/routes/merchants');
const cardsRoutes        = require('./src/routes/cards');
const expensesRoutes     = require('./src/routes/expenses');
const assetsRoutes       = require('./src/routes/assets');
const payoutsRoutes      = require('./src/routes/payouts');
const chargebacksRoutes  = require('./src/routes/chargebacks');
const reservesRoutes     = require('./src/routes/reserves');
const paymentLinksRoutes = require('./src/routes/paymentLinks');
const dashboardRoutes    = require('./src/routes/dashboard');
const reportsRoutes      = require('./src/routes/reports');
const salaryRoutes       = require('./src/routes/salary');
const usersRoutes        = require('./src/routes/users');
const auditRoutes        = require('./src/routes/audit');
const cmsRoutes          = require('./src/routes/cms');
const portalRoutes       = require('./src/routes/portal');
const brokersRoutes      = require('./src/routes/brokers');
const partnersRoutes     = require('./src/routes/partners');
const globalSearchRoutes = require('./src/routes/globalSearch');
const notificationsRoutes= require('./src/routes/notifications');
const virtualTerminalRoutes = require('./src/routes/virtualTerminal');
const paymentsRoutes        = require('./src/routes/payments');
const invoicesRoutes        = require('./src/routes/invoices');
const banksRoutes           = require('./src/routes/banks');
const approvalsRoutes       = require('./src/routes/approvals');
const wiseRoutes            = require('./src/routes/wise');
const permissionsRoutes     = require('./src/routes/permissions');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Public payment routes — NO auth (mounted before any auth-required routes)
//   GET /pay/:token       → Accept.js HTML page
//   POST /api/pay/process → charge using Accept.js nonce
app.use('/', paymentsRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now, current_database() as db');
    res.json({ ok: true, service: 'foundapay-erp-api', version: '2.0.0', time: r.rows[0].now, database: r.rows[0].db });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mount routes
app.use('/api/auth',           authRoutes);
app.use('/api/portal',         portalRoutes);
app.use('/api/transactions',   transactionsRoutes);
app.use('/api/clients',        clientsRoutes);
app.use('/api/entities',       entitiesRoutes);
app.use('/api/merchants',      merchantsRoutes);
app.use('/api/cards',          cardsRoutes);
app.use('/api/expenses',       expensesRoutes);
app.use('/api/assets',         assetsRoutes);
app.use('/api/payouts',        payoutsRoutes);
app.use('/api/chargebacks',    chargebacksRoutes);
app.use('/api/reserves',       reservesRoutes);
app.use('/api/payment-links',  paymentLinksRoutes);
app.use('/api/invoices',       invoicesRoutes);
app.use('/api/banks',          banksRoutes);
app.use('/api/approvals',      approvalsRoutes);
app.use('/api/wise',           wiseRoutes);
app.use('/api/permissions',    permissionsRoutes);
app.use('/api/dashboard',      dashboardRoutes);
app.use('/api/reports',        reportsRoutes);
app.use('/api/salary',         salaryRoutes);
app.use('/api/users',          usersRoutes);
app.use('/api/audit',          auditRoutes);
app.use('/api/cms',            cmsRoutes);
app.use('/api/brokers',        brokersRoutes);
app.use('/api/partners',       partnersRoutes);
app.use('/api/payroll',        salaryRoutes); // alias to salary
app.use('/api/global-search',  globalSearchRoutes);
app.use('/api/notifications',  notificationsRoutes);
app.use('/api/virtual-terminal', virtualTerminalRoutes);
app.use('/api/vt',               virtualTerminalRoutes);  // shorthand alias

// 404 for any other /api/*
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  FoundaPay ERP API`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/api/health`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
