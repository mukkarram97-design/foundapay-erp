import { create } from 'zustand';

let _id = 0;
export const useToast = create((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++_id;
    const item = { id, tone: 'info', duration: 4000, ...t };
    set({ toasts: [...get().toasts, item] });
    if (item.duration > 0) {
      setTimeout(() => get().remove(id), item.duration);
    }
    return id;
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (msg) => useToast.getState().push({ tone: 'success', message: msg }),
  error:   (msg) => useToast.getState().push({ tone: 'danger', message: msg, duration: 6000 }),
  info:    (msg) => useToast.getState().push({ tone: 'info', message: msg }),
  warning: (msg) => useToast.getState().push({ tone: 'warning', message: msg }),
};
