// Delivers block data to the receiver without losing it (decision 51;
// docs/11-technical-plan.md, 5.5).
//
// Every message is saved in localStorage first and removed only after the
// receiver confirms it. Failed sends are retried with growing pauses, on
// every new message and when the connection comes back. When the page is
// hidden or closed, pending messages go out once more with sendBeacon, which
// the browser delivers even after the tab is gone. Messages left over from an
// earlier visit in this browser are delivered too: that only completes
// delivery and does not resume the session. The receiver ignores repeats, so
// sending a message twice is harmless.

const KEY_PREFIX = 'tmtua.outbox.';
const BEACON_LIMIT_BYTES = 60_000; // browsers cap beacons at about 64 KB

// localStorage may be blocked or full; the in-memory copy then still holds
// the data for as long as the page is open.
function readQueue(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? [];
  } catch {
    return [];
  }
}

function writeQueue(key, bodies) {
  try {
    if (bodies.length) localStorage.setItem(key, JSON.stringify(bodies));
    else localStorage.removeItem(key);
  } catch {
    // keep going with the in-memory copy
  }
}

function storedKeys() {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(KEY_PREFIX));
  } catch {
    return [];
  }
}

// base: { session_id, participant_code, mode, app_version }, sent with every
// message. meta: summary fields added to the first message of the session,
// unless that message sets withoutMeta (e.g. a refused consent).
// onChange({ pending, rejected }) is called whenever the queue changes.
export function createSender({ url, base, meta, timeoutMs, retryBaseMs, retryMaxMs, onChange }) {
  const ownKey = KEY_PREFIX + base.session_id;
  const queues = new Map([[ownKey, readQueue(ownKey)]]);
  for (const key of storedKeys()) if (!queues.has(key)) queues.set(key, readQueue(key));

  let pendingMeta = meta;
  let seq = 0; // message number within the session; beacons can arrive out of order
  let rejected = 0;
  let flushing = null;
  let failures = 0;
  let retryTimer = null;
  let beaconed = new Set();

  const pending = () => [...queues.values()].reduce((sum, bodies) => sum + bodies.length, 0);
  const changed = () => onChange?.({ pending: pending(), rejected });

  // Returns 'done', 'rejected' (the receiver will never accept it) or 'retry'.
  async function post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        signal: controller.signal,
      });
      const reply = await response.json();
      if (reply.ok) return 'done';
      if (reply.permanent) {
        console.error('Receiver rejected a message:', reply.detail, body.slice(0, 300));
        return 'rejected';
      }
      return 'retry';
    } catch {
      return 'retry';
    } finally {
      clearTimeout(timer);
    }
  }

  async function deliverAll() {
    for (;;) {
      const entry = [...queues].find(([, bodies]) => bodies.length);
      if (!entry) return true;
      const [key, bodies] = entry;
      const result = await post(bodies[0]);
      if (result === 'retry') return false;
      if (result === 'rejected') rejected += 1;
      bodies.shift();
      writeQueue(key, bodies);
      changed();
    }
  }

  // Resolves to true once everything is delivered, false if a send failed
  // (a retry is then already scheduled).
  function flush() {
    clearTimeout(retryTimer);
    flushing ??= deliverAll().then((done) => {
      flushing = null;
      if (done) {
        failures = 0;
      } else {
        failures += 1;
        retryTimer = setTimeout(flush, Math.min(retryBaseMs * 2 ** (failures - 1), retryMaxMs));
      }
      return done;
    });
    return flushing;
  }

  function send(block, message) {
    if (!message) return;
    let summary = message.summary;
    if (pendingMeta && !message.withoutMeta) {
      summary = { ...pendingMeta, ...summary };
      pendingMeta = null;
    }
    seq += 1;
    const body = JSON.stringify({
      ...base,
      block,
      seq,
      summary,
      log: message.log,
      contact: message.contact,
    });
    const own = queues.get(ownKey);
    own.push(body);
    writeQueue(ownKey, own);
    changed();
    flush();
  }

  function beaconAll() {
    for (const bodies of queues.values()) {
      for (const body of bodies) {
        const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
        if (blob.size <= BEACON_LIMIT_BYTES && !beaconed.has(body)) {
          beaconed.add(body);
          navigator.sendBeacon(url, blob);
        }
      }
    }
  }

  window.addEventListener('online', flush);
  window.addEventListener('pagehide', beaconAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beaconAll();
    else beaconed = new Set();
  });

  changed(); // leftovers from an earlier visit count from the start
  if (pending()) flush();
  return { send, flush, pending, rejected: () => rejected };
}
