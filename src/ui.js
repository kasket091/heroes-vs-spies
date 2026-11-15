// Screens. `view` and `screenFor` are pure (no DOM) so they can be tested in node;
// `render` writes the markup and wires the buttons to `actions`.
import { MIN_PLAYERS, safeStarters, dealPair } from './game.js';

export const GAME_NAME = 'Spy Game';

const BETWEEN_ROUNDS = ['lobby', 'reveal', 'cancelled'];

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// s = { uid, code, data, ui }: data is the subscribe() state (undefined until loaded).
export function screenFor({ uid, code, data, ui = {} }) {
  if (!code) return 'join';
  if (data === undefined) return 'loading';
  const { room, players } = data;
  if (!room) return 'join';
  const between = BETWEEN_ROUNDS.includes(room.phase);
  if (room.gmUid === uid) {
    if (between) return ui.view === 'words' ? 'words' : 'lobby';
    return room.phase === 'clues' && !room.starterUid ? 'pickStarter' : 'gmRound';
  }
  if (!players.some((p) => p.uid === uid)) return 'join';
  if (between) return room.phase === 'lobby' ? 'waiting' : room.phase;
  if (!room.roundPlayers.includes(uid)) return 'outOfRound';
  return room.phase === 'voting' ? 'vote' : 'word';
}

const nameOf = (data, uid) => {
  if (uid === data.room.gmUid) return data.room.gmName;
  const p = data.players.find((x) => x.uid === uid);
  return p ? p.name : 'A player who left';
};

const btn = (label, action, { arg = '', kind = 'primary', disabled = false, extra = '' } = {}) =>
  `<button type="button" class="btn ${kind}" data-action="${action}" data-arg="${esc(arg)}"${disabled ? ' disabled' : ''}${extra}>${label}</button>`;

const errorLine = (ui) => (ui.error ? `<p class="error" role="alert"><b>Problem:</b> ${esc(ui.error)}</p>` : '');

const leaveBtn = btn('Leave room', 'leave', { kind: 'link' });

const spyTag = '<span class="tag">Spy</span>';

const order = (data, mark) => `<ol class="ruled numbered">${data.room.roundPlayers
  .map((id) => `<li><span>${esc(nameOf(data, id))}</span>${mark ? mark(id) : ''}</li>`).join('')}</ol>`;

const wordsList = (w) => `<dl class="ruled pairs">
  <div><dt>Everyone's word</dt><dd>${esc(w.common)}</dd></div>
  <div><dt>Spy's word</dt><dd>${esc(w.spy)}</dd></div></dl>`;

function result(data) {
  const r = data.room.result;
  // Names come from the result itself: the spy may be the player who was removed.
  const spy = `<b>${esc(r.spyName ?? nameOf(data, r.spyUid))}</b> ${spyTag}`;
  let head;
  if (data.room.phase === 'cancelled') {
    head = `<h1>Round cancelled</h1><p>A player was removed, so this round stopped.</p><p class="verdict">The spy was ${spy}</p>`;
  } else if (r.winner === 'players') {
    head = `<h1>Players win!</h1><p class="verdict">The players caught the spy: ${spy}</p>`;
  } else if (r.votedOutUid) {
    const out = esc(r.votedOutName ?? nameOf(data, r.votedOutUid));
    head = `<h1>The spy wins!</h1><p class="verdict"><b>${out}</b> was voted out, but was not the spy. The spy was ${spy}</p>`;
  } else {
    head = `<h1>The spy wins!</h1><p class="verdict">Nobody was voted out: the votes were tied, or nobody voted. The spy was ${spy}</p>`;
  }
  return `<section class="result">${head}${wordsList(r)}</section>`;
}

const keepOpen = '<p class="keep"><b>Keep this screen open.</b> Your phone runs the round.</p>';

// Remove during a round cancels it, so each row asks first.
function removeDuringRound(data, ui) {
  const rows = data.players.map((p) => (ui.confirmRemove === p.uid && data.room.roundPlayers.includes(p.uid)
    ? `<li class="confirm"><span>Remove ${esc(p.name)}? This ends the round.</span>
        <span class="row-actions">${btn('Yes, remove', 'remove', { arg: p.uid, kind: 'danger small', disabled: ui.busy })}${btn('Keep', 'cancelRemove', { kind: 'secondary small' })}</span></li>`
    : `<li><span>${esc(p.name)}</span><span class="row-actions">${btn('Remove', 'remove', { arg: p.uid, kind: 'secondary small', disabled: ui.busy, extra: ` aria-label="Remove ${esc(p.name)}"` })}</span></li>`)).join('');
  return `<details class="manage"${ui.confirmRemove ? ' open' : ''}><summary>Remove a player</summary><ol class="ruled">${rows}</ol></details>`;
}

const screens = {
  loading: () => '<p class="status" role="status">Loading the room…</p>',

  join: ({ code, data, ui }) => `<h1>Join a game</h1>
    <form class="stack" data-submit="join" novalidate>
      <label for="f-name">Your name</label>
      <input id="f-name" name="name" maxlength="20" autocomplete="nickname" required>
      <label for="f-code">Room code</label>
      <input id="f-code" name="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" class="code-input" required>
      ${code && data && data.room === null && !ui.error ? '<p class="error" role="alert"><b>Problem:</b> Room not found. Check the code with the game master.</p>' : ''}
      <button type="submit" class="btn primary"${ui.busy ? ' disabled' : ''}>Join room</button>
      ${errorLine(ui)}
    </form>
    <p class="or">Running the game? Type your name above, then:</p>
    ${btn('Create a room', 'create', { kind: 'secondary', disabled: ui.busy })}`,

  waiting: ({ uid, data }) => `<h1>You're in!</h1>
    <p>Waiting for ${esc(data.room.gmName)} (game master) to start the round.</p>
    <h2>Players (${data.players.length})</h2>
    <ol class="ruled numbered">${data.players.map((p) => `<li><span>${esc(p.name)}${p.uid === uid ? ' <i>(you)</i>' : ''}</span></li>`).join('')}</ol>
    ${leaveBtn}`,

  lobby: ({ code, data, ui }) => {
    const { room, players } = data;
    const short = players.length < MIN_PLAYERS;
    const rows = players.map((p) => `<li><span>${esc(p.name)}</span><span class="row-actions">
      ${btn('Remove', 'remove', { arg: p.uid, kind: 'secondary small', disabled: ui.busy, extra: ` aria-label="Remove ${esc(p.name)}"` })}</span></li>`).join('');
    // Kept apart from Remove so a slip on one row cannot hit the other action.
    const handOver = players.length ? `<details class="manage"><summary>Hand over the game master role</summary>
      <p class="hint">The new game master sees both words and the spy. You join as a player.</p>
      <ul class="ruled">${players.map((p) => `<li>${btn(`Make ${esc(p.name)} game master`, 'makeGm', { arg: p.uid, kind: 'choice', disabled: ui.busy })}</li>`).join('')}</ul></details>` : '';
    return `${room.phase === 'lobby' ? '' : result(data)}
      <section class="room-code">${room.phase === 'lobby' ? '<h1 class="label">Room code</h1>' : '<h2 class="label">Room code</h2>'}<p class="big">${esc(code)}</p><p>Read it out loud so players can join.</p></section>
      <h2>Players (${players.length})</h2>
      ${players.length ? `<ol class="ruled numbered">${rows}</ol>` : '<p>No players yet.</p>'}
      ${btn('New round', 'newRound', { disabled: short || ui.busy, extra: short ? ' aria-describedby="why-not"' : '' })}
      ${short ? `<p id="why-not" class="hint">Needs at least ${MIN_PLAYERS} players. ${players.length} joined so far.</p>` : ''}
      ${errorLine(ui)}
      ${handOver}
      ${leaveBtn}<p class="hint">The room stays open. Type its code to come back.</p>`;
  },

  words: ({ ui }) => `<h1>Words for this round</h1>
    <p>Only you can see this.</p>
    ${ui.pair ? wordsList(ui.pair) : ''}
    <div class="stack">
      ${btn('Use these words', 'usePair', { disabled: ui.busy })}
      ${btn('Skip', 'skip', { kind: 'secondary', disabled: ui.busy })}
    </div>
    <h2>Or type your own</h2>
    <form class="stack" data-submit="useOwn" novalidate>
      <label for="f-common">Everyone's word</label>
      <input id="f-common" name="common" maxlength="30" autocomplete="off">
      <label for="f-spy">Spy's word</label>
      <input id="f-spy" name="spy" maxlength="30" autocomplete="off">
      <button type="submit" class="btn secondary"${ui.busy ? ' disabled' : ''}>Use my words</button>
    </form>
    ${errorLine(ui)}
    ${btn('Back', 'back', { kind: 'link' })}`,

  pickStarter: ({ data, ui }) => {
    const { secret, room } = data;
    if (!secret) return `${keepOpen}<p class="status" role="status">Dealing the words…</p>`;
    const safe = safeStarters(room.roundPlayers, secret.spyUid);
    const rows = room.roundPlayers.map((id) => `<li>${safe.includes(id)
      ? btn(esc(nameOf(data, id)), 'pickStarter', { arg: id, kind: 'choice', disabled: ui.busy })
      : `<span class="unsafe">${esc(nameOf(data, id))}</span>${id === secret.spyUid ? spyTag : '<span class="note">too close to the spy</span>'}`}</li>`).join('');
    return `${keepOpen}<h1>Who speaks first?</h1>
      <p>Tap a name. The spy will speak third or later.</p>
      <ol class="ruled numbered">${rows}</ol>
      ${errorLine(ui)}
      ${wordsList(secret)}
      ${removeDuringRound(data, ui)}`;
  },

  gmRound: ({ data, ui }) => {
    const { secret, room, votesCast } = data;
    if (!secret) return `${keepOpen}<p class="status" role="status">Dealing the words…</p>`;
    const voting = room.phase === 'voting';
    return `${keepOpen}<h1>${voting ? 'Voting' : 'Clues'}</h1>
      ${voting
    ? `<p class="count" role="status"><b>${votesCast} of ${room.roundPlayers.length}</b> voted</p>
         ${btn('Close voting', 'closeVoting', { disabled: ui.busy })}
         <p class="hint">Voting closes by itself when everyone has voted.</p>`
    : `${btn('Open voting', 'openVoting', { disabled: ui.busy })}
         <p class="hint">Open voting once everyone has said a clue.</p>`}
      ${errorLine(ui)}
      ${wordsList(secret)}
      <p>The spy is <b>${esc(nameOf(data, secret.spyUid))}</b> ${spyTag}</p>
      <h2>Speaking order</h2>
      ${order(data, (id) => (id === secret.spyUid ? spyTag : ''))}
      ${removeDuringRound(data, ui)}`;
  },

  // From here on, nothing may depend on who the spy is: only the word text differs.
  word: ({ uid, data }) => `<h1 class="label">Your word</h1>
    <p class="word">${data.myWord ? esc(data.myWord) : '<span class="status">Getting your word…</span>'}</p>
    <p>Say one clue out loud. Don't say your word!</p>
    <h2>Speaking order</h2>
    ${data.room.starterUid ? order(data, (id) => (id === uid ? '<i>(you)</i>' : '')) : '<p>Waiting for the game master to pick who goes first.</p>'}`,

  vote: ({ uid, data, ui }) => (data.myVote === undefined
    ? '<p class="status" role="status">Checking your vote…</p>'
    : data.myVote
    ? `<h1>Vote sent</h1><p>Wait for the game master to show the result.</p>`
    : `<h1>Who is the spy?</h1>
      <p>Tap one name. You can only vote once.</p>
      <ul class="ruled">${data.room.roundPlayers.filter((id) => id !== uid)
    .map((id) => `<li>${btn(esc(nameOf(data, id)), 'vote', { arg: id, kind: 'choice', disabled: ui.busy })}</li>`).join('')}</ul>
      ${errorLine(ui)}
      <p class="hint">Your word: <b>${data.myWord ? esc(data.myWord) : '…'}</b></p>`),

  outOfRound: () => `<h1>Round in progress.</h1><p>You're in the next one.</p>`,

  reveal: ({ data }) => `${result(data)}<p>Waiting for the game master to start the next round.</p>${leaveBtn}`,
  cancelled: (s) => screens.reveal(s),
};

export function view(s) {
  const screen = screenFor(s);
  const code = s.data && s.data.room ? s.code : null;
  return `<header class="cover"><span class="title">${GAME_NAME}</span>${code ? `<span class="code-chip">Room <b>${esc(code)}</b></span>` : ''}</header>
<main class="page" data-screen="${screen}">${screens[screen]({ ...s, ui: s.ui || {} })}</main>`;
}

// A pair different from `current` in either order, dealt with a random spy side.
export function nextPair(pairs, current, rand = Math.random) {
  const same = (p) => current && p.includes(current.common) && p.includes(current.spy);
  const pool = pairs.filter((p) => !same(p));
  return dealPair(pool[Math.floor(rand() * pool.length)], rand);
}

// UI state that must not outlive its cause, given the previous and next state.
export function settle(prev, next) {
  const ui = { ...next.ui };
  if (!prev) return ui;
  if (screenFor(prev) !== screenFor(next)) ui.error = null;
  const gm = (x) => !!x.data?.room && x.data.room.gmUid === x.uid;
  if (gm(prev) !== gm(next)) Object.assign(ui, { view: null, pair: null });
  if (prev.data?.room?.round !== next.data?.room?.round) ui.confirmRemove = null;
  return ui;
}

const TAP_GUARD_MS = 300;

export function render(root, s, actions) {
  const html = view(s);
  // Same markup: leave the DOM alone so typing and focus survive unrelated updates.
  if (root.renderedHtml === html) return;
  // A new screen (or the Remove confirmation) under the finger: drop the second tap of a double tap.
  const key = `${screenFor(s)}:${s.ui.confirmRemove ?? ''}`;
  if (root.screenKey !== key) root.tapsFrom = Date.now() + TAP_GUARD_MS;
  root.screenKey = key;
  root.renderedHtml = html;
  root.innerHTML = html;
  const ready = () => Date.now() >= root.tapsFrom;
  for (const input of root.querySelectorAll('input')) {
    input.value = s.ui.fields[input.name] ?? '';
    input.addEventListener('input', () => actions.setField(input.name, input.value));
  }
  for (const b of root.querySelectorAll('[data-action]')) {
    b.addEventListener('click', () => { if (ready()) actions[b.dataset.action](b.dataset.arg); });
  }
  for (const f of root.querySelectorAll('[data-submit]')) {
    f.addEventListener('submit', (e) => { e.preventDefault(); if (ready()) actions[f.dataset.submit](); });
  }
}
