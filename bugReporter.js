/**
 * bugReporter.js
 * Drop-in client-side bug reporting module.
 * Converted from bugReporter.ts for use without a build step.
 */

function _brNow() {
  return new Date().toISOString();
}

function _brSerialize(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); }
      catch { return String(a); }
    })
    .join(' ');
}

function _brByteSize(str) {
  return new TextEncoder().encode(str).length;
}

async function _brCompressScreenshot(canvas, quality, budgetBytes) {
  let q = Math.min(1, Math.max(0.15, quality));
  for (let attempt = 0; attempt < 7; attempt++) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    if (_brByteSize(dataUrl) <= budgetBytes) return dataUrl;
    q = parseFloat((q * 0.65).toFixed(2));
    if (q < 0.1) break;
  }
  const scaled = document.createElement('canvas');
  scaled.width = Math.floor(canvas.width * 0.5);
  scaled.height = Math.floor(canvas.height * 0.5);
  const ctx = scaled.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  const fallback = scaled.toDataURL('image/jpeg', 0.6);
  if (_brByteSize(fallback) <= budgetBytes) return fallback;
  return undefined;
}

class BugReporter {
  constructor(config) {
    this.config = {
      appName: 'App',
      customDataReserveKb: 300,
      screenshotQuality: 0.75,
      maxLogs: 200,
      captureErrors: true,
      ...config,
    };
    this.logs = [];
    this.errors = [];
    this.initialized = false;
    this.cooldownUntil = 0;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this._patchConsole();
    if (this.config.captureErrors) {
      window.addEventListener('error', (e) => {
        this.errors.push({ message: e.message, stack: e.error?.stack, timestamp: _brNow() });
      });
      window.addEventListener('unhandledrejection', (e) => {
        const message = e.reason instanceof Error ? e.reason.message : String(e.reason);
        const stack = e.reason instanceof Error ? e.reason.stack : undefined;
        this.errors.push({ message: `Unhandled Promise: ${message}`, stack, timestamp: _brNow() });
      });
    }
  }

  async send(customData) {
    if (Date.now() < this.cooldownUntil) {
      const secsLeft = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      return { ok: false, error: `Rate limited — try again in ${secsLeft}s` };
    }
    const reserveBytes = this.config.customDataReserveKb * 1024;
    const textOnlyReport = {
      timestamp: _brNow(),
      appName: this.config.appName,
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      consoleLogs: [...this.logs],
      errors: [...this.errors],
      customData,
    };
    const textBytes = _brByteSize(JSON.stringify(textOnlyReport));
    const screenshotBudget = Math.max(reserveBytes - textBytes, 100 * 1024);
    const screenshot = await this._captureScreenshot(screenshotBudget);
    const report = { ...textOnlyReport, screenshot };
    const body = JSON.stringify(report);
    try {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) {
        this.cooldownUntil = Date.now() + 30000;
      }
      return { ok: res.ok, status: res.status, payloadKb: Math.round(_brByteSize(body) / 1024) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  flush() { this.logs = []; this.errors = []; }
  getLogs() { return this.logs; }
  getErrors() { return this.errors; }

  _patchConsole() {
    const levels = ['log', 'info', 'warn', 'error', 'debug'];
    for (const level of levels) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        this.logs.push({ level, message: _brSerialize(args), timestamp: _brNow() });
        if (this.logs.length > this.config.maxLogs) this.logs.shift();
      };
    }
  }

  async _captureScreenshot(budgetBytes) {
    try {
      const h2c = window.html2canvas;
      if (!h2c) return undefined;
      const canvas = await h2c(document.body, {
        useCORS: true, allowTaint: true, logging: false,
        scale: window.devicePixelRatio ?? 1,
      });
      return await _brCompressScreenshot(canvas, this.config.screenshotQuality, budgetBytes);
    } catch (err) {
      console.warn('[BugReporter] Screenshot capture failed:', err);
      return undefined;
    }
  }
}
