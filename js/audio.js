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
    this.bassRangeHz = [20, 250];
    this.midRangeHz = [250, 4000];
    this.trebleRangeHz = [4000, 20000];

    this.server_ips = []; // now an array
    this.ws = []; // array of websocket connections

    // Fetch both endpoints
    Promise.all([
      fetch('https://kv.wfeng.dev/esp:ip').then((r) => r.text()),
      fetch('https://kv.wfeng.dev/esp:ip:cube').then((r) => r.text()),
    ]).then(([ip1, ip2]) => {
      this.server_ips = [ip1.trim(), ip2.trim()];
      ipInputEl.value = this.server_ips.join(', ');
      this.connect();
    });

    window.connect = () => this.connect();
    this.lastSent = 0;
  }

  connect() {
    // Get IP addresses input (comma-separated)
    this.server_ips = document
      .getElementById('ip-input')
      .value.split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    // Close existing sockets
    this.ws.forEach((sock) => sock.close());
    this.ws = [];

    // Open new sockets
    this.server_ips.forEach((ip) => {
      const sock = new WebSocket(`ws://${ip}/ws`);
      sock.onopen = () => {
        console.log(`Connected to server at ${ip}`);
        connectStatusEl.textContent = 'Connected';
      };
      sock.onclose = () => {
        console.log(`Disconnected from server at ${ip}`);
        connectStatusEl.textContent = 'Disconnected';
      };
      this.ws.push(sock);
    });
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

    let bassEnergy = this.getEnergy(this.bassRangeHz);
    let midrangeEnergy = this.getEnergy(this.midRangeHz);
    let trebleEnergy = this.getEnergy(this.trebleRangeHz);

    let bassWidth = Math.max(0.1, bassEnergy * 100);
    let midrangeWidth = Math.max(0.1, midrangeEnergy * 100);
    let trebleWidth = Math.max(0.1, trebleEnergy * 100);

    document.querySelector('#red-bar').style.width = `${bassWidth}%`;
    document.querySelector('#green-bar').style.width = `${midrangeWidth}%`;
    document.querySelector('#blue-bar').style.width = `${trebleWidth}%`;

    try {
      if (performance.now() - this.lastSent < 32) return;
      this.lastSent = performance.now();

      const payload = new Uint8ClampedArray([
        Math.max(1, bassEnergy * 255),
        Math.max(1, midrangeEnergy * 255),
        Math.max(1, trebleEnergy * 255),
      ]).buffer;

      // Send to all connected WebSockets
      this.ws.forEach((sock) => {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(payload);
        }
      });
    } catch (err) {
      // ignore send errors
    }
  }
}

const micFFT = new MicrophoneFFT();
micFFT.start().catch(console.error);
