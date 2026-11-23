/**
 * 花纹噪声合成：节距边界脉冲 → 带通滤波 → 包络整形，Web Audio 实时播放。
 * 两套序列可各建一个声部，A/B 对比着听。
 */
import type { PitchSequence } from '../core/types';
import { totalLength } from '../core/sequence';

export interface NoiseVoice {
  play(speedKmh: number, rollingRadiusMm: number): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Set<{ stop: () => void }>();

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 用一段离线渲染生成循环缓冲：节距通过频率脉冲经带通滤波，模拟花纹泵气噪声 */
  private renderBuffer(seq: PitchSequence, speedKmh: number, rollingRadiusMm: number, seconds = 2): AudioBuffer {
    const sr = 44100;
    const ctx = this.ensureCtx();
    const buf = ctx.createBuffer(1, sr * seconds, sr);
    const data = buf.getChannelData(0);
    const vMmS = (speedKmh * 1_000_000) / 3600;
    const fRot = vMmS / (2 * Math.PI * Math.max(rollingRadiusMm, 1));
    const total = totalLength(seq);
    const lenMap = new Map(seq.pitchTypes.map((p) => [p.id, p.length]));

    // 每转的节距边界相位（0..1）
    const boundaries: number[] = [];
    let x = 0;
    for (const id of seq.pitchIds) {
      boundaries.push(x / total);
      x += lenMap.get(id) ?? 0;
    }
    const revs = fRot * seconds;
    // 脉冲宽度随速度变化（更高速 → 更脆）
    const pulseWidth = Math.max(2, Math.floor(sr / (fRot * seq.pitchIds.length * 4)));

    for (let rev = 0; rev < Math.ceil(revs); rev++) {
      for (const ph of boundaries) {
        const t = (rev + ph) / fRot;
        const center = Math.floor(t * sr);
        for (let k = -pulseWidth * 3; k <= pulseWidth * 3; k++) {
          const idx = center + k;
          if (idx < 0 || idx >= data.length) continue;
          const env = Math.exp(-Math.abs(k) / pulseWidth);
          // 随机极性+小幅抖动，避免过强周期音
          data[idx]! += env * (Math.random() * 0.8 + 0.2) * (Math.random() > 0.5 ? 1 : -1);
        }
      }
    }
    // 简单一阶带通（800~2500 Hz 胎噪主能量带）
    let prevIn = 0;
    let prevOut = 0;
    const lp = 2 * Math.PI * 2500 / sr;
    const hpAlpha = (2 * Math.PI * 800) / sr;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      const low = prevOut + lp * (v - prevOut);
      prevOut = low;
      const high = low - (prevIn + hpAlpha * (low - prevIn));
      prevIn = low;
      data[i] = high * 3;
    }
    return buf;
  }

  createVoice(seq: PitchSequence): NoiseVoice {
    let node: AudioBufferSourceNode | null = null;
    const self = this;
    return {
      async play(speedKmh, rollingRadiusMm) {
        this.stop();
        const ctx = self.ensureCtx();
        const buf = self.renderBuffer(seq, speedKmh, rollingRadiusMm);
        node = ctx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0.9;
        node.connect(g);
        g.connect(self.master!);
        node.start();
        const handle = {
          stop: () => {
            try {
              node?.stop();
            } catch {
              /* already stopped */
            }
            node?.disconnect();
            g.disconnect();
          },
        };
        self.active.add(handle);
        node.onended = () => self.active.delete(handle);
      },
      stop() {
        if (node) {
          try {
            node.stop();
          } catch {
            /* noop */
          }
        }
      },
      isPlaying() {
        return node !== null;
      },
    };
  }

  setMasterVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  dispose(): void {
    for (const h of this.active) h.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
