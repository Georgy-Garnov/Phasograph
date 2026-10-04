import { useEffect, useRef, useState } from 'react';
import { store, useStore } from './model/store';
import { emptyScheme } from './model/scheme';
import { MapView, mapApi } from './map/MapView';
import { searchPlace } from './map/geocoder';
import { deleteSelection, finishContour, hintForTool, setTool } from './map/interactions';
import { migrateLegacyStorage } from './storage/projects';
import { Toolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { ReportPanel } from './ui/ReportPanel';
import { ProjectsScreen } from './ui/ProjectsScreen';
import { ProviderSettings } from './ui/Settings';
import { Legend } from './ui/Legend';
import { exportProject, type ExportKind } from './ui/projectIO';
import { t as tr, useT } from './i18n';

function AddressSearch() {
  const t = useT();
  const [q, setQ] = useState('');
  return (
    <form
      className="search"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!q.trim()) return;
        const c = await searchPlace(q);
        if (c) mapApi.flyTo?.(c, 17);
        else store.set({ hint: t('search.notFound') });
      }}
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} />
    </form>
  );
}

/** Export menu for the open project. */
function ExportMenu() {
  const t = useT();
  const projectId = useStore((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (kind: ExportKind) => {
    setOpen(false);
    if (!projectId) return;
    setBusy(true);
    try {
      await exportProject(projectId, kind);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="menu">
      <button onClick={() => setOpen(!open)} disabled={busy}>
        {busy ? t('export.busy') : t('export.title')} ▾
      </button>
      {open && (
        <div className="menu-popup" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => void run('zip')}>{t('export.zip')}</button>
          <button onClick={() => void run('geojson')}>{t('export.geojson')}</button>
        </div>
      )}
    </div>
  );
}

function Editor() {
  const t = useT();
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const hint = useStore((s) => s.hint);
  const tool = useStore((s) => s.tool);
  const contour = useStore((s) => s.contour);
  const lineStart = useStore((s) => s.lineStart);
  const projectName = useStore((s) => s.projectName);
  useStore((s) => s.settings.lang); // tool tooltip in the current language

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select') || document.querySelector('.photo-viewer')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Escape') {
        const s = store.get();
        if (s.lineStart || s.contour.length) store.set({ lineStart: null, contour: [] });
        else if (s.tool.type !== 'select') setTool({ type: 'select' });
        else store.set({ selection: null, focusKey: null, selectedLamp: null });
      } else if (e.key === 'Enter' && store.get().tool.type === 'houseContour') {
        finishContour();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="projects-btn" onClick={() => void store.closeProject()} title={t('topbar.projectsTitle')}>
          ☰ {t('topbar.projects')}
        </button>
        <button
          className="project-title"
          title={t('topbar.renameTitle')}
          onClick={() => {
            const name = prompt(t('projects.renamePrompt'), projectName);
            if (name?.trim()) void store.renameCurrent(name.trim());
          }}
        >
          <strong>{projectName}</strong>
        </button>
        <AddressSearch />
        <ProviderSettings />
        <div className="spacer" />
        <button onClick={store.undo} disabled={!canUndo} title={t('topbar.undo')}>
          ↶
        </button>
        <button onClick={store.redo} disabled={!canRedo} title={t('topbar.redo')}>
          ↷
        </button>
        <ExportMenu />
        <button className="danger" onClick={() => confirm(t('topbar.clearConfirm')) && store.replace(emptyScheme())}>
          {t('topbar.clear')}
        </button>
      </header>
      <Toolbar />
      <main className="center">
        <MapView />
        <div className="statusbar">
          <span>{hint ?? hintForTool(tool)}</span>
          {lineStart && <span className="muted"> · {t('status.drawingLine')}</span>}
          {contour.length > 0 && <button onClick={finishContour}>{t('status.finishContour', { n: contour.length })}</button>}
          <Legend />
        </div>
      </main>
      <aside className="sidebar">
        <div className="sidebar-top">
          <Inspector />
        </div>
        <div className="sidebar-bottom">
          <ReportPanel />
        </div>
      </aside>
    </div>
  );
}

export function App() {
  const projectId = useStore((s) => s.projectId);
  const lang = useStore((s) => s.settings.lang);
  const [ready, setReady] = useState(false);
  const migrated = useRef(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${tr('app.name')} — ${tr('app.tagline')}`;
  }, [lang]);

  // One-time migration of the scheme from legacy storage (localStorage) into the first project.
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    void migrateLegacyStorage(tr('projects.migratedName')).finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  return projectId ? <Editor /> : <ProjectsScreen />;
}
