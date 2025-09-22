import { ChangeEvent } from 'react';
import { useLocalSettings } from '../hooks/useLocalSettings';

interface SettingsDrawerProps {
  controller: ReturnType<typeof useLocalSettings>;
  open: boolean;
  onClose: () => void;
}

export function SettingsDrawer({ controller, open, onClose }: SettingsDrawerProps) {
  const { settings, update, reset, applyProfile, exportProfile, importProfile, profiles } = controller;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await importProfile(file);
      event.target.value = '';
    }
  };

  return (
    <aside
      className={`fixed top-0 right-0 h-full w-full max-w-md transform bg-panel-subtle shadow-lg shadow-black/50 transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h3 className="text-lg font-semibold">Settings</h3>
        <button onClick={onClose} className="bg-slate-700 hover:bg-slate-600 text-xs">
          Close
        </button>
      </div>
      <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
        <section className="space-y-2">
          <h4 className="font-semibold">History window</h4>
          <label className="flex items-center gap-2">
            Hours
            <input
              type="number"
              min={1}
              max={168}
              value={settings.historyHours}
              onChange={(event) => update({ historyHours: Number(event.target.value) })}
            />
          </label>
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">Auto refresh</h4>
          <label className="flex items-center gap-2">
            Interval (ms)
            <input
              type="number"
              value={settings.autoRefreshMs}
              onChange={(event) => update({ autoRefreshMs: Number(event.target.value) })}
            />
          </label>
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">Profiles</h4>
          <select
            value={settings.profile}
            onChange={(event) => applyProfile(event.target.value as keyof typeof profiles)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            {(Object.keys(profiles) as Array<keyof typeof profiles>).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={exportProfile} className="bg-slate-700 hover:bg-slate-600 text-xs">
              Export JSON
            </button>
            <label className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-2 rounded cursor-pointer">
              Import JSON
              <input type="file" accept="application/json" className="hidden" onChange={handleFile} />
            </label>
          </div>
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">Balances</h4>
          <label className="flex items-center gap-2">
            Luno (ZAR)
            <input
              type="number"
              value={settings.balances.lunoZAR}
              onChange={(event) => update({ balances: { ...settings.balances, lunoZAR: Number(event.target.value) } })}
            />
          </label>
          <label className="flex items-center gap-2">
            Kraken (GBP)
            <input
              type="number"
              value={settings.balances.krakenGBP}
              onChange={(event) => update({ balances: { ...settings.balances, krakenGBP: Number(event.target.value) } })}
            />
          </label>
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">Withdrawal amortization</h4>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.withdrawalAmortization}
              onChange={(event) => update({ withdrawalAmortization: event.target.checked })}
            />
            Include withdrawal fees
          </label>
        </section>
        <button onClick={reset} className="bg-rose-700 hover:bg-rose-600 text-xs">
          Reset defaults
        </button>
      </div>
    </aside>
  );
}

export default SettingsDrawer;
