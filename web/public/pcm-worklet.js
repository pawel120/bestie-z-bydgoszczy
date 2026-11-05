// Downsamples the microphone to 16 kHz mono Int16 and posts ~100 ms chunks to the main thread.
const TARGET_RATE = 16_000;
const CHUNK_SAMPLES = 1_600;

class PcmCapture extends AudioWorkletProcessor {
  ratio = sampleRate / TARGET_RATE;
  acc = 0;
  accCount = 0;
  pos = 0;
  out = new Int16Array(CHUNK_SAMPLES);
  outLen = 0;

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
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
