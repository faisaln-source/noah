function stamp(seconds, vtt = false) {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(milliseconds / 3600000);
  const m = Math.floor(milliseconds / 60000) % 60;
  const s = Math.floor(milliseconds / 1000) % 60;
  return `${[h, m, s].map(n => String(n).padStart(2, '0')).join(':')}${vtt ? '.' : ','}${String(milliseconds % 1000).padStart(3, '0')}`;
}
export function serializeCaptions(captions, vtt = false) {
  return (vtt ? 'WEBVTT\n\n' : '') + captions.map((caption, index) => `${vtt ? '' : `${index + 1}\n`}${stamp(caption.start, vtt)} --> ${stamp(caption.end, vtt)}\n${caption.text}\n`).join('\n');
}
export function parseSrt(text) {
  const seconds = value => {
    const [h, m, s] = value.replace(',', '.').split(':').map(Number);
    return h * 3600 + m * 60 + s;
  };
  return text.replace(/\r/g, '').trim().split(/\n\s*\n/).flatMap(block => {
    const match = block.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]*)/);
    return match ? [{ start: seconds(match[1]), end: seconds(match[2]), text: match[3].trim() }] : [];
  });
}
function assTime(seconds) { return stamp(seconds, true).slice(1, -1); }
function escapeAss(text) { return text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N'); }
export function captionWords(caption) {
  if (caption.words?.length) return caption.words;
  const text = caption.text.trim().split(/\s+/).filter(Boolean);
  return text.map((word, index) => ({ text: word, start: caption.start + (caption.end - caption.start) * index / text.length, end: caption.start + (caption.end - caption.start) * (index + 1) / text.length }));
}
export function suppliedCaptions(options) {
  if (!options.subtitles?.trim()) return [];
  if (options.captionSegments?.length && serializeCaptions(options.captionSegments).replace(/\r/g, '').trim() === options.subtitles.replace(/\r/g, '').trim()) return options.captionSegments;
  return parseSrt(options.subtitles);
}
function assColor(color, fallback) { return (/^#[0-9a-f]{6}$/i.test(color || '') ? color.slice(1) : fallback).match(/../g).reverse().join('').toUpperCase(); }
function neonCaptions(captions, options, w, h) {
  const primary = assColor(options.captionColor, 'FF70BD');
  const accent = assColor(options.captionHighlightColor, 'FFD08A');
  const font = ['Anton', 'Arial', 'Impact', 'Verdana', 'Trebuchet MS'].includes(options.captionFont) ? options.captionFont : 'Anton';
  const size = Number(options.captionSize) || 72;
  const scale = Number(options.captionRenderScale) || 1;
  const alignment = { top: 8, center: 5, bottom: 2 }[options.captionPosition] || 2;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Neon,${font},${size},&H00${primary},&H00${accent},&H00210A14,&H80000000,0,0,0,0,100,100,${scale},0,1,${4 * scale},${2 * scale},${alignment},${45 * scale},${45 * scale},${Math.round(h * .12)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = [];
  const casing = text => options.captionUppercase === false ? text : text.toUpperCase();
  const mode = options.captionAnimation || 'word-pop';
  for (const caption of captions) {
    const words = captionWords(caption);
    const entries = mode === 'none' ? [{ start: caption.start, end: caption.end, text: escapeAss(casing(caption.text)) }] : words.map((word, index) => ({
      start: Math.max(caption.start, word.start), end: Math.min(caption.end, word.end),
      text: mode === 'reveal' ? words.slice(0, index + 1).map(part => escapeAss(casing(part.text))).join(' ') : mode === 'highlight' ? words.map((part, i) => `{\\1c&H${i === index ? accent : primary}&}${escapeAss(casing(part.text))}`).join(' ') : escapeAss(casing(word.text))
    }));
    for (const entry of entries) {
      if (entry.end <= entry.start) continue;
      const animation = mode === 'none' ? '' : '\\fscx85\\fscy85\\t(0,70,\\fscx108\\fscy108)\\t(70,140,\\fscx100\\fscy100)';
      const text = `{\\fad(20,30)${animation}}${entry.text}`;
      events.push(`Dialogue: 0,${assTime(entry.start)},${assTime(entry.end)},Neon,,0,0,0,,{\\bord${7 * scale}\\blur${8 * scale}\\3c&H8C238E&\\alpha&H65&}${text}\n`);
      events.push(`Dialogue: 1,${assTime(entry.start)},${assTime(entry.end)},Neon,,0,0,0,,${text}\n`);
    }
  }
  return header + events.join('');
}
export function groupCaptions(captions, maximum = 6) {
  const limit = Math.max(1, Math.min(8, Math.round(Number(maximum) || 6)));
  return captions.flatMap(caption => {
    const words = captionWords(caption);
    if (words.length <= limit) return [caption];
    const groups = [];
    for (let i = 0; i < words.length; i += limit) {
      const group = words.slice(i, i + limit);
      groups.push({ start: group[0].start, end: group.at(-1).end, text: group.map(word => word.text).join(' '), words: group });
    }
    return groups;
  });
}
export function assCaptions(captions, options, w, h) {
  captions = groupCaptions(captions, options.captionMaxWords);
  if (options.captionStyle === 'gta6') return neonCaptions(captions, options, w, h);
  const color = /^#[0-9a-f]{6}$/i.test(options.captionColor || '') ? options.captionColor.slice(1) : 'FFFFFF';
  const bgr = color.match(/../g).reverse().join('');
  const font = ['Anton', 'Arial', 'Impact', 'Verdana', 'Trebuchet MS'].includes(options.captionFont) ? options.captionFont : 'Arial';
  const fontSize = Number(options.captionSize) || 54;
  const alignment = { top: 8, center: 5, bottom: 2 }[options.captionPosition] || 2;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${fontSize},&H00${bgr},&H0000FFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,${alignment},40,40,${Math.round(h * .09)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + captions.map(caption => {
    let text = escapeAss(caption.text);
    if (options.captionStyle === 'karaoke' && caption.words?.length) {
      let cursor = caption.start;
      text = caption.words.map(word => {
        const gap = Math.max(0, word.start - cursor);
        const lead = gap > .03 ? `{\\k${Math.round(gap * 100)}} ` : '';
        cursor = word.end;
        return `${lead}{\\kf${Math.max(1, Math.round((word.end - word.start) * 100))}}${escapeAss(word.text)} `;
      }).join('');
    }
    if (options.captionStyle === 'pop') text = `{\\fad(70,70)\\fscx90\\fscy90\\t(0,100,\\fscx100\\fscy100)}${text}`;
    return `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,${text}\n`;
  }).join('');
}
export function retimeCaptions(segments, start, end, offset = 0, speed = 1) {
  return segments.filter(segment => segment.start < end && segment.end > start).flatMap(segment => {
    const words = (segment.words || []).filter(word => word.start < end && word.end > start);
    if (segment.words?.length && !words.length) return [];
    const text = words.length && (segment.start < start || segment.end > end) ? words.map(word => word.text).join(' ') : segment.text;
    return [{
    start: (Math.max(start, segment.start) - start) / speed + offset,
    end: (Math.min(end, segment.end) - start) / speed + offset,
    text,
    words: words.map(word => ({ ...word,
      start: (Math.max(start, word.start) - start) / speed + offset,
      end: (Math.min(end, word.end) - start) / speed + offset
    }))
    }];
  });
}
