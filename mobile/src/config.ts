// QuantumEdge Mobile Backend Configuration
let currentHost = 'http://localhost:3000';
const listeners: ((host: string) => void)[] = [];

export const config = {
  // Get active HTTP REST API URL
  getApiUrl(): string {
    return currentHost.replace(/\/+$/, '');
  },

  // Get active WebSocket URL
  getWsUrl(): string {
    const clean = currentHost.replace(/\/+$/, '');
    if (clean.startsWith('https://')) {
      return clean.replace('https://', 'wss://') + '/ws';
    }
    return clean.replace('http://', 'ws://') + '/ws';
  },

  // Update backend URL at runtime (e.g. from Settings modal)
  setBackendUrl(url: string) {
    if (!url) return;
    let formatted = url.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'http://' + formatted;
    }
    currentHost = formatted;
    listeners.forEach((fn) => fn(currentHost));
  },

  // Subscribe to URL changes to re-connect WebSocket
  onUrlChange(fn: (host: string) => void) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  },
};

