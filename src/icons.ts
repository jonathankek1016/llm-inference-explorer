const paths: Record<string, string> = {
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M12 3v9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  pause: '<path d="M9 5v14M16 5v14"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  replay: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  focus: '<circle cx="12" cy="12" r="5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  labels: '<path d="M4 5h16M12 5v14M8 19h8"/>',
  expand: '<path d="M7 17 17 7M7 7h10v10"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  send: '<path d="m3 11 18-8-8 18-2-10-8 0Zm8 0L21 3"/>',
  chat: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  minus: '<path d="M5 12h14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.6 1.6 0 0 1 1.2-2.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="10.5" cy="6.7" r=".7"/><circle cx="15" cy="7.2" r=".7"/>',
};
export const icon = (name: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;
