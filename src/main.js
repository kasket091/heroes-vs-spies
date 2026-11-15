import './style.css';
import pairs from '../words/word-pairs.json';
import { firebaseConfig } from './firebase-config.js';
import { initFirebase, signIn } from './firebase.js';
import * as api from './room.js';
import { validPair, isRoomCode } from './game.js';
import { render, settle, nextPair, GAME_NAME } from './ui.js';

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
  ui: { view: null, pair: null, error: null, confirmRemove: null, busy: false,
    fields: { name: '', code: urlCode, common: '', spy: '' } },
};
let unsubscribe = () => {};
let closingRound = null;
let checked = false;

const KNOWN = {
  'Room not found': 'Room not found. Check the code with the game master.',
  'Name needed': 'Type your name first.',
  'Name already taken': 'Someone here already has that name. Pick another one.',
  'Code needed': 'Type the room code.',
  'Not enough players': 'Not enough players. You need at least 4.',
  'Invalid word pair': 'Type two different words.',
};
const ROOM_ERRORS = ['Round already running', 'No round to start', 'Not a safe starter', 'Cannot open voting yet', 'Player not found'];
const friendly = (e) => KNOWN[e.message] || (ROOM_ERRORS.includes(e.message) ? `${e.message}.` : 'Something went wrong. Check your internet and try again.');

let last = null;
const update = () => {
  s.ui = settle(last, s);
  last = { ...s, ui: { ...s.ui } };
  render(root, s, actions);
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
  unsubscribe();
  s.data = undefined;
  unsubscribe = api.subscribe(db, code, s.uid, (data) => {
    // A remembered room that is gone, or no longer has this person in it: back to the join form.
    if (startCode === code && !urlCode && !checked) {
      checked = true;
      const inRoom = data.room && (data.room.gmUid === s.uid || data.players.some((p) => p.uid === s.uid));
      if (!inRoom) { remembered(null); leaveRoom(); return; }
    }
    s.data = data;
    autoClose(data);
    update();
  });
  update();
}

function leaveRoom() {
  unsubscribe();
  unsubscribe = () => {};
  params.delete('room');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  Object.assign(s, { code: null, data: null });
  update();
}

// The game master's phone closes voting once every round player has voted, once per round.
function autoClose({ room, votesCast }) {
  if (!room || room.gmUid !== s.uid || room.phase !== 'voting') return;
  if (votesCast !== room.roundPlayers.length || closingRound === room.round) return;
  closingRound = room.round;
  api.closeVoting(db, s.code).catch(() => { closingRound = null; });
}

const deal = (common, spy) => run(async () => {
  await api.dealRound(db, s.code, common, spy);
  Object.assign(s.ui, { view: null, pair: null });
  Object.assign(s.ui.fields, { common: '', spy: '' });
});

const roundRunning = () => ['clues', 'voting'].includes(s.data?.room?.phase);

const actions = {
  setField: (name, value) => { s.ui.fields[name] = value; },
  create: () => run(async () => openRoom(await api.createRoom(db, s.uid, s.ui.fields.name))),
  join: () => run(async () => {
    const code = s.ui.fields.code.trim().toUpperCase();
    if (!code) throw new Error('Code needed');
    // Not a code the app could have made: never reaches Firestore.
    if (!isRoomCode(code)) throw new Error('Room not found');
    await api.joinRoom(db, code, s.uid, s.ui.fields.name);
    openRoom(code);
  }),
  newRound: () => { Object.assign(s.ui, { view: 'words', pair: nextPair(pairs, null), error: null }); update(); },
  skip: () => { Object.assign(s.ui, { pair: nextPair(pairs, s.ui.pair), error: null }); update(); },
  back: () => { Object.assign(s.ui, { view: null, error: null }); update(); },
  usePair: () => deal(s.ui.pair.common, s.ui.pair.spy),
  useOwn: () => {
    const { common, spy } = s.ui.fields;
    if (!validPair(common, spy)) { s.ui.error = 'Type two different words.'; update(); return; }
    deal(common, spy);
  },
  pickStarter: (uid) => run(() => api.pickStarter(db, s.code, uid)),
  openVoting: () => run(() => api.openVoting(db, s.code)),
  closeVoting: () => run(() => api.closeVoting(db, s.code)),
  vote: (target) => run(async () => {
    await api.castVote(db, s.code, s.uid, target);
  }),
  remove: (uid) => {
    if (roundRunning() && s.data.room.roundPlayers.includes(uid) && s.ui.confirmRemove !== uid) { s.ui.confirmRemove = uid; update(); return; }
    s.ui.confirmRemove = null;
    run(() => api.removePlayer(db, s.code, uid));
  },
  cancelRemove: () => { s.ui.confirmRemove = null; update(); },
  leave: () => run(async () => {
    if (s.data?.room?.gmUid !== s.uid) await api.leaveRoom(db, s.code, s.uid);
    remembered(null);
    s.ui.fields.code = '';
    leaveRoom();
  }),
  makeGm: (uid) => run(() => api.handOverGm(db, s.code, uid)),
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
