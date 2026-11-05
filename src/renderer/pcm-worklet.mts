// AudioWorklet: downsamples the input to 16 kHz mono Int16 and posts ~100 ms chunks to the main thread.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const TARGET_RATE = 16_000;
const CHUNK_SAMPLES = 1_600; // 100 ms

class PcmCapture extends AudioWorkletProcessor {
  private ratio = sampleRate / TARGET_RATE;
  private acc = 0;
  private accCount = 0;
  private pos = 0;
  private out = new Int16Array(CHUNK_SAMPLES);
  private outLen = 0;

  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frames = channels[0].length;

    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      // Box-filter decimation: average all input samples that fall into one output sample.
      this.acc += sample / channels.length;
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const value = Math.max(-1, Math.min(1, this.acc / this.accCount));
        this.out[this.outLen++] = value < 0 ? value * 0x8000 : value * 0x7fff;
        this.acc = 0;
        this.accCount = 0;
        if (this.outLen === CHUNK_SAMPLES) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(CHUNK_SAMPLES);
          this.outLen = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
