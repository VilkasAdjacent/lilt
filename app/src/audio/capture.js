// Microphone capture + per-frame analysis.
//
// Path: getUserMedia (all processing OFF) -> AudioContext -> AudioWorklet
// (fallback: ScriptProcessorNode) -> 1024-sample blocks on the main thread ->
// analysis-host.js -> module Web Worker (fallback: main thread) keeps the
// 2048-sample sliding frame and runs analysis/index.js -> 'frame' events.
// Recording (PCM chunks) stays on the main thread. Audio never leaves the device.
//
// If neither node type works we still allow recording via MediaRecorder
// (mime picked from a fallback list), but live analysis is unavailable.

import { createAnalysisHost } from './analysis-host.js';
import { concatFloat32 } from './wav.js';

export const CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* old Safari */ }
  }
  return ''; // let the browser choose
}

/** Which of the "please turn this off" constraints the browser ignored. */
export function ignoredConstraints(track) {
  const s = (track && track.getSettings && track.getSettings()) || {};
  return ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((k) => s[k] === true);
}

const BLOCK = 1024;

class Mic extends EventTarget {
  constructor() {
    super();
    this.running = false;
    this.mode = null;          // 'worklet' | 'script' | 'mediarecorder'
    this.sampleRate = 48000;
    this.ignored = [];
    this.analyzerChoice = {};
    this._host = null;         // created on first start (Worker or main-thread analysis)
    this._rec = null;
    this.startedAt = 0;
  }

  setAnalyzer(choice) {
    this.analyzerChoice = choice || {};
    if (this.running && this._host) this._host.setChoice(this.analyzerChoice);
  }

  /** 'worker' | 'main' | null (before the first start). */
  get analysisMode() { return this._host ? this._host.mode : null; }

  /** Must be called from a user gesture (click/tap) for iOS/Chrome autoplay rules. */
  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot access the microphone here. (It needs https or localhost.)');
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    // Create + resume the context synchronously inside the gesture, before awaiting.
    this.ctx = AC ? new AC() : null;
    const resumed = this.ctx ? this.ctx.resume() : Promise.resolve();
    this.stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    await resumed;
    const track = this.stream.getAudioTracks()[0];
    this.ignored = ignoredConstraints(track);

    if (this.ctx) {
      this.sampleRate = this.ctx.sampleRate;
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0; // nodes must reach destination to be pulled; keep it silent
      this.sink.connect(this.ctx.destination);
      try {
        if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('no worklet');
        await this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
        this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
          processorOptions: { blockSize: BLOCK },
        });
        this.node.port.onmessage = (e) => this._onBlock(e.data);
        this.mode = 'worklet';
      } catch (err) {
        if (this.ctx.createScriptProcessor) {
          this.node = this.ctx.createScriptProcessor(BLOCK, 1, 1);
          this.node.onaudioprocess = (e) => this._onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
          this.mode = 'script';
        }
      }
      if (this.node) {
        this.source.connect(this.node);
        this.node.connect(this.sink);
      }
    }
    if (!this.node) this.mode = 'mediarecorder';
    if (!this._host) {
      this._host = createAnalysisHost((res) => this._onResult(res), {
        onModeChange: () => this.dispatchEvent(new Event('state')),
      });
    }
    this._host.configure(this.sampleRate, this.analyzerChoice);
    this.running = true;
    this.startedAt = performance.now();
    this._t = 0;
    this.dispatchEvent(new Event('state'));
  }

  stop() {
    if (!this.running) return;
    if (this._rec) this.stopRecording();
    try { this.node && this.node.disconnect(); } catch { /* ignore */ }
    try { this.source && this.source.disconnect(); } catch { /* ignore */ }
    this.stream && this.stream.getTracks().forEach((t) => t.stop());
    this.ctx && this.ctx.close().catch(() => {});
    this.node = this.source = this.stream = this.ctx = null;
    this.running = false;
    this.dispatchEvent(new Event('state'));
  }

  _onBlock(block) {
    if (!this.running) return;
    this._t += block.length / this.sampleRate;
    const keep = !!(this._rec && this._rec.kind === 'pcm');
    if (keep) this._rec.chunks.push(block);
    // The host slides the 2048-sample frame and analyses it (in the Worker the
    // block's buffer is transferred, or a copy of it when we keep it for recording).
    this._host.push(block, this._t, keep);
  }

  _onResult(res) {
    if (!this.running) return;
    const rec = this._rec;
    if (rec && res.t > rec.t0) rec.trace.push([+(res.t - rec.t0).toFixed(3), round1(res.f0), round1(res.dbfs), round2(res.weight), round0(res.f1), round0(res.f2)]);
    this.dispatchEvent(new CustomEvent('frame', { detail: res }));
  }

  get recording() { return !!this._rec; }

  startRecording() {
    if (!this.running) throw new Error('mic not running');
    if (this.mode === 'mediarecorder') {
      const mime = pickRecorderMime();
      const mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      const parts = [];
      mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
      mr.start(250);
      this._rec = { kind: 'mr', mr, parts, trace: [], t0: this._t, started: Date.now() };
    } else {
      this._rec = { kind: 'pcm', chunks: [], trace: [], t0: this._t, started: Date.now() };
    }
    this.dispatchEvent(new Event('state'));
  }

  /** Resolves to { kind: 'pcm', samples, sampleRate, trace } or { kind: 'blob', blob, trace }. */
  stopRecording() {
    const rec = this._rec;
    this._rec = null;
    this.dispatchEvent(new Event('state'));
    if (!rec) return Promise.resolve(null);
    if (rec.kind === 'pcm') {
      return Promise.resolve({ kind: 'pcm', samples: concatFloat32(rec.chunks), sampleRate: this.sampleRate, trace: rec.trace, started: rec.started });
    }
    return new Promise((resolve) => {
      rec.mr.onstop = () => resolve({ kind: 'blob', blob: new Blob(rec.parts, { type: rec.mr.mimeType || 'audio/webm' }), trace: rec.trace, started: rec.started });
      rec.mr.stop();
    });
  }
}

const round0 = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

export const mic = new Mic();
