// Screens. `view` and `screenFor` are pure (no DOM) so they can be tested in node;
// `render` writes the markup and wires the buttons to `actions`.
// Nothing here may read gm/secret, the used pairs or the votes: the host's screens are a player's.
import { MIN_PLAYERS, finalPoints, teams, stalled } from './game.js';

export const GAME_NAME = 'Heroes vs Spies';

const KNOWN = {
  'Room not found': 'Room not found. Check the code and try again.',
  'Name needed': 'Type your name first.',
  'Name already taken': 'Someone here already has that name. Pick another one.',
  'Code needed': 'Type the room code.',
  'Not enough players': `Not enough players. You need at least ${MIN_PLAYERS}, you included.`,
  'Bad clock': "Your phone's date looks wrong. Fix it and try again.",
  'Old room': 'This room is from an older version. Create a new one.',
  'Not in this round': "You're not in this round any more.",
  'Hand the room over first': 'Hand the room to someone before you leave.',
};
const ROOM_ERRORS = ['Round already running', 'Player not found'];
export const friendly = (e) => KNOWN[e.message] || (ROOM_ERRORS.includes(e.message) ? `${e.message}.` : 'Something went wrong. Check your internet and try again.');

const points = (n) => `${n} point${n === 1 ? '' : 's'}`;

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A room made by an older version has no `seats`.
const oldRoom = (room) => !!room && !Array.isArray(room.seats);
const isHost = ({ uid, data }) => data.room.gmUid === uid;
const midGame = (room) => room.phase === 'voting' || room.phase === 'result';

// s = { uid, code, data, ui, since, now }: data is the subscribe() state (undefined until loaded);
// since is when this phone first saw the current state, now is this phone's clock.
export function screenFor({ uid, code, data }) {
  if (!code) return 'join';
  if (data === undefined) return 'loading';
  const { room, players } = data;
  if (!room || oldRoom(room)) return 'join';
  if (!players.some((p) => p.uid === uid)) return 'join';
  const host = room.gmUid === uid;
  if (room.phase === 'lobby') return host ? 'lobby' : 'waiting';
  if (room.phase === 'gameOver') return host ? 'lobby' : 'gameOver';
  if (room.phase === 'result') return 'result';
  if (room.seats.includes(uid)) return 'vote';
  return bench(room, uid) ? 'bench' : 'lateJoiner';
}

const bench = (room, uid) => (room.heroBench.includes(uid) ? 'Hero' : room.spyBench.includes(uid) ? 'Spy' : null);

const nameOf = (data, uid) => data.room.names?.[uid] ?? data.players.find((x) => x.uid === uid)?.name ?? 'A player who left';

const btn = (label, action, { arg = '', kind = 'primary', disabled = false, extra = '' } = {}) =>
  `<button type="button" class="btn ${kind}" data-action="${action}" data-arg="${esc(arg)}"${disabled ? ' disabled' : ''}${extra}>${label}</button>`;

const errorLine = (msg) => (msg ? `<p class="error" role="alert"><b>Problem:</b> ${esc(msg)}</p>` : '');

const you = (on) => (on ? ' <i>(you)</i>' : '');

// Players other than the host can always leave; a seated player mid-game is asked first.
function leaveBlock({ uid, data, ui }) {
  const { room } = data;
  if (!(midGame(room) && room.seats.includes(uid))) return btn('Leave room', 'leave', { kind: 'link' });
  if (!ui.confirmLeave) return btn('Leave room', 'askLeave', { kind: 'link' });
  return `<div class="ask" role="group" aria-label="Leave room">
    <p><b>You're in a game. Leaving can hold it up for the others.</b></p>
    <div class="row-actions">${btn('Yes, leave', 'leave', { kind: 'danger small', disabled: ui.busy })}${btn('Stay', 'stay', { kind: 'secondary small' })}</div></div>`;
}

const spyTag = '<span class="tag">Spy</span>';

const nameList = (data, list, empty = 'Nobody yet') => (list.length
  ? `<ul class="ruled">${list.map((id) => `<li><span>${esc(nameOf(data, id))}</span></li>`).join('')}</ul>`
  : `<p class="hint">${empty}</p>`);

const wordsList = (w) => `<dl class="ruled pairs">
  <div><dt>Everyone's word</dt><dd>${esc(w.common)}</dd></div>
  <div><dt>Spy's word</dt><dd>${esc(w.spy)}</dd></div></dl>`;

// The same for everyone, the spy included.
const scoreLine = ({ heroes, spies }) => `<p class="score-line">Heroes <b>${heroes}</b> <span aria-hidden="true">·</span> Spies <b>${spies}</b></p>`;

// `final` stays true after a voided final and at game over: read it only during voting.
const finalLine = (room) => (room.final && room.phase === 'voting'
  ? `<p class="final"><b>Final battle, worth ${points(finalPoints(room.score))}.</b> Whoever wins it wins the game.</p>` : '');

const namesRow = (data, label, list, empty) => `<div><dt>${label}</dt><dd>${list.length
  ? list.map((id) => esc(nameOf(data, id))).join(', ') : `<i>${empty}</i>`}</dd></div>`;

// The Spy bench lists only caught spies, so the scoreboard never points at the active one.
const scoreboard = (data) => {
  const { room } = data;
  return `<section class="scoreboard" aria-label="Scoreboard">
    <h2>Score</h2>${scoreLine(room.score)}
    <dl class="ruled pairs board">
      ${namesRow(data, 'Hero bench', room.heroBench, 'Nobody yet')}
      ${namesRow(data, 'Spy bench', room.spyBench, 'Nobody yet')}
      ${namesRow(data, `Still in (${room.seats.length})`, room.seats, 'Nobody')}
    </dl>
  </section>`;
};

// Only phones other than the host's say this: the host's own trouble shows as its run error.
const stallLine = (s) => {
  const { room, waiting } = s.data;
  const allVoted = room.phase === 'voting' && waiting?.length === 0;
  return !isHost(s) && s.since != null && stalled({ phase: room.phase, allVoted, since: s.since, now: s.now })
    ? `<p class="stall" role="status">Waiting for ${esc(room.gmName)}'s phone. Ask them to open the game.</p>` : '';
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
  const t = teams({ ...room, active: room.seats, spyUid: r.spyUid ?? null });
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

// Removing a seated player mid-vote voids the round, so those rows ask first. The host cannot remove themselves.
function removeList({ uid, data, ui }) {
  const asks = (id) => data.room.phase === 'voting' && data.room.seats.includes(id);
  const rows = data.players.filter((p) => p.uid !== uid).map((p) => (ui.confirmRemove === p.uid && asks(p.uid)
    ? `<li class="confirm"><span>Remove ${esc(p.name)}? This round won't count.</span>
        <span class="row-actions">${btn('Yes, remove', 'remove', { arg: p.uid, kind: 'danger small', disabled: ui.busy })}${btn('Keep', 'cancelRemove', { kind: 'secondary small' })}</span></li>`
    : `<li><span>${esc(p.name)}</span><span class="row-actions">${btn('Remove', 'remove', { arg: p.uid, kind: 'secondary small', disabled: ui.busy, extra: ` aria-label="Remove ${esc(p.name)}"` })}</span></li>`)).join('');
  return `<details class="manage" data-open="openRemove"${ui.confirmRemove || ui.openRemove ? ' open' : ''}><summary>Remove a player</summary><ol class="ruled">${rows}</ol></details>`;
}

const keepOpen = '<p class="keep">Your phone runs this room. Keep this screen open.</p>';

const playerList = ({ uid, data }) => `<h2>Players (${data.players.length})</h2>
    <ol class="ruled numbered">${data.players.map((p) => `<li><span>${esc(p.name)}${you(p.uid === uid)}</span></li>`).join('')}</ol>`;

// What this phone knows about its own vote; shown above the order so it is seen without scrolling.
function voteStatus(s) {
  const { data } = s;
  const { room, myVote } = data;
  if (myVote === undefined) return '<p class="status" role="status">Checking your vote…</p>';
  if (!myVote) return '';
  // Shown in speaking order, whatever order the list arrived in.
  const left = room.roundPlayers.filter((id) => data.waiting?.includes(id));
  return `<p class="sent" role="status"><b>Vote sent.</b> ${left.length ? `Waiting for: ${left.map((id) => esc(nameOf(data, id))).join(', ')}` : 'Everyone has voted.'}</p>
    ${stallLine(s)}`;
}

function nextLine(room) {
  const left = room.seats.length;
  return left < 3 ? 'The game ends in a moment.' : left === 3 ? 'The final battle starts in a moment.' : 'Next round starts in a moment.';
}

const screens = {
  loading: () => '<p class="status" role="status">Loading the room…</p>',

  join: ({ code, data, ui }) => `<h1>Join a game</h1>
    <form class="stack" data-submit="join" novalidate>
      <label for="f-name">Your name</label>
      <input id="f-name" name="name" maxlength="20" autocomplete="nickname" required>
      <label for="f-code">Room code</label>
      <input id="f-code" name="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" class="code-input" required>
      ${code && data && data.room === null && !ui.error ? errorLine(KNOWN['Room not found']) : ''}
      ${code && oldRoom(data?.room) && !ui.error ? errorLine(KNOWN['Old room']) : ''}
      <button type="submit" class="btn primary"${ui.busy ? ' disabled' : ''}>Join room</button>
      ${errorLine(ui.error)}
    </form>
    <p class="or">Starting a new room? Type your name above, then:</p>
    ${btn('Create a room', 'create', { kind: 'secondary', disabled: ui.busy })}`,

  waiting: (s) => `<h1>You're in!</h1>
    <p>Waiting for ${esc(s.data.room.gmName)} to start the game.</p>
    ${playerList(s)}`,

  // The host between games: lobby and game over.
  lobby: ({ uid, code, data, ui }) => {
    const { room, players } = data;
    const others = players.filter((p) => p.uid !== uid);
    const short = players.length < MIN_PLAYERS;
    const over = room.phase === 'gameOver';
    const rows = players.map((p) => `<li><span>${esc(p.name)}${you(p.uid === uid)}</span>${p.uid === uid ? '' : `<span class="row-actions">
      ${btn('Remove', 'remove', { arg: p.uid, kind: 'secondary small', disabled: ui.busy, extra: ` aria-label="Remove ${esc(p.name)}"` })}</span>`}</li>`).join('');
    // Kept apart from Remove so a slip on one row cannot hit the other action.
    const handOver = others.length ? `<details class="manage" data-open="openHandOver"${ui.openHandOver ? ' open' : ''}><summary>Hand the room to someone else</summary>
      <p class="hint">Their phone runs the room from then on, and they get the New game button.</p>
      <ul class="ruled">${others.map((p) => `<li>${btn(`Give the room to ${esc(p.name)}`, 'handOver', { arg: p.uid, kind: 'choice', disabled: ui.busy })}</li>`).join('')}</ul></details>` : '';
    return `${over ? gameOver(data) : ''}
      <section class="room-code">${over ? '<h2 class="label">Room code</h2>' : '<h1 class="label">Room code</h1>'}<p class="big">${esc(code)}</p><p>Read it out loud so players can join.</p></section>
      <h2>Players (${players.length})</h2>
      <ol class="ruled numbered">${rows}</ol>
      ${btn('New game', 'newGame', { disabled: short || ui.busy, extra: short ? ' aria-describedby="why-not"' : '' })}
      ${short ? `<p id="why-not" class="hint">Needs at least ${MIN_PLAYERS} players, you included. ${players.length} here so far.</p>` : ''}
      ${errorLine(ui.error)}
      ${handOver}
      ${others.length ? '<p class="hint">Hand the room to someone before you leave.</p>'
    : `${btn('Leave room', 'leave', { kind: 'link' })}<p class="hint">Nobody else is here, so leaving deletes this room.</p>`}`;
  },

  // Seated, voting. Nothing here depends on who the spy is: only the word text differs.
  vote: (s) => {
    const { uid, data } = s;
    // The order and the vote are one list: every other name is a vote button until this phone has voted.
    const canVote = data.myVote === null;
    return `<h1 class="label">Your word</h1>
    <p class="word">${data.myWord ? esc(data.myWord) : '<span class="status">Getting your word…</span>'}</p>
    ${finalLine(data.room)}
    ${voteStatus(s)}
    <h2>Speaking order</h2>
    <p class="hint">Say one clue each, in this order. Don't say your word!${canVote ? ' Then tap who you think is the spy. You can only vote once.' : ''}</p>
    <ol class="ruled numbered order">${data.room.roundPlayers.map((id) => `<li>${canVote && id !== uid
    ? btn(esc(nameOf(data, id)), 'vote', { arg: id, kind: 'choice', disabled: s.ui.busy, extra: ` aria-label="Vote for ${esc(nameOf(data, id))}"` })
    : `<span>${esc(nameOf(data, id))}${you(id === uid)}</span>`}</li>`).join('')}</ol>
    ${errorLine(s.ui.error)}
    ${scoreLine(data.room.score)}`;
  },

  // Benched players see no word, ever: only the scoreboard.
  bench: (s) => `<h1>You're on the ${bench(s.data.room, s.uid)} bench</h1>
    <p>You win or lose with your team. Watch the score.</p>
    ${stallLine(s)}
    ${scoreboard(s.data)}`,

  lateJoiner: (s) => `<h1>A game is in progress. You're in the next one.</h1>${stallLine(s)}`,

  result: (s) => {
    const { uid, data } = s;
    const b = bench(data.room, uid);
    const playing = data.room.seats.includes(uid);
    return `<section class="result">${verdict(data)}</section>
      ${b ? `<p class="you"><b>You're on the ${b} bench.</b></p>` : ''}
      <p role="status">${playing || b ? nextLine(data.room) : "You're in the next game."}</p>
      ${stallLine(s)}
      ${scoreboard(data)}`;
  },

  gameOver: ({ data }) => `${gameOver(data)}<p>Waiting for ${esc(data.room.gmName)} to start a new game.</p>`,
};

export function view(s) {
  const screen = screenFor(s);
  const ui = s.ui || {};
  const st = { ...s, ui };
  const code = s.data && s.data.room && !oldRoom(s.data.room) ? s.code : null;
  const inRoom = !['join', 'loading'].includes(screen);
  const host = inRoom && isHost(st);
  // The host's game screens are a player's plus these two; the host leaves only from the lobby screen.
  const game = host && midGame(s.data.room);
  // join, lobby and vote place their own error next to their controls.
  const ownError = ['join', 'lobby', 'vote'].includes(screen);
  const body = `${game ? keepOpen : ''}${host ? errorLine(ui.runError) : ''}${screens[screen](st)}${game ? removeList(st) : ''}${inRoom && !host ? leaveBlock(st) : ''}${ownError ? '' : errorLine(ui.error)}`;
  return `<header class="cover"><span class="title">${GAME_NAME}</span>${code ? `<span class="code-chip">Room <b>${esc(code)}</b></span>` : ''}</header>
<main class="page" data-screen="${screen}">${body}</main>`;
}

// UI state that must not outlive its cause, given the previous and next state.
export function settle(prev, next) {
  const ui = { ...next.ui };
  if (!prev) return ui;
  if (screenFor(prev) !== screenFor(next)) ui.error = null;
  if (prev.data?.room?.round !== next.data?.room?.round) Object.assign(ui, { confirmRemove: null, confirmLeave: false });
  return ui;
}

const TAP_GUARD_MS = 300;

export function render(root, s, actions) {
  const html = view(s);
  // Same markup: leave the DOM alone so typing and focus survive unrelated updates.
  if (root.renderedHtml === html) return;
  // A new screen, phase, vote sent, or a question under the finger: drop the second tap of a double tap.
  const key = `${screenFor(s)}:${s.data?.room?.phase}:${!!s.data?.myVote}:${s.ui.confirmRemove ?? ''}:${!!s.ui.confirmLeave}`;
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
  // An open section stays open across re-renders (votes arriving re-render the page).
  for (const d of root.querySelectorAll('details[data-open]')) {
    d.addEventListener('toggle', () => actions.setOpen(d.dataset.open, d.open));
  }
  for (const f of root.querySelectorAll('[data-submit]')) {
    f.addEventListener('submit', (e) => { e.preventDefault(); if (ready()) actions[f.dataset.submit](); });
  }
}
