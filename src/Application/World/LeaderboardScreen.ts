import * as THREE from 'three';
import MonitorScreen from './MonitorScreen';
import { EventBus } from '../UI/EventBus';

/** Persistent wall content; only visiting Play or requesting refresh reads scores. */
export default class LeaderboardScreen extends MonitorScreen {
  private active = false;
  private night = false;
  private loaded = false;
  private dirty = true;
  private readonly offUpdated: () => void;
  private readonly onLoad = () => { this.loaded = true; this.send(); };
  private readonly onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== this.iframe.contentWindow || event.data?.type !== 'leaderboard-ready') return;
    this.loaded = true;
    this.send();
  };

  constructor(anchor: THREE.Object3D) {
    super(anchor, { id: 'leaderboardScreen', src: '/leaderboard.html', title: 'bbangjo · Leaderboard',
      width: 2.3, height: 2.78, pixels: 720, mobilePixels: 420 });
    this.iframe.addEventListener('load', this.onLoad);
    window.addEventListener('message', this.onMessage);
    this.offUpdated = EventBus.on('leaderboard-updated', () => {
      this.dirty = true;
      if (this.active) this.send();
    });
  }

  setDisplay(active: boolean, night: boolean) {
    if (this.active === active && this.night === night) return;
    if (active && !this.active) this.dirty = true;
    this.active = active;
    this.night = night;
    this.send();
  }

  private send() {
    if (!this.loaded) return;
    this.iframe.contentWindow?.postMessage({ type: 'leaderboard-display', active: this.active,
      night: this.night, refresh: this.active && this.dirty }, window.location.origin);
    if (this.active) this.dirty = false;
  }

  dispose() {
    this.offUpdated();
    this.iframe.removeEventListener('load', this.onLoad);
    window.removeEventListener('message', this.onMessage);
    super.dispose();
  }
}
