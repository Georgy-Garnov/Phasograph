import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { store, useStore } from './model/store';
import { emptyScheme } from './model/scheme';
import { MapView, mapApi } from './map/MapView';
import { searchPlace } from './map/geocoder';
import { cancelContourEdit, deleteSelection, finishContour, finishContourEdit, hintForTool, setTool } from './map/interactions';
import { migrateLegacyStorage } from './storage/projects';
import { Toolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { ReportPanel } from './ui/ReportPanel';
import { ProjectsScreen } from './ui/ProjectsScreen';
import { DialogHost, confirmDialog, isDialogOpen, promptDialog } from './ui/dialog';
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

const SIDEBAR_KEY = 'electro-sidebar-width';
const SIDEBAR_MIN = 280;

function loadSidebarWidth(): number | null {
  const v = Number(localStorage.getItem(SIDEBAR_KEY));
  return v >= SIDEBAR_MIN ? v : null;
}

/** Drag handle on the sidebar's left edge (mouse and touch). Double-click resets to the default width. */
function SidebarResizer({ onResize }: { onResize: (width: number | null) => void }) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, SIDEBAR_MIN), Math.max(SIDEBAR_MIN, window.innerWidth - 420)));
  return (
    <div
      className={dragging ? 'sidebar-resizer dragging' : 'sidebar-resizer'}
      title={t('sidebar.resizeTitle')}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging) onResize(clamp(window.innerWidth - e.clientX));
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onDoubleClick={() => onResize(null)}
    />
  );
}

function Editor() {
  const t = useT();
  const [sidebarWidth, setSidebarWidthState] = useState<number | null>(loadSidebarWidth);
  const setSidebarWidth = (w: number | null) => {
    setSidebarWidthState(w);
    if (w === null) localStorage.removeItem(SIDEBAR_KEY);
    else localStorage.setItem(SIDEBAR_KEY, String(w));
  };
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
      if (isDialogOpen() || target.closest('input, textarea, select') || document.querySelector('.photo-viewer')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Escape' && store.get().contourEdit) {
        cancelContourEdit();
      } else if (e.key === 'Enter' && store.get().contourEdit) {
        finishContourEdit();
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
    <div className="app" style={sidebarWidth ? ({ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties) : undefined}>
      <header className="topbar">
        <button className="projects-btn" onClick={() => void store.closeProject()} title={t('topbar.projectsTitle')}>
          ☰ {t('topbar.projects')}
        </button>
        <button
          className="project-title"
          title={t('topbar.renameTitle')}
          onClick={async () => {
            const name = await promptDialog(t('projects.renamePrompt'), projectName, { okLabel: t('dialog.rename') });
            if (name) void store.renameCurrent(name);
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
        <button
          className="danger"
          onClick={async () => {
            if (await confirmDialog(t('topbar.clearConfirm'), { okLabel: t('dialog.clear'), danger: true })) store.replace(emptyScheme());
          }}
        >
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
        <SidebarResizer onResize={setSidebarWidth} />
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
  return (
    <>
      {projectId ? <Editor /> : <ProjectsScreen />}
      <DialogHost />
    </>
  );
}
