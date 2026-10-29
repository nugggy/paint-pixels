// Gentle sounds (generated with WebAudio, no audio files) and haptics.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { getSettings } from './store';

let ac: AudioContext | null = null;
let lastPop = 0;

function audio() {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function tone(freq: number, dur: number, gain = 0.05, type: OscillatorType = 'sine', delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function pop() {
  if (!getSettings().sound) return;
  const now = performance.now();
  if (now - lastPop < 45) return;
  lastPop = now;
  tone(520 + Math.random() * 160, 0.07, 0.025, 'triangle');
}

export function chime() {
  if (getSettings().sound) [660, 880, 1320].forEach((f, i) => tone(f, 0.25, 0.04, 'sine', i * 0.08));
  if (getSettings().vibrate) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

export function fanfare() {
  if (getSettings().sound) [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.35, 0.05, 'triangle', i * 0.11));
  if (getSettings().vibrate) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export function buzz() {
  if (getSettings().sound) tone(160, 0.12, 0.04, 'square');
  if (getSettings().vibrate) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}
