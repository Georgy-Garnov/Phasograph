import { useStore } from '../model/store';
import { isPole } from '../model/scheme';
import { deleteSelection } from '../map/interactions';
import { KtpEditor } from './KtpEditor';
import { PoleEditor } from './PoleEditor';
import { EntryEditor, HouseForm } from './HouseForm';
import { LineEditor } from './LineEditor';
import { Field, editNode } from './common';
import { PhotosSection } from './PhotosSection';
import { useT } from '../i18n';

export function Inspector() {
  const t = useT();
  const selection = useStore((s) => s.selection);
  const scheme = useStore((s) => s.scheme);
  if (!selection) {
    return <p className="muted pad">{t('inspector.empty')}</p>;
  }
  const node = selection.type === 'node' ? scheme.nodes[selection.id] : undefined;
  const line = selection.type === 'line' ? scheme.lines[selection.id] : undefined;
  return (
    <div className="inspector">
      {node?.kind === 'ktp' && <KtpEditor ktp={node} />}
      {isPole(node) && <PoleEditor pole={node} />}
      {node?.kind === 'house' && <HouseForm house={node} />}
      {node?.kind === 'entry' && <EntryEditor entryId={node.id} />}
      {line && <LineEditor line={line} />}
      {node && node.kind !== 'entry' && <PhotosSection nodeId={node.id} />}
      {node && node.kind !== 'house' && (
        <div className="pad">
          <Field label={t('common.note')}>
            <textarea
              rows={2}
              value={node.note}
              onChange={(e) => editNode(node.id, node.kind, (n) => void (n.note = e.target.value), 'note')}
            />
          </Field>
        </div>
      )}
      <div className="pad">
        <button className="danger" onClick={() => deleteSelection(true)}>
          {line ? t('inspector.deleteLine') : t('inspector.deleteObject')}
        </button>
        {node && (
          <span className="muted small"> {node.coords[1].toFixed(6)}, {node.coords[0].toFixed(6)}</span>
        )}
      </div>
    </div>
  );
}
