import { toast } from '../store/toast';

const TOKEN_KEY = 'foundapay_token';

// Download a transaction receipt PDF (auth-aware fetch + blob download).
export async function downloadReceipt(txId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`/api/transactions/${txId}/receipt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FoundaPay-Receipt-TXN${txId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success('Receipt downloaded');
  } catch (e) {
    toast.error(`Receipt download failed: ${e.message}`);
  }
}

// Download a client statement PDF for a date range
export async function downloadStatement(clientId, from, to) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = `/api/clients/${clientId}/statement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=pdf`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const blob = await res.blob();
    const dl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dl;
    a.download = `FoundaPay-Statement-${from}-to-${to}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dl), 5000);
    toast.success('Statement downloaded');
  } catch (e) {
    toast.error(`Statement download failed: ${e.message}`);
  }
}
