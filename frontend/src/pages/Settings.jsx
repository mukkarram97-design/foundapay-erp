import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Label, PageHeader, Alert, Badge } from '../components/ui';

export default function Settings() {
  const [cms, setCms] = useState({});
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);

  async function load() {
    try { setCms(await api.get('/api/cms')); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  function startEdit(key) {
    setEditKey(key);
    setEditVal(JSON.stringify(cms[key], null, 2));
  }

  async function save() {
    try {
      const value = JSON.parse(editVal);
      await api.patch(`/api/cms/${editKey}`, { value });
      setSaved(`Saved ${editKey}`);
      setEditKey(null);
      load();
      setTimeout(() => setSaved(null), 3000);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <PageHeader title="Settings · CMS" subtitle="System-wide configuration & editable lists" />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {saved && <div className="mb-4"><Alert tone="success">{saved}</Alert></div>}

      <div className="grid grid-cols-1 gap-3">
        {Object.entries(cms).map(([key, value]) => (
          <Card key={key} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-[var(--text-primary)] font-mono">{key}</div>
                {Array.isArray(value) ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {value.map((v, i) => <Badge key={i}>{String(v)}</Badge>)}
                  </div>
                ) : (
                  <pre className="mt-2 text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
                )}
              </div>
              <Button variant="secondary" onClick={() => startEdit(key)}>Edit</Button>
            </div>
            {editKey === key && (
              <div className="mt-3">
                <Label>Edit JSON</Label>
                <textarea
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  rows={8}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border)] focus:border-blue-500 focus:outline-none rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono text-xs"
                />
                <div className="flex gap-2 mt-2">
                  <Button onClick={save}>Save</Button>
                  <Button variant="ghost" onClick={() => setEditKey(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
        {Object.keys(cms).length === 0 && <Card className="p-6 text-[var(--text-tertiary)]">No CMS settings yet</Card>}
      </div>
    </div>
  );
}
