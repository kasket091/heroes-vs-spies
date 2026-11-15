import './style.css';
import families from '../words/word-families.json';
import { firebaseConfig } from './firebase-config.js';
import { initFirebase, signIn } from './firebase.js';
import * as api from './room.js';
import { isRoomCode } from './game.js';
import { render, settle, friendly, GAME_NAME } from './ui.js';

document.title = GAME_NAME;
const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const onLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
// Dev only: ?dev=NAME gives this tab its own Firebase app, so it signs in as a separate user.
const { auth, db } = initFirebase(firebaseConfig, {
  emulator: onLocalhost,
  name: (onLocalhost && params.get('dev')) || undefined,
});

const ROOM_KEY = 'spy-room';
const remembered = (set) => {
  try {
    if (set === undefined) return localStorage.getItem(ROOM_KEY) || '';
    if (set) localStorage.setItem(ROOM_KEY, set); else localStorage.removeItem(ROOM_KEY);
  } catch { /* no storage: the link still works */ }
  return '';
};
const urlCode = (params.get('room') || '').trim().toUpperCase();
// The bare link goes straight back to the room this browser last used.
const rememberedCode = urlCode ? '' : remembered();
const startCode = urlCode || (isRoomCode(rememberedCode) ? rememberedCode : '');
const s = {
  uid: null,
  code: startCode || null,
  data: startCode ? undefined : null,
  ui: { error: null, runError: null, confirmRemove: null, confirmLeave: false, confirmClose: false, busy: false,
    fields: { name: '', code: urlCode } },
  // When this phone first saw the current state, and this phone's clock: stalled() never reads another phone's time.
  since: null,
  now: Date.now(),
};
let unsubscribe = () => {};
let stopRunner = null;
let checked = false;
let touched = null;
let seenKey = null;
let tick = null;

const stopRoom = () => {
  unsubscribe();
  unsubscribe = () => {};
  if (stopRunner) stopRunner();
  stopRunner = null;
  s.ui.runError = null;
};

let last = null;
const update = () => {
  s.now = Date.now();
  s.ui = settle(last, s);
  last = { ...s, ui: { ...s.ui } };
  render(root, s, actions);
  // The stalled line depends on time: look again each second while it could appear.
  const room = s.data?.room;
  // Never on the host's phone: the host does not see the stalled line.
  const couldStall = room && room.gmUid !== s.uid && (room.phase === 'result' || (room.phase === 'voting' && s.data.waiting?.length === 0));
  if (couldStall && !tick) tick = setTimeout(() => { tick = null; update(); }, 1000);
};

async function run(fn) {
  s.ui.busy = true;
  s.ui.error = null;
  update();
  try {
    await fn();
  } catch (e) {
    s.ui.error = friendly(e);
  } finally {
    s.ui.busy = false;
    update();
  }
}

function openRoom(code) {
  s.code = code;
  remembered(code);
  params.set('room', code);
  history.replaceState(null, '', `?${params}`);
  stopRoom();
  seenKey = null;
  s.data = undefined;
  unsubscribe = api.subscribe(db, code, s.uid, (data) => {
    // A remembered room that is gone, or no longer has this person in it: back to the join form.
    if (startCode === code && !urlCode && !checked) {
      checked = true;
      const inRoom = data.room && data.players.some((p) => p.uid === s.uid);
      const old = data.room && !Array.isArray(data.room.seats);
      if (!inRoom || old) remembered(null);
      // An older-version room stays open so the join form can say so.
      if (!inRoom && !old) { leaveRoom(); return; }
    }
    s.data = data;
    if (touched !== code && data.players.some((p) => p.uid === s.uid)) { touched = code; api.touchPlayer(db, code, s.uid); }
    // The host's phone runs the room in the background; a hand-over moves that to the new host's phone.
    // Not for a room from the older version (no seats).
    const host = data.room?.gmUid === s.uid && Array.isArray(data.room.seats);
    if (host && !stopRunner) {
      const stop = api.runRoom(db, code, s.uid, families, {
        // A step that fails after this runner was stopped or replaced must not leave a stale Problem line.
        onError: (e) => { if (stopRunner !== stop) return; s.ui.runError = e && friendly(e); update(); },
      });
      stopRunner = stop;
    } else if (!host && stopRunner) { stopRunner(); stopRunner = null; s.ui.runError = null; }
    const { room } = data;
    const key = room?.phase === 'voting' ? `voting:${room.round}:${data.waiting.length === 0}` : `${room?.phase}:${room?.round}`;
    if (key !== seenKey) { seenKey = key; s.since = Date.now(); }
    update();
  });
  update();
}

function leaveRoom() {
  stopRoom();
  params.delete('room');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  Object.assign(s, { code: null, data: null });
  update();
}

const voting = () => s.data?.room?.phase === 'voting';

const actions = {
  setField: (name, value) => { s.ui.fields[name] = value; },
  // Remembers an open section without re-rendering: the browser already shows it.
  setOpen: (key, open) => { s.ui[key] = open; },
  create: () => run(async () => openRoom(await api.createRoom(db, s.uid, s.ui.fields.name))),
  join: () => run(async () => {
    const code = s.ui.fields.code.trim().toUpperCase();
    if (!code) throw new Error('Code needed');
    // Not a code the app could have made: never reaches Firestore.
    if (!isRoomCode(code)) throw new Error('Room not found');
    await api.joinRoom(db, code, s.uid, s.ui.fields.name);
    openRoom(code);
  }),
  newGame: () => run(() => api.startGame(db, s.code, families)),
  vote: (target) => run(async () => {
    await api.castVote(db, s.code, s.uid, target);
  }),
  remove: (uid) => {
    if (voting() && s.data.room.seats.includes(uid) && s.ui.confirmRemove !== uid) { s.ui.confirmRemove = uid; update(); return; }
    s.ui.confirmRemove = null;
    run(() => api.removePlayer(db, s.code, uid));
  },
  cancelRemove: () => { s.ui.confirmRemove = null; update(); },
  // Host only, during voting: counts the votes cast so far, for this round only (a later round is left alone).
  closeVote: () => {
    if (!s.ui.confirmClose) { s.ui.confirmClose = true; update(); return; }
    s.ui.confirmClose = false;
    run(() => api.closeVoting(db, s.code, undefined, s.data.room.round));
  },
  cancelClose: () => { s.ui.confirmClose = false; update(); },
  askLeave: () => { s.ui.confirmLeave = true; update(); },
  stay: () => { s.ui.confirmLeave = false; update(); },
  leave: () => run(async () => {
    s.ui.confirmLeave = false;
    if (s.data?.room?.gmUid !== s.uid) await api.leaveRoom(db, s.code, s.uid);
    // Someone joined since the screen offered Leave: the room is not deleted under them.
    else if (!(await api.deleteRoom(db, s.code))) throw new Error('Hand the room over first');
    remembered(null);
    s.ui.fields.code = '';
    leaveRoom();
  }),
  handOver: (uid) => run(() => api.handOverGm(db, s.code, uid)),
};

root.innerHTML = '<p class="status" role="status">Loading…</p>';
signIn(auth).then((uid) => {
  s.uid = uid;
  // A malformed ?room= shows "Room not found" on the join form without touching Firestore.
  if (s.code && !isRoomCode(s.code)) { s.data = { room: null, players: [] }; update(); } else if (s.code) openRoom(s.code);
  else update();
}).catch(() => {
  s.code = null;
  s.ui.error = 'Could not connect. Check your internet, then reload the page.';
  update();
});
