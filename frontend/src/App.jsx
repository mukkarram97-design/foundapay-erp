import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { useTheme } from './store/theme';
import Layout from './components/layout/Layout';
import Toaster from './components/ui/Toaster';

import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

import Dashboard from './pages/Dashboard';
import VirtualTerminal from './pages/VirtualTerminal';
import Transactions from './pages/Transactions';
import PaymentLinks from './pages/PaymentLinks';

import Clients from './pages/Clients';
import Payouts from './pages/Payouts';
import Chargebacks from './pages/Chargebacks';
import Reserves from './pages/Reserves';
import Reconciliation from './pages/Reconciliation';
import Brokers from './pages/Brokers';
import Partners from './pages/Partners';

import Entities from './pages/Entities';
import Merchants from './pages/Merchants';
import Routing from './pages/Routing';

import Cards from './pages/Cards';
import Expenses from './pages/Expenses';
import Assets from './pages/Assets';

import Reports from './pages/Reports';
import Q1Report from './pages/Q1Report';
import April2026 from './pages/April2026';
import Salary from './pages/Salary';
import Payroll from './pages/Payroll';
import Accounting from './pages/Accounting';

import Users from './pages/Users';
import Audit from './pages/Audit';
import Settings from './pages/Settings';

import ClientPortal from './pages/ClientPortal';

function RequireAuth({ children, allowClientUser = false }) {
  const { user, token } = useAuth();
  const location = useLocation();
  if (!token || !user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role === 'client_user' && !allowClientUser) return <Navigate to="/client-portal" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { token, user } = useAuth();
  if (token && user) {
    if (user.role === 'client_user') return <Navigate to="/client-portal" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function Guarded({ children }) {
  return <RequireAuth><Layout>{children}</Layout></RequireAuth>;
}

export default function App() {
  const { token, refresh } = useAuth();
  const { theme } = useTheme();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (token) refresh();
    // eslint-disable-next-line
  }, []);

  return (
    <>
      <Routes>
        <Route path="/login"           element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="/reset-password"  element={<PublicOnly><ResetPassword /></PublicOnly>} />

        <Route path="/dashboard"        element={<Guarded><Dashboard /></Guarded>} />
        <Route path="/virtual-terminal" element={<Guarded><VirtualTerminal /></Guarded>} />
        <Route path="/transactions"     element={<Guarded><Transactions /></Guarded>} />
        <Route path="/payment-links"    element={<Guarded><PaymentLinks /></Guarded>} />

        <Route path="/clients"          element={<Guarded><Clients /></Guarded>} />
        <Route path="/payouts"          element={<Guarded><Payouts /></Guarded>} />
        <Route path="/chargebacks"      element={<Guarded><Chargebacks /></Guarded>} />
        <Route path="/reserves"         element={<Guarded><Reserves /></Guarded>} />
        <Route path="/reconciliation"   element={<Guarded><Reconciliation /></Guarded>} />
        <Route path="/brokers"          element={<Guarded><Brokers /></Guarded>} />
        <Route path="/partners"         element={<Guarded><Partners /></Guarded>} />

        <Route path="/entities"         element={<Guarded><Entities /></Guarded>} />
        <Route path="/merchants"        element={<Guarded><Merchants /></Guarded>} />
        <Route path="/routing"          element={<Guarded><Routing /></Guarded>} />

        <Route path="/cards"            element={<Guarded><Cards /></Guarded>} />
        <Route path="/expenses"         element={<Guarded><Expenses /></Guarded>} />
        <Route path="/assets"           element={<Guarded><Assets /></Guarded>} />

        <Route path="/reports"          element={<Guarded><Reports /></Guarded>} />
        <Route path="/q1-2026"          element={<Guarded><Q1Report /></Guarded>} />
        <Route path="/april-2026"       element={<Guarded><April2026 /></Guarded>} />
        <Route path="/salary"           element={<Guarded><Salary /></Guarded>} />
        <Route path="/payroll"          element={<Guarded><Payroll /></Guarded>} />
        <Route path="/accounting"       element={<Guarded><Accounting /></Guarded>} />

        <Route path="/users"            element={<Guarded><Users /></Guarded>} />
        <Route path="/audit"            element={<Guarded><Audit /></Guarded>} />
        <Route path="/settings"         element={<Guarded><Settings /></Guarded>} />

        <Route path="/client-portal" element={<RequireAuth allowClientUser><ClientPortal /></RequireAuth>} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
