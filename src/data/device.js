// Browser, OS and screen of the participant's device, recorded once per
// session (docs/11-technical-plan.md, 5.1). Nothing here points to a person
// or a place: no time zone, language or location. The browser cannot tell a
// mouse from a touchpad, so that is asked in the questionnaire.

const BROWSERS = [
  ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
  ['Opera', /OPR\/([\d.]+)/],
  ['Yandex', /YaBrowser\/([\d.]+)/],
  ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
  ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
  ['Safari', /Version\/([\d.]+).*Safari\//],
];

export function detectBrowser(userAgent) {
  for (const [name, pattern] of BROWSERS) {
    const match = userAgent.match(pattern);
    if (match) return { name, version: match[1] };
  }
  return { name: 'other', version: '' };
}

export function detectOs(userAgent, touchPoints = 0) {
  if (/Windows NT/.test(userAgent)) return 'Windows';
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  // Safari on iPad presents itself as a Mac; only touch support gives it away.
  if (/Macintosh/.test(userAgent)) return touchPoints > 1 ? 'iPadOS' : 'macOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/CrOS/.test(userAgent)) return 'ChromeOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'other';
}

export function deviceInfo() {
  const userAgent = navigator.userAgent;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const browser = detectBrowser(userAgent);
  const matches = (query) => (window.matchMedia(query).matches ? 1 : 0);
  return {
    device_browser: browser.name,
    device_browser_version: browser.version,
    device_os: detectOs(userAgent, touchPoints),
    device_user_agent: userAgent,
    device_screen_w: screen.width,
    device_screen_h: screen.height,
    device_window_w: window.innerWidth,
    device_window_h: window.innerHeight,
    device_pixel_ratio: window.devicePixelRatio,
    device_touch_points: touchPoints,
    device_pointer_fine: matches('(pointer: fine)'),
    device_any_pointer_coarse: matches('(any-pointer: coarse)'),
  };
}
