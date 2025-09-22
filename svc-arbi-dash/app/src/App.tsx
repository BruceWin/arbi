import { useState } from 'react';
import 'uplot/dist/uPlot.min.css';
import HeaderTiles from './components/HeaderTiles';
import HealthStrip from './components/HealthStrip';
import AssetChart from './components/AssetChart';
import CombinedChart from './components/CombinedChart';
import RecentTable from './components/RecentTable';
import Calculators from './components/Calculators';
import PositionSizer from './components/PositionSizer';
import SettingsDrawer from './components/SettingsDrawer';
import ExplainSpikeModal from './components/ExplainSpikeModal';
import TradesForm from './components/TradesForm';
import TradesTable from './components/TradesTable';
import TaxReports from './components/TaxReports';
import { useLocalSettings } from './hooks/useLocalSettings';
import { useDataWindow } from './hooks/useDataWindow';
import { useFrankfurter } from './hooks/useFrankfurter';
import { useTradesApi } from './hooks/useTradesApi';
import { Sample, Trade } from './lib/types';

const ASSETS = ['ETH', 'BTC', 'USDT'] as const;

type TabKey = 'dashboard' | 'trades' | 'tax';

function useAuthToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('auth') ?? '';
}

function App() {
  const authToken = useAuthToken();
  const settingsController = useLocalSettings();
  const { settings } = settingsController;
  const dataWindow = useDataWindow({ authToken, historyHours: settings.historyHours, autoRefreshMs: settings.autoRefreshMs });
  const frankfurter = useFrankfurter();
  const tradesApi = useTradesApi(authToken);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [explain, setExplain] = useState<{ asset: (typeof ASSETS)[number] | null; sample: Sample | null }>({ asset: null, sample: null });
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);

  const latestSample = dataWindow.samples.length ? dataWindow.samples[dataWindow.samples.length - 1] : null;

  const handleTradeSubmit = async (payload: Partial<Trade> & { id?: string }) => {
    try {
      if (payload.id) {
        await tradesApi.update(payload as Trade);
        setEditingTrade(null);
      } else {
        await tradesApi.create(payload as Trade);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const explainClose = () => setExplain({ asset: null, sample: null });

  const dashboardContent = (
    <div className="space-y-6">
      <HeaderTiles
        sample={latestSample}
        settings={settings}
        quotes={frankfurter.quotes}
        onSettingsOpen={() => setSettingsOpen(true)}
      />
      <HealthStrip
        samples={dataWindow.samples}
        frankfurterError={frankfurter.error}
        dataError={dataWindow.error}
        tradeError={tradesApi.error}
      />
      <CombinedChart samples={dataWindow.samples} settings={settings} onExplain={setExplain} />
      <div className="space-y-4">
        {ASSETS.map((asset) => (
          <AssetChart key={asset} asset={asset} samples={dataWindow.samples} settings={settings} onExplain={setExplain} />
        ))}
      </div>
      <RecentTable samples={dataWindow.samples} settings={settings} />
      <div className="grid gap-4 md:grid-cols-2">
        <Calculators quotes={frankfurter.quotes} />
        <PositionSizer sample={latestSample} settings={settings} />
      </div>
    </div>
  );

  const tradesContent = (
    <div className="space-y-4">
      <TradesForm onSubmit={handleTradeSubmit} editing={editingTrade} onCancelEdit={() => setEditingTrade(null)} />
      <TradesTable api={tradesApi} onEdit={(trade) => setEditingTrade(trade)} />
    </div>
  );

  const taxContent = <TaxReports authToken={authToken} />;

  if (!authToken) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">svc-arbi-dash</h1>
          <p className="text-sm text-slate-400">Missing auth token. Append ?auth=&lt;token&gt; to the URL.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-semibold">Arbitrage dashboard</h1>
            <p className="text-xs text-slate-400">Data refreshes every {settings.autoRefreshMs / 1000} seconds.</p>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <button
              className={activeTab === 'dashboard' ? 'text-sky-400' : 'text-slate-400 hover:text-sky-300'}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={activeTab === 'trades' ? 'text-sky-400' : 'text-slate-400 hover:text-sky-300'}
              onClick={() => setActiveTab('trades')}
            >
              Trades
            </button>
            <button
              className={activeTab === 'tax' ? 'text-sky-400' : 'text-slate-400 hover:text-sky-300'}
              onClick={() => setActiveTab('tax')}
            >
              Tax Reports
            </button>
            <button onClick={() => setSettingsOpen(true)} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded">
              Settings
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {activeTab === 'dashboard' ? dashboardContent : null}
        {activeTab === 'trades' ? tradesContent : null}
        {activeTab === 'tax' ? taxContent : null}
      </main>
      <SettingsDrawer controller={settingsController} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ExplainSpikeModal open={Boolean(explain.asset)} asset={explain.asset} sample={explain.sample} settings={settings} onClose={explainClose} />
    </div>
  );
}

export default App;
