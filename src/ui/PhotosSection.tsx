import { useEffect, useRef, useState } from 'react';
import { store, useStore, type PhotoMeta } from '../model/store';
import { processPhoto } from '../storage/photos';
import { getPhoto } from '../storage/projects';
import { currentLocale, useT } from '../i18n';
import { Section } from './common';
import { confirmDialog, isDialogOpen } from './dialog';

/**
 * Object photos. "Take photo" on a phone/tablet opens the camera directly (capture="environment");
 * after shooting, the browser returns to the page and the photo is compressed and saved to IndexedDB.
 */
export function PhotosSection({ nodeId }: { nodeId: string }) {
  const t = useT();
  const all = useStore((s) => s.photos);
  const photos = all.filter((p) => p.nodeId === nodeId).sort((a, b) => a.createdAt - b.createdAt);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    setBusy(list.length);
    for (const file of list) {
      try {
        await store.addPhoto(nodeId, await processPhoto(file));
      } catch (e) {
        console.warn(e);
        store.set({ hint: t('photos.failed', { name: file.name }) });
      }
      setBusy((n) => n - 1);
    }
  };

  return (
    <Section
      title={photos.length ? t('photos.titleCount', { n: photos.length }) : t('photos.title')}
      actions={
        <div className="btn-row">
          <button onClick={() => cameraRef.current?.click()} title={t('photos.cameraTitle')}>
            📷 {t('photos.camera')}
          </button>
          <button onClick={() => galleryRef.current?.click()} title={t('photos.galleryTitle')}>
            🖼 {t('photos.gallery')}
          </button>
        </div>
      }
    >
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {busy > 0 && <p className="muted small">{t('photos.processing', { n: busy })}</p>}
      {photos.length === 0 && busy === 0 && <p className="muted small">{t('photos.none')}</p>}
      <div className="photo-grid">
        {photos.map((p) => (
          <button key={p.id} className="photo-thumb" onClick={() => setViewing(p.id)} title={p.caption || formatDate(p.createdAt)}>
            <img src={p.thumbUrl} alt={p.caption} loading="lazy" />
          </button>
        ))}
      </div>
      {viewing && <PhotoViewer photos={photos} currentId={viewing} onNavigate={setViewing} onClose={() => setViewing(null)} />}
    </Section>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

/** Full-screen photo viewer: paging, caption, deletion. */
function PhotoViewer({
  photos,
  currentId,
  onNavigate,
  onClose,
}: {
  photos: PhotoMeta[];
  currentId: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const index = photos.findIndex((p) => p.id === currentId);
  const photo = photos[index];
  const [url, setUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState(photo?.caption ?? '');

  useEffect(() => {
    if (!photo) return;
    setCaption(photo.caption);
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    void getPhoto(photo.id).then((rec) => {
      if (cancelled || !rec) return;
      objectUrl = URL.createObjectURL(rec.blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo?.id]);

  const go = (delta: number) => {
    const next = photos[(index + delta + photos.length) % photos.length];
    if (next) onNavigate(next.id);
  };
  const saveCaption = () => {
    if (photo && caption !== photo.caption) void store.setPhotoCaption(photo.id, caption);
  };
  const remove = async () => {
    if (!photo || !(await confirmDialog(t('photos.deleteConfirm'), { okLabel: t('dialog.delete'), danger: true }))) return;
    const next = photos[index + 1] ?? photos[index - 1];
    await store.deletePhoto(photo.id);
    if (next) onNavigate(next.id);
    else onClose();
  };

  // Handle keys here and stop propagation: Del must not delete the pole behind the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isDialogOpen()) return;
      if ((e.target as HTMLElement).closest('input, textarea')) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!photo) return null;
  return (
    <div className="photo-viewer" onClick={onClose}>
      <div className="photo-viewer-body" onClick={(e) => e.stopPropagation()}>
        <div className="photo-viewer-image">
          {url ? <img src={url} alt={photo.caption} /> : <img src={photo.thumbUrl} alt="" className="loading" />}
          {photos.length > 1 && (
            <>
              <button className="nav prev" onClick={() => go(-1)} aria-label={t('photos.prev')}>
                ‹
              </button>
              <button className="nav next" onClick={() => go(1)} aria-label={t('photos.next')}>
                ›
              </button>
            </>
          )}
        </div>
        <div className="photo-viewer-bar">
          <span className="muted small">
            {index + 1} / {photos.length} · {formatDate(photo.createdAt)} · {photo.width}×{photo.height}
          </span>
          <input
            value={caption}
            placeholder={t('photos.captionPlaceholder')}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <button className="danger" onClick={() => void remove()}>
            {t('photos.delete')}
          </button>
          <button onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
