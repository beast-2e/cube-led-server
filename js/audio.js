const $ = document.querySelector.bind(document);

const ipInputEl = $('#ip-input');
const connectBtn = $('#connect-button');
const connectStatusEl = $('#connect-status');

class MicrophoneFFT {
  constructor(fftSize = 2048) {
    this.fftSize = fftSize;
    this.sampleRate = 48000;
    this.analyser = null;
    this.dataArray = null;
    this.animationId = null;

    // Bounds, in Hz
    // TODO: allow editing
    this.bassRangeHz = [20, 250];
    this.midRangeHz = [250, 4000];
    this.trebleRangeHz = [4000, 20000];

    fetch('http://kv.wfeng.dev/esp:ip').then(async (res) => {
      this.server_ip = await res.text();
      ipInputEl.value = this.server_ip;
      this.connect();
    });

    window.connect = () => this.connect();
    // Throttling
    this.lastSent = 0;
  }

  connect() {
    // Get IP address input
    this.server_ip = document.getElementById('ip-input').value;

    if (this.ws) this.ws.close();
    this.ws = new WebSocket(`ws://${this.server_ip}/ws`);
    this.ws.onopen = () => {
      console.log(`Connected to server at ${this.server_ip}`);
      connectStatusEl.textContent = 'Connected';
    }
    this.ws.onclose = () => {
      console.log('Disconnected from server');
      connectStatusEl.textContent = 'Disconnected';
    }
  }

  hzRangeToIdxs([low, high]) {
    return [
      Math.floor((this.fftSize * low) / this.sampleRate),
      Math.ceil((this.fftSize * high) / this.sampleRate),
    ];
  }

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({ sampleRate: this.sampleRate });
      const source = audioContext.createMediaStreamSource(stream);

      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.3;
      source.connect(this.analyser);

      if (this.analyser.sampleRate !== this.sampleRate) {
        console.warn(
          'Sample rate mismatch:',
          this.analyser.sampleRate,
          this.sampleRate
        );
      }

      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this._tick();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      throw err;
    }
  }

  getEnergy(bounds) {
    const indices = this.hzRangeToIdxs(bounds);
    let totalEnergy = 0;
    for (let i = indices[0]; i < indices[1]; i++) {
      totalEnergy += (this.dataArray[i] / 255) ** 2;
    }
    return Math.sqrt(totalEnergy / (indices[1] - indices[0]));
  }

  _tick() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);
    this.animationId = requestAnimationFrame(() => this._tick());

    // Get bass, midrange, treble frequencies
    // FOR NOW, get the net energy

    let bassEnergy = this.getEnergy(this.bassRangeHz);
    let midrangeEnergy = this.getEnergy(this.midRangeHz);
    let trebleEnergy = this.getEnergy(this.trebleRangeHz);

    let bassWidth = Math.max(0.1, bassEnergy * 100);
    let midrangeWidth = Math.max(0.1, midrangeEnergy * 100);
    let trebleWidth = Math.max(0.1, trebleEnergy * 100);

    document.querySelector('#red-bar').style.width = `${bassWidth}%`;
    document.querySelector('#green-bar').style.width = `${midrangeWidth}%`;
    document.querySelector('#blue-bar').style.width = `${trebleWidth}%`;

    // Send stuff to websocket
    try {
      if (performance.now() - this.lastSent < 32) return;
      this.lastSent = performance.now();

      this.ws.send(
        new Uint8ClampedArray([
          Math.max(1, bassEnergy * 255),
          Math.max(1, midrangeEnergy * 255),
          Math.max(1, trebleEnergy * 255),
        ]).buffer
      );
    } catch (err) {
      // console.error('WebSocket send error:', err);
    }
  }
}

const micFFT = new MicrophoneFFT();
micFFT.start().catch(console.error);
