import { create } from 'zustand';
import {persist} from 'zustand/middleware';
import type { Timeline, Options } from './types';
export const defaults: Options = { qualityPolicyVersion: 2, quality: 'lossless', title: 'My gaming highlights', ratio: '9:16', resolution: 1080, fps: 0, preset: 'viral', effect: 'vivid', fit: 'cover', speed: 1, volume: 1, zoom: true, shake: false, fade: true, normalize: true, removeSilence: false, smartCrop: false, cropX: .5, cropY: .5, captionStyle: 'pop', captionFont: 'Arial', captionSize: 54, captionColor: '#ffffff', captionPosition: 'bottom', captions: true, overlay: '', watermark: '', musicId: '', musicVolume: .15, transition: 'none', encoder: 'cpu', bitrate: 0 };
const initial: Timeline = { ...defaults, clips: [] };
type Store = { timeline: Timeline; past: Timeline[]; future: Timeline[]; projectId: string; change: (changes: Partial<Timeline>) => void; load: (timeline: Timeline, id?: string) => void; undo: () => void; redo: () => void };
export const useEditor = create<Store>()(persist((set) => ({
  timeline: initial, past: [], future: [], projectId: '',
  change: changes => set(state => ({ past: [...state.past.slice(-49), structuredClone(state.timeline)], future: [], timeline: { ...state.timeline, ...changes } })),
  load: (timeline, id = '') => set({ timeline: { ...defaults, ...timeline }, projectId: id, past: [], future: [] }),
  undo: () => set(state => state.past.length ? { timeline: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.timeline, ...state.future] } : state),
  redo: () => set(state => state.future.length ? { timeline: state.future[0], future: state.future.slice(1), past: [...state.past, state.timeline] } : state)
}), {name:'clipforge-editor-draft-v1', partialize: state => ({timeline:state.timeline,projectId:state.projectId})}));
