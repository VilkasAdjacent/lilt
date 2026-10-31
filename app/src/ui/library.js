// Library: list of saved clips, detail view with full trace, playback
// (or visuals-only replay), WAV export and delete.

import { listRecordings, getRecording, deleteRecording } from '../store/db.js';
import { settings, activeBands } from '../settings.js';
import { fmtDuration, summarize } from '../summary.js';
import { drawPitchTrace, sparklineSvg } from './draw.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let openRec = null, audio = null, audioUrl = null, playRaf = 0, visualStart = 0, visualPlaying = false;

const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–');
const hz = (v) => (Number.isFinite(v) ? `${Math.round(v)} Hz` : '–');

export function statsGrid(s) {
  const g = document.createElement('div');
  g.className = 'detail-stats';
  const items = [
    ['typical pitch', hz(s.f0Median)],
    ['pitch range', Number.isFinite(s.f0P10) ? `${Math.round(s.f0P10)}–${Math.round(s.f0P90)}` : '–'],
    ['time in band', pct(s.inBandFrac)],
    ['loud moments that were light', pct(s.loudLightFrac)],
    ['typical weight', Number.isFinite(s.weightMedian) ? s.weightMedian.toFixed(2) : '–'],
    ['typical loudness', Number.isFinite(s.dbfsMedian) ? `${Math.round(s.dbfsMedian)} dBFS` : '–'],
  ];
  for (const [k, v] of items) {
    const d = document.createElement('div');
    const sp = document.createElement('span'); sp.textContent = k;
    const b = document.createElement('b'); b.textContent = v;
    d.append(sp, b);
    g.appendChild(d);
  }
  return g;
}

const dateFmt = (ms) => {
  try { return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return new Date(ms).toISOString(); }
};

async function renderList() {
  let recs = [];
  try { recs = await listRecordings(); } catch (err) { console.warn(err); }
  const list = $('libList');
  list.replaceChildren();
  $('libEmpty').hidden = recs.length > 0;
  for (const r of recs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card clip';
    const t = document.createElement('div'); t.className = 'clip-title'; t.textContent = dateFmt(r.created);
    const m = document.createElement('div'); m.className = 'clip-meta';
    m.textContent = `${fmtDuration(r.duration)} · ${hz(r.summary && r.summary.f0Median)}`;
    b.append(t, m, sparklineSvg(r.trace || []));
    b.addEventListener('click', () => openDetail(r.id));
    list.appendChild(b);
  }
}

function stopPlayback() {
  if (audio) { audio.pause(); audio = null; }
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  cancelAnimationFrame(playRaf); playRaf = 0; visualPlaying = false;
}

function drawDetail(playhead = null) {
  const r = openRec;
  if (!r) return;
  const pts = (r.trace || []).map(([t, f0]) => ({ t, f0: f0 > 0 ? f0 : NaN }));
  drawPitchTrace($('detailTrace'), pts, 0, Math.max(0.5, r.duration), { playhead });
}

async function openDetail(id) {
  stopPlayback();
  const r = await getRecording(id);
  if (!r) return;
  openRec = r;
  $('libDetail').hidden = false;
  $('detailTitle').textContent = dateFmt(r.created);
  const s = r.summary || summarize(r.trace || [], activeBands(), settings);
  $('detailStats').replaceWith(Object.assign(statsGrid(s), { id: 'detailStats' }));
  const btns = $('detailBtns');
  btns.replaceChildren();
  const mk = (label, cls, fn) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = `btn btn-small ${cls}`; b.textContent = label;
    b.addEventListener('click', fn); btns.appendChild(b); return b;
  };
  if (settings.playback === 'audio') {
    const play = mk('▶ Play', 'btn-soft', () => {
      if (audio && !audio.paused) { stopPlayback(); play.textContent = '▶ Play'; drawDetail(); return; }
      stopPlayback();
      audioUrl = URL.createObjectURL(r.blob);
      audio = new Audio(audioUrl);
      audio.onended = () => { play.textContent = '▶ Play'; stopPlayback(); drawDetail(); };
      audio.play().catch((e) => ctx.toast(`Couldn't play (${e.message || e})`));
      play.textContent = '■ Stop';
      const loop = () => { if (!audio) return; drawDetail(audio.currentTime); playRaf = requestAnimationFrame(loop); };
      loop();
    });
  }
  const vis = mk('✦ Replay visuals', 'btn-soft', () => {
    if (visualPlaying) { stopPlayback(); vis.textContent = '✦ Replay visuals'; drawDetail(); return; }
    stopPlayback();
    visualPlaying = true; visualStart = performance.now(); vis.textContent = '■ Stop';
    const loop = () => {
      const t = (performance.now() - visualStart) / 1000;
      if (!visualPlaying || t > r.duration) { visualPlaying = false; vis.textContent = '✦ Replay visuals'; drawDetail(); return; }
      drawDetail(t); playRaf = requestAnimationFrame(loop);
    };
    loop();
  });
  mk('⤓ Export', 'btn-ghost', () => {
    const ext = r.mime === 'audio/wav' ? 'wav' : r.mime.includes('mp4') ? 'm4a' : r.mime.includes('ogg') ? 'ogg' : 'webm';
    const d = new Date(r.created);
    const name = `lilt-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.${ext}`;
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  let armed = false;
  const del = mk('Delete', 'btn-danger', async () => {
    if (!armed) { armed = true; del.textContent = 'Tap again to delete'; setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 3500); return; }
    stopPlayback();
    await deleteRecording(r.id);
    closeDetail();
    renderList();
    ctx.toast('Deleted. Poof! ✨', [], 2500);
  });
  drawDetail();
  $('libDetail').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function closeDetail() { stopPlayback(); openRec = null; $('libDetail').hidden = true; }

export function init(c) {
  ctx = c;
  $('detailClose').addEventListener('click', closeDetail);
  window.addEventListener('resize', () => openRec && !playRaf && drawDetail());
}
export function show() { renderList(); }
export function hide() { closeDetail(); }
export const refresh = renderList;
