import { useEditor } from './store';
export default function EditorAdjustments() {
  const { timeline, change } = useEditor();
  return <div className="advanced-adjustments"><h3>Fine adjustments</h3>{[
    ['brightness', 'Brightness', -.5, .5, 0], ['contrast', 'Contrast', .5, 2, 1], ['saturation', 'Saturation', 0, 2, 1], ['sharpen', 'Sharpen', 0, 1.5, 0]
  ].map(([key, label, min, max, fallback]) => <label className="field" key={key}><span>{label} · {Number(timeline[key] ?? fallback).toFixed(2)}</span><input aria-label={String(label)} type="range" min={Number(min)} max={Number(max)} step="0.05" value={timeline[key] ?? fallback} onChange={event => change({ [key]: Number(event.target.value) })}/></label>)}
    <label className="field"><span>Rotation</span><select value={timeline.rotation || 0} onChange={event => change({ rotation: Number(event.target.value) })}>{[0,90,180,270].map(value => <option key={value} value={value}>{value} degrees</option>)}</select></label>
    <label className="toggle"><input type="checkbox" checked={!!timeline.mirror} onChange={event => change({ mirror: event.target.checked })}/>Mirror horizontally</label>
    <label className="toggle"><input type="checkbox" checked={!!timeline.vignette} onChange={event => change({ vignette: event.target.checked })}/>Vignette</label>
    <button className="button small" onClick={() => change({ brightness: 0, contrast: 1, saturation: 1, sharpen: 0, rotation: 0, mirror: false, vignette: false })}>Reset fine adjustments</button>
  </div>;
}
