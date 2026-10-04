import { store, useStore, type Tool } from '../model/store';
import { setTool } from '../map/interactions';
import { useT, type MessageKey } from '../i18n';

interface ToolDef {
  tool: Tool;
  label: MessageKey;
  icon: string;
}

const GROUPS: { title: MessageKey | null; tools: ToolDef[] }[] = [
  { title: null, tools: [{ tool: { type: 'select' }, label: 'tool.select', icon: '↖' }] },
  {
    title: 'tool.group.nodes',
    tools: [
      { tool: { type: 'node', kind: 'ktp' }, label: 'tool.ktp', icon: '⚡' },
      { tool: { type: 'node', kind: 'pole10' }, label: 'tool.pole10', icon: '◉' },
      { tool: { type: 'node', kind: 'pole04' }, label: 'tool.pole04', icon: '●' },
      { tool: { type: 'node', kind: 'poleService' }, label: 'tool.poleService', icon: '•' },
      { tool: { type: 'node', kind: 'entry' }, label: 'tool.entry', icon: '▼' },
      { tool: { type: 'lamp' }, label: 'tool.lamp', icon: '✹' },
      { tool: { type: 'house' }, label: 'tool.house', icon: '⌂' },
      { tool: { type: 'houseContour' }, label: 'tool.houseContour', icon: '⬠' },
    ],
  },
  {
    title: 'tool.group.lines',
    tools: [
      { tool: { type: 'line', kind: 'line04' }, label: 'tool.line04', icon: '━' },
      { tool: { type: 'line', kind: 'line10' }, label: 'tool.line10', icon: '▬' },
      { tool: { type: 'line', kind: 'drop' }, label: 'tool.drop', icon: '╲' },
      { tool: { type: 'line', kind: 'lighting' }, label: 'tool.lighting', icon: '┅' },
      { tool: { type: 'line', kind: 'fiber' }, label: 'tool.fiber', icon: '┈' },
    ],
  },
];

const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

export function Toolbar() {
  const tr = useT();
  const tool = useStore((s) => s.tool);
  const suspension = useStore((s) => s.suspension);
  return (
    <nav className="toolbar">
      {GROUPS.map((g) => (
        <div key={g.title ?? 'main'} className="tool-group">
          {g.title && <div className="tool-group-title">{tr(g.title)}</div>}
          {g.tools.map((t) => (
            <button
              key={t.label}
              className={same(tool, t.tool) ? 'tool on' : 'tool'}
              onClick={() => setTool(t.tool)}
              title={tr(t.label)}
            >
              <span className="tool-icon">{t.icon}</span>
              <span>{tr(t.label)}</span>
            </button>
          ))}
        </div>
      ))}
      {tool.type === 'line' && tool.kind === 'line04' && (
        <div className="tool-group">
          <div className="tool-group-title">{tr('tool.suspension')}</div>
          <div className="seg">
            <button className={suspension === 'bare' ? 'on' : ''} onClick={() => store.set({ suspension: 'bare' })}>
              {tr('tool.suspension.bare')}
            </button>
            <button className={suspension === 'sip' ? 'on' : ''} onClick={() => store.set({ suspension: 'sip' })}>
              {tr('tool.suspension.sip')}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
