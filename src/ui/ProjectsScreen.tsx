import { useEffect, useRef, useState } from 'react';
import { store } from '../model/store';
import {
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  renameProject,
  type ProjectRecord,
} from '../storage/projects';
import { currentLocale, useT } from '../i18n';
import { exportProject, importProjectFile, type ExportKind } from './projectIO';
import { LanguageSelect } from './Settings';
import { confirmDialog, promptDialog } from './dialog';

/** Ask the browser not to evict data (otherwise Safari may clear storage of an unused site). */
async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported — that is fine */
  }
}

function formatBytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

/** Start screen: project list, create, import, export. */
export function ProjectsScreen() {
  const t = useT();
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setProjects(await listProjects());
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage !== undefined) setUsage(formatBytes(est.usage));
    } catch {
      /* storage estimate API is unavailable */
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const open = async (id: string) => {
    setBusy(id);
    try {
      await store.openProject(id);
    } catch (e) {
      setMessage(t('projects.openFailed', { error: (e as Error).message }));
      setBusy(null);
    }
  };

  const create = async () => {
    const name = await promptDialog(t('projects.namePrompt'), t('projects.defaultName', { n: (projects?.length ?? 0) + 1 }), {
      okLabel: t('dialog.create'),
    });
    if (!name) return;
    void requestPersistence();
    const p = await createProject(name);
    await open(p.id);
  };

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await action();
    } catch (e) {
      setMessage((e as Error).message);
    }
    setBusy(null);
    await refresh();
  };

  const doExport = (p: ProjectRecord, kind: ExportKind) => run(p.id, () => exportProject(p.id, kind));

  const doImport = async (file: File) => {
    setBusy('import');
    try {
      void requestPersistence();
      const r = await importProjectFile(file);
      setMessage(
        t('projects.imported', { name: r.project.name, photos: r.photos }) +
          (r.warnings.length ? ` ${t('projects.importWarnings', { n: r.warnings.length })}` : ''),
      );
      r.warnings.forEach((w) => console.warn(w));
    } catch (e) {
      const msg = (e as Error).message;
      setMessage(t('projects.importFailed', { error: msg === 'no-geojson-in-zip' ? t('projects.noGeojsonInZip') : msg }));
    }
    setBusy(null);
    await refresh();
  };

  return (
    <div className="projects-screen">
      <header className="projects-header">
        <div>
          <h1>⚡ {t('app.name')}</h1>
          <p className="muted">{t('app.tagline')}</p>
        </div>
        <LanguageSelect />
      </header>

      <div className="projects-actions">
        <button className="primary" onClick={() => void create()}>
          {t('projects.new')}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={busy === 'import'}>
          {busy === 'import' ? t('projects.importing') : t('projects.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.geojson,.json,application/zip,application/geo+json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
        {usage && <span className="muted small">{t('projects.storageUsed', { size: usage })}</span>}
      </div>
      {message && (
        <div className="projects-message" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      {projects === null && <p className="muted">{t('projects.loading')}</p>}
      {projects?.length === 0 && <p className="muted">{t('projects.empty')}</p>}

      <ul className="projects-list">
        {projects?.map((p) => (
          <li key={p.id} className="project-card">
            <button className="project-open" onClick={() => void open(p.id)} disabled={busy === p.id}>
              <span className="project-name">{p.name}</span>
              <span className="muted small">
                {t('projects.summary', {
                  poles: p.summary.poles,
                  houses: p.summary.houses,
                  lines: p.summary.lines,
                  photos: p.summary.photos,
                })}
              </span>
              <span className="muted small">
                {t('projects.updated', { date: new Date(p.updatedAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }) })}
              </span>
            </button>
            <div className="project-buttons">
              <button onClick={() => void doExport(p, 'zip')} title={t('projects.exportZipTitle')}>
                {t('projects.exportZip')}
              </button>
              <button onClick={() => void doExport(p, 'geojson')} title={t('projects.exportGeojsonTitle')}>
                GeoJSON
              </button>
              <button
                onClick={async () => {
                  const name = await promptDialog(t('projects.renamePrompt'), p.name, { okLabel: t('dialog.rename') });
                  if (name) void run(p.id, () => renameProject(p.id, name));
                }}
              >
                {t('projects.rename')}
              </button>
              <button onClick={() => void run(p.id, () => duplicateProject(p.id, t('projects.copyName', { name: p.name })))}>
                {t('projects.duplicate')}
              </button>
              <button
                className="danger"
                onClick={async () => {
                  const ok = await confirmDialog(t('projects.deleteConfirm', { name: p.name }), { okLabel: t('dialog.delete'), danger: true });
                  if (ok) void run(p.id, () => deleteProject(p.id));
                }}
              >
                {t('projects.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <footer className="projects-footer muted small">
        © 2026 Georgiy Garnov · {t('projects.license')}{' '}
        <a href="https://github.com/Georgy-Garnov/Phasograph" target="_blank" rel="noreferrer">
          {t('projects.sourceCode')}
        </a>
      </footer>
    </div>
  );
}
