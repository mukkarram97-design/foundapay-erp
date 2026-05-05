import { create } from 'zustand';
import { api } from '../utils/api';

const TOKEN_KEY = 'foundapay_token';
const USER_KEY = 'foundapay_user';

const loadUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const useAuth = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: loadUser(),
  loading: false,
  error: null,

  async login(email, password) {
    set({ loading: true, error: null });
    try {
      const { token, user } = await api.post('/api/auth/login', { email, password });
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      set({ token, user, loading: false });
      return user;
    } catch (err) {
      set({ loading: false, error: err.message });
      throw err;
    }
  },

  async logout() {
    try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },

  async refresh() {
    try {
      const { user } = await api.get('/api/auth/me');
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      set({ user });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      set({ token: null, user: null });
    }
  },
}));
