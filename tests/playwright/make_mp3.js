// Fabrique un MP3 de test : 3 s d'« intro » très douce (100 Hz), puis 5 notes de 1 s (440, 660, 880, 660, 440 Hz) bien plus fortes. Stéréo 44,1 kHz, 128 kbit/s.
const fs = require('fs'), path = require('path');
const code = fs.readFileSync('/home/user/trainhub/lamejs.iife.js', 'utf8');
const lamejs = new Function(code + '; return lamejs;')();
const sr = 44100, notes = [440, 660, 880, 660, 440];
const total = sr * 8, L = new Int16Array(total), R = new Int16Array(total);
for (let i = 0; i < total; i++) {
    const t = i / sr; let v;
    if (t < 3) v = 0.04 * Math.sin(2 * Math.PI * 100 * t);
    else v = 0.6 * Math.sin(2 * Math.PI * notes[Math.min(4, Math.floor(t - 3))] * t);
    L[i] = Math.round(v * 32767); R[i] = Math.round(v * 0.8 * 32767);
}
const enc = new lamejs.Mp3Encoder(2, sr, 128), parts = [];
for (let p = 0; p < total; p += 1152) { const c = enc.encodeBuffer(L.subarray(p, p + 1152), R.subarray(p, p + 1152)); if (c.length) parts.push(Buffer.from(c)); }
const e = enc.flush(); if (e.length) parts.push(Buffer.from(e));
const out = path.join(__dirname, 'media', 'backing_test.mp3');
fs.writeFileSync(out, Buffer.concat(parts));
console.log(out, fs.statSync(out).size, 'octets');
