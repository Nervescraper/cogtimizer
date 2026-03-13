class SeededRng {
  constructor(seed) {
    this._s0 = this._splitmix32(seed);
    this._s1 = this._splitmix32(this._s0);
    this._s2 = this._splitmix32(this._s1);
    this._s3 = this._splitmix32(this._s2);
  }

  _splitmix32(seed) {
    seed = (seed + 0x9e3779b9) | 0;
    seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
    return (seed ^ (seed >>> 16)) >>> 0;
  }

  random() {
    const t = this._s3;
    let s = this._s0;
    this._s3 = this._s2;
    this._s2 = this._s1;
    this._s1 = s;
    const t2 = t ^ (t << 11);
    this._s0 = t2 ^ (t2 >>> 8) ^ s ^ (s >>> 19);
    return (this._s0 >>> 0) / 4294967296;
  }

  randInt(max) {
    return Math.floor(this.random() * max);
  }

  pick(arr) {
    return arr[this.randInt(arr.length)];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SeededRng };
}
