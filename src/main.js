import './style.css';
import pairs from '../words/word-pairs.json';
import { firebaseConfig } from './firebase-config.js';
import { initFirebase, signIn } from './firebase.js';
import * as api from './room.js';
import { dealPair, validPair } from './game.js';
import { render, GAME_NAME } from './ui.js';

document.title = GAME_NAME;
const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const onLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
// Dev only: ?dev=NAME gives this tab its own Firebase app, so it signs in as a separate user.
const { auth, db } = initFirebase(firebaseConfig, {
  emulator: onLocalhost,
  name: (onLocalhost && params.get('dev')) || undefined,
});

const urlCode = (params.get('room') || '').trim().toUpperCase();
const s = {
  uid: null,
  code: urlCode || null,
  data: urlCode ? undefined : null,
  ui: { view: null, pair: null, error: null, confirmRemove: null, busy: false, voted: false,
    fields: { name: '', code: urlCode, common: '', spy: '' } },
};
let unsubscribe = () => {};
let closingRound = null;

const KNOWN = {
  'Room not found': 'Room not found. Check the code with the game master.',
  'Name needed': 'Type your name first.',
  'Code needed': 'Type the room code.',
  'Not enough players': 'Not enough players. You need at least 4.',
  'Invalid word pair': 'Type two different words.',
};
const ROOM_ERRORS = ['Round already running', 'No round to start', 'Not a safe starter', 'Cannot open voting yet', 'Player not found'];
const friendly = (e) => KNOWN[e.message] || (ROOM_ERRORS.includes(e.message) ? `${e.message}.` : 'Something went wrong. Check your internet and try again.');

const votedKey = () => `spy-voted:${s.uid}:${s.code}:${s.data?.room?.round}`;
const readVoted = () => { try { return localStorage.getItem(votedKey()) === '1'; } catch { return false; } };

const update = () => {
  s.ui.voted = s.ui.voted || (!!s.data?.room && readVoted());
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
  params.set('room', code);
  history.replaceState(null, '', `?${params}`);
  unsubscribe();
  s.data = undefined;
  let round;
  unsubscribe = api.subscribe(db, code, s.uid, (data) => {
    s.data = data;
    if (data.room && data.room.round !== round) {
      round = data.room.round;
      s.ui.voted = false;
      s.ui.confirmRemove = null;
    }
    autoClose(data);
    update();
  });
  update();
}

// The game master's phone closes voting once every round player has voted, once per round.
function autoClose({ room, votesCast }) {
  if (!room || room.gmUid !== s.uid || room.phase !== 'voting') return;
  if (votesCast !== room.roundPlayers.length || closingRound === room.round) return;
  closingRound = room.round;
  api.closeVoting(db, s.code).catch(() => { closingRound = null; });
}

function nextPair() {
  let pair;
  do pair = dealPair(pairs[Math.floor(Math.random() * pairs.length)]);
  while (s.ui.pair && pair.common === s.ui.pair.common && pair.spy === s.ui.pair.spy);
  return pair;
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
    await api.joinRoom(db, code, s.uid, s.ui.fields.name);
    openRoom(code);
  }),
  newRound: () => { Object.assign(s.ui, { view: 'words', pair: nextPair(), error: null }); update(); },
  skip: () => { s.ui.pair = nextPair(); update(); },
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
    s.ui.voted = true;
    try { localStorage.setItem(votedKey(), '1'); } catch { /* the in-memory flag still holds */ }
  }),
  remove: (uid) => {
    if (roundRunning() && s.ui.confirmRemove !== uid) { s.ui.confirmRemove = uid; update(); return; }
    s.ui.confirmRemove = null;
    run(() => api.removePlayer(db, s.code, uid));
  },
  cancelRemove: () => { s.ui.confirmRemove = null; update(); },
  makeGm: (uid) => run(() => api.handOverGm(db, s.code, uid)),
};

root.innerHTML = '<p class="status" role="status">Loading…</p>';
signIn(auth).then((uid) => {
  s.uid = uid;
  if (s.code) openRoom(s.code);
  else update();
}).catch(() => {
  s.code = null;
  s.ui.error = 'Could not connect. Check your internet, then reload the page.';
  update();
});
