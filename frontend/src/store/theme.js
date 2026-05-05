import { create } from 'zustand';

const KEY = 'fp_theme';
const initial = (typeof window !== 'undefined' && localStorage.getItem(KEY)) || 'dark';

export const useTheme = create((set, get) => ({
  theme: initial,
  setTheme: (t) => {
    localStorage.setItem(KEY, t);
    document.documentElement.setAttribute('data-theme', t);
    set({ theme: t });
  },
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));

// Apply on load
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-theme', initial);
}
