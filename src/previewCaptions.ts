import type { Caption } from './types';
export function parseSrtPreview(text: string): Caption[] {
  const stamp = (value: string) => value.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return text.replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
    const match = block.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]*)/);
    return match ? [{ start: stamp(match[1]), end: stamp(match[2]), text: match[3].trim() }] : [];
  });
}

export function timedPreviewCaptions(text: string, timed?: Caption[]): Caption[] {
  const parsed = parseSrtPreview(text);
  if (timed?.length === parsed.length && timed.every((item, i) => Math.abs(item.start - parsed[i].start) < .002 && Math.abs(item.end - parsed[i].end) < .002 && item.text === parsed[i].text)) return timed;
  return parsed;
}
export function previewWords(caption: Caption) {
  if (caption.words?.length) return caption.words;
  const words = caption.text.trim().split(/\s+/).filter(Boolean);
  return words.map((text, i) => ({ text, start: caption.start + (caption.end - caption.start) * i / words.length, end: caption.start + (caption.end - caption.start) * (i + 1) / words.length }));
}

export function groupPreviewCaptions(captions: Caption[], maximum = 6): Caption[] {
  const limit = Math.max(1, Math.min(8, Math.round(Number(maximum) || 6)));
  return captions.flatMap(caption => {
    const words = previewWords(caption);
    if (words.length <= limit) return [caption];
    const groups: Caption[] = [];
    for (let i = 0; i < words.length; i += limit) {
      const group = words.slice(i, i + limit);
      groups.push({ start: group[0].start, end: group[group.length - 1].end, text: group.map(word => word.text).join(' '), words: group });
    }
    return groups;
  });
}
