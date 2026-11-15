// Screens. `view` and `screenFor` are pure (no DOM) so they can be tested in node;
// `render` writes the markup and wires the buttons to `actions`.
import { MIN_PLAYERS, starterChoices, finalPoints, teams, dealPair } from './game.js';

export const GAME_NAME = 'Heroes vs Spies';

const KNOWN = {
  'Room not found': 'Room not found. Check the code with the game master.',
  'Name needed': 'Type your name first.',
  'Name already taken': 'Someone here already has that name. Pick another one.',
  'Code needed': 'Type the room code.',
  'Not enough players': `Not enough players. You need at least ${MIN_PLAYERS}.`,
  'Invalid word pair': 'Type two different words.',
  'Bad clock': "Your phone's date looks wrong. Fix it and try again.",
  'Old room': 'This room is from an older version. Create a new one.',
};
const ROOM_ERRORS = ['Round already running', 'No round to start', 'Not a safe starter', 'Cannot open voting yet', 'Player not found'];
export const friendly = (e) => KNOWN[e.message] || (ROOM_ERRORS.includes(e.message) ? `${e.message}.` : 'Something went wrong. Check your internet and try again.');

const points = (n) => `${n} point${n === 1 ? '' : 's'}`;

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A room made by the version before Heroes vs Spies has no `active`.
const oldRoom = (room) => !!room && !Array.isArray(room.active);

// s = { uid, code, data, ui }: data is the subscribe() state (undefined until loaded).
export function screenFor({ uid, code, data, ui = {} }) {
  if (!code) return 'join';
  if (data === undefined) return 'loading';
  const { room, players } = data;
  if (!room || oldRoom(room)) return 'join';
  const { phase } = room;
  if (room.gmUid === uid) {
    if (phase === 'lobby' || phase === 'gameOver') return ui.view === 'words' ? 'words' : 'lobby';
    if (phase === 'result') return room.needsWords && ui.view === 'words' ? 'words' : 'gmResult';
    return phase === 'clues' && !room.starterUid ? 'pickStarter' : 'gmRound';
  }
  if (!players.some((p) => p.uid === uid)) return 'join';
  if (phase === 'lobby') return 'waiting';
  if (phase === 'gameOver' || phase === 'result') return phase;
  if (room.active.includes(uid)) return phase === 'voting' ? 'vote' : 'word';
  return bench(room, uid) ? 'bench' : 'lateJoiner';
}

const bench = (room, uid) => (room.heroBench.includes(uid) ? 'Hero' : room.spyBench.includes(uid) ? 'Spy' : null);

const nameOf = (data, uid) => {
  if (uid === data.room.gmUid) return data.room.gmName;
  return data.room.names?.[uid] ?? data.players.find((x) => x.uid === uid)?.name ?? 'A player who left';
};

const btn = (label, action, { arg = '', kind = 'primary', disabled = false, extra = '' } = {}) =>
  `<button type="button" class="btn ${kind}" data-action="${action}" data-arg="${esc(arg)}"${disabled ? ' disabled' : ''}${extra}>${label}</button>`;

const errorLine = (ui) => (ui.error ? `<p class="error" role="alert"><b>Problem:</b> ${esc(ui.error)}</p>` : '');

const leaveBtn = btn('Leave room', 'leave', { kind: 'link' });

const spyTag = '<span class="tag">Spy</span>';

const nameList = (data, list, empty = 'Nobody yet') => (list.length
  ? `<ul class="ruled">${list.map((id) => `<li><span>${esc(nameOf(data, id))}</span></li>`).join('')}</ul>`
  : `<p class="hint">${empty}</p>`);

const order = (data, mark) => `<ol class="ruled numbered">${data.room.roundPlayers
  .map((id) => `<li><span>${esc(nameOf(data, id))}</span>${mark ? mark(id) : ''}</li>`).join('')}</ol>`;

const wordsList = (w) => `<dl class="ruled pairs">
  <div><dt>Everyone's word</dt><dd>${esc(w.common)}</dd></div>
  <div><dt>Spy's word</dt><dd>${esc(w.spy)}</dd></div></dl>`;

// The same for everyone, the spy included.
const scoreLine = ({ heroes, spies }) => `<p class="score-line">Heroes <b>${heroes}</b> <span aria-hidden="true">·</span> Spies <b>${spies}</b></p>`;

// `final` stays true after a voided final and at game over: read it only during a round.
const finalLine = (room) => (room.final && (room.phase === 'clues' || room.phase === 'voting')
  ? `<p class="final"><b>Final battle, worth ${points(finalPoints(room.score))}.</b> Whoever wins it wins the game.</p>` : '');

const namesRow = (data, label, list, empty) => `<div><dt>${label}</dt><dd>${list.length
  ? list.map((id) => esc(nameOf(data, id))).join(', ') : `<i>${empty}</i>`}</dd></div>`;

// The Spy bench lists only caught spies, so the scoreboard never points at the active one.
// stillIn is left out where the speaking order already lists the active players.
const scoreboard = (data, { stillIn = true } = {}) => {
  const { room } = data;
  return `<section class="scoreboard" aria-label="Scoreboard">
    <h2>Score</h2>${scoreLine(room.score)}
    <dl class="ruled pairs board">
      ${namesRow(data, 'Hero bench', room.heroBench, 'Nobody yet')}
      ${namesRow(data, 'Spy bench', room.spyBench, 'Nobody yet')}
      ${stillIn ? namesRow(data, `Still in (${room.active.length})`, room.active, 'Nobody') : ''}
    </dl>
  </section>`;
};

function verdict(data) {
  const r = data.room.result;
  const spyName = r.spyName && `<b>${esc(r.spyName)}</b>`;
  if (r.voided) {
    const who = r.outName ?? r.spyName;
    const head = `<h1>${who ? `<b>${esc(who)}</b>` : 'A player'} left. This round doesn't count.</h1>`;
    return spyName ? `${head}<p class="verdict">${spyName} ${spyTag} was the spy.</p>${wordsList(r)}` : head;
  }
  const out = `<b>${esc(r.outName ?? nameOf(data, r.outUid))}</b>`;
  // A non-spy result carries no words and no spy: that word set goes on.
  return r.wasSpy
    ? `<h1>${out} was the spy! Heroes +${r.points}.</h1>${wordsList(r)}`
    : `<h1>${out} was not the spy. Spies +${r.points}.</h1>`;
}

function gameOver(data) {
  const { room } = data;
  const r = room.result ?? {};
  const head = { heroes: 'Heroes win!', spies: 'Spies win!', draw: "It's a draw" }[room.winner] ?? 'Game over';
  const t = teams({ ...room, spyUid: r.spyUid ?? null });
  const won = (team) => (room.winner === team ? ' <i>(winners)</i>' : '');
  // points > 0 only when a final vote wrote this result; endGame keeps an older outName with 0 points.
  const out = r.outName && r.points > 0 ? esc(r.outName) : null;
  return `<section class="result"><h1>${head}</h1>${scoreLine(room.score)}
    ${out ? `<p class="verdict"><b>${out}</b> was voted out and ${r.wasSpy ? 'was the spy!' : 'was not the spy.'}</p>` : ''}
    ${r.spyName ? `<p class="verdict">The last spy was <b>${esc(r.spyName)}</b> ${spyTag}</p>` : ''}
    ${r.common ? wordsList(r) : ''}
    <h2>Heroes team${won('heroes')}</h2>${nameList(data, t.heroes, 'Nobody')}
    <h2>Spies team${won('spies')}</h2>${nameList(data, t.spies, 'Nobody')}</section>`;
}

const keepOpen = '<p class="keep"><b>Keep this screen open.</b> Your phone runs the game.</p>';
const dealing = `${keepOpen}<p class="status" role="status">Dealing the words…</p>`;

// Removing an active player mid-round voids the round, so those rows ask first.
function removeList(data, ui) {
  const asks = (id) => ['clues', 'voting'].includes(data.room.phase) && data.room.active.includes(id);
  const rows = data.players.map((p) => (ui.confirmRemove === p.uid && asks(p.uid)
    ? `<li class="confirm"><span>Remove ${esc(p.name)}? This round won't count.</span>
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
      ${code && oldRoom(data?.room) && !ui.error ? `<p class="error" role="alert"><b>Problem:</b> ${KNOWN['Old room']}</p>` : ''}
      <button type="submit" class="btn primary"${ui.busy ? ' disabled' : ''}>Join room</button>
      ${errorLine(ui)}
    </form>
    <p class="or">Running the game? Type your name above, then:</p>
    ${btn('Create a room', 'create', { kind: 'secondary', disabled: ui.busy })}`,

  waiting: ({ uid, data }) => `<h1>You're in!</h1>
    <p>Waiting for ${esc(data.room.gmName)} (game master) to start the game.</p>
    <h2>Players (${data.players.length})</h2>
    <ol class="ruled numbered">${data.players.map((p) => `<li><span>${esc(p.name)}${p.uid === uid ? ' <i>(you)</i>' : ''}</span></li>`).join('')}</ol>
    ${leaveBtn}`,

  lobby: ({ code, data, ui }) => {
    const { room, players } = data;
    const short = players.length < MIN_PLAYERS;
    const over = room.phase === 'gameOver';
    const rows = players.map((p) => `<li><span>${esc(p.name)}</span><span class="row-actions">
      ${btn('Remove', 'remove', { arg: p.uid, kind: 'secondary small', disabled: ui.busy, extra: ` aria-label="Remove ${esc(p.name)}"` })}</span></li>`).join('');
    // Kept apart from Remove so a slip on one row cannot hit the other action.
    const handOver = players.length ? `<details class="manage"><summary>Hand over the game master role</summary>
      <p class="hint">The new game master sees both words and the spy. You join as a player.</p>
      <ul class="ruled">${players.map((p) => `<li>${btn(`Make ${esc(p.name)} game master`, 'makeGm', { arg: p.uid, kind: 'choice', disabled: ui.busy })}</li>`).join('')}</ul></details>` : '';
    return `${over ? gameOver(data) : ''}
      <section class="room-code">${over ? '<h2 class="label">Room code</h2>' : '<h1 class="label">Room code</h1>'}<p class="big">${esc(code)}</p><p>Read it out loud so players can join.</p></section>
      <h2>Players (${players.length})</h2>
      ${players.length ? `<ol class="ruled numbered">${rows}</ol>` : '<p>No players yet.</p>'}
      ${btn('New game', 'words', { disabled: short || ui.busy, extra: short ? ' aria-describedby="why-not"' : '' })}
      ${short ? `<p id="why-not" class="hint">Needs at least ${MIN_PLAYERS} players. ${players.length} joined so far.</p>` : ''}
      ${errorLine(ui)}
      ${handOver}
      ${leaveBtn}<p class="hint">${players.length ? 'The room stays open. Type its code to come back.' : 'Nobody has joined, so leaving deletes this room.'}</p>`;
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
    if (!secret) return dealing;
    const choices = starterChoices(room.roundPlayers, secret.spyUid, room.setStart);
    const rows = room.roundPlayers.map((id) => `<li>${choices.includes(id)
      ? btn(esc(nameOf(data, id)), 'pickStarter', { arg: id, kind: 'choice', disabled: ui.busy })
      : `<span class="unsafe">${esc(nameOf(data, id))}</span>${id === secret.spyUid ? spyTag : '<span class="note">too close to the spy</span>'}`}</li>`).join('');
    return `${keepOpen}<h1>Who speaks first?</h1>
      ${finalLine(room)}
      <p>Tap a name. ${choices.length < room.roundPlayers.length ? 'The spy will speak third or later.' : 'Anyone can go first.'}</p>
      <ol class="ruled numbered">${rows}</ol>
      ${errorLine(ui)}
      ${wordsList(secret)}
      ${removeList(data, ui)}`;
  },

  gmRound: ({ data, ui }) => {
    const { secret, room, votesCast } = data;
    if (!secret) return dealing;
    const voting = room.phase === 'voting';
    return `${keepOpen}<h1>${voting ? 'Voting' : 'Clues'}</h1>
      ${finalLine(room)}
      ${voting
    ? `<p class="count" role="status"><b>${votesCast} of ${room.roundPlayers.length}</b> voted</p>
         ${btn('Close voting', 'closeVoting', { disabled: ui.busy })}
         <p class="hint">Voting closes by itself when everyone still in has voted.</p>`
    : `${btn('Open voting', 'openVoting', { disabled: ui.busy })}
         <p class="hint">Open voting once everyone has said a clue.</p>`}
      ${errorLine(ui)}
      ${wordsList(secret)}
      <p>The spy is <b>${esc(nameOf(data, secret.spyUid))}</b> ${spyTag}</p>
      <h2>Speaking order</h2>
      ${order(data, (id) => (id === secret.spyUid ? spyTag : ''))}
      ${scoreboard(data, { stillIn: false })}
      ${removeList(data, ui)}`;
  },

  gmResult: ({ data, ui }) => {
    const { room } = data;
    const left = room.active.length;
    // The room logic ends the game below 3; a spy caught with 3 or more left needs new words first.
    const next = left < 3 ? btn('Show the final score', 'nextRound', { disabled: ui.busy })
      : room.needsWords ? btn(left === 3 ? 'Pick words for the final battle' : 'Next round: pick new words', 'words', { disabled: ui.busy })
      : btn(left === 3 ? 'Start the final battle' : 'Next round', 'nextRound', { disabled: ui.busy });
    return `${keepOpen}<section class="result">${verdict(data)}</section>
      ${next}
      ${errorLine(ui)}
      ${scoreboard(data)}
      ${removeList(data, ui)}`;
  },

  // From here on, nothing may depend on who the spy is: only the word text differs.
  word: ({ uid, data }) => `<h1 class="label">Your word</h1>
    <p class="word">${data.myWord ? esc(data.myWord) : '<span class="status">Getting your word…</span>'}</p>
    ${finalLine(data.room)}
    <p>Say one clue out loud. Don't say your word!</p>
    <h2>Speaking order</h2>
    ${data.room.starterUid ? order(data, (id) => (id === uid ? '<i>(you)</i>' : '')) : '<p>Waiting for the game master to pick who goes first.</p>'}
    ${scoreLine(data.room.score)}`,

  vote: ({ uid, data, ui }) => (data.myVote === undefined
    ? '<p class="status" role="status">Checking your vote…</p>'
    : data.myVote
    ? `<h1>Vote sent</h1><p>Wait for the game master to show the result.</p>${finalLine(data.room)}${scoreLine(data.room.score)}`
    : `<h1>Who is the spy?</h1>
      ${finalLine(data.room)}
      <p>Tap one name. You can only vote once.</p>
      <ul class="ruled">${data.room.roundPlayers.filter((id) => id !== uid)
    .map((id) => `<li>${btn(esc(nameOf(data, id)), 'vote', { arg: id, kind: 'choice', disabled: ui.busy })}</li>`).join('')}</ul>
      ${errorLine(ui)}
      <p class="hint">Your word: <b>${data.myWord ? esc(data.myWord) : '…'}</b></p>
      ${scoreLine(data.room.score)}`),

  // Benched players see no word, ever: only the scoreboard.
  bench: ({ uid, data }) => `<h1>You're on the ${bench(data.room, uid)} bench</h1>
    <p>You win or lose with your team. Watch the score.</p>
    ${scoreboard(data)}
    ${leaveBtn}`,

  lateJoiner: () => `<h1>A game is in progress. You're in the next one.</h1>${leaveBtn}`,

  result: ({ uid, data }) => {
    const b = bench(data.room, uid);
    const playing = data.room.active.includes(uid);
    return `<section class="result">${verdict(data)}</section>
      ${b ? `<p class="you"><b>You're on the ${b} bench.</b></p>` : ''}
      <p>${playing || b ? 'Waiting for the game master to start the next round.' : "You're in the next game."}</p>
      ${scoreboard(data)}
      ${playing ? '' : leaveBtn}`;
  },

  gameOver: ({ data }) => `${gameOver(data)}<p>Waiting for the game master to start a new game.</p>${leaveBtn}`,
};

export function view(s) {
  const screen = screenFor(s);
  const code = s.data && s.data.room && !oldRoom(s.data.room) ? s.code : null;
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
  // A new screen, phase (Open voting becomes Close voting in place) or Remove confirmation
  // under the finger: drop the second tap of a double tap.
  const key = `${screenFor(s)}:${s.data?.room?.phase}:${s.ui.confirmRemove ?? ''}`;
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
