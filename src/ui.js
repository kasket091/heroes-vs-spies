// Screens. `view` and `screenFor` are pure (no DOM) so they can be tested in node;
// `render` writes the markup and wires the buttons to `actions`.
// Nothing here may read gm/secret, the used pairs or the votes: the host's screens are a player's.
import { MIN_PLAYERS, stalled } from './game.js';

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

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A room made by an older version has no `inGame`.
const oldRoom = (room) => !!room && !Array.isArray(room.inGame);
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
  if (room.inGame.includes(uid)) return 'vote';
  return room.out.includes(uid) ? 'out' : 'lateJoiner';
}

const nameOf = (data, uid) => data.room.names?.[uid] ?? data.players.find((x) => x.uid === uid)?.name ?? 'A player who left';

const btn = (label, action, { arg = '', kind = 'primary', disabled = false, extra = '' } = {}) =>
  `<button type="button" class="btn ${kind}" data-action="${action}" data-arg="${esc(arg)}"${disabled ? ' disabled' : ''}${extra}>${label}</button>`;

const errorLine = (msg) => (msg ? `<p class="error" role="alert"><b>Problem:</b> ${esc(msg)}</p>` : '');

const you = (on) => (on ? ' <i>(you)</i>' : '');

// Players other than the host can always leave; a player still in the game is asked first.
function leaveBlock({ uid, data, ui }) {
  const { room } = data;
  if (!(midGame(room) && room.inGame.includes(uid))) return btn('Leave room', 'leave', { kind: 'link' });
  if (!ui.confirmLeave) return btn('Leave room', 'askLeave', { kind: 'link' });
  return `<div class="ask" role="group" aria-label="Leave room">
    <p><b>You're in a game. Leaving can hold it up for the others.</b></p>
    <div class="row-actions">${btn('Yes, leave', 'leave', { kind: 'danger small', disabled: ui.busy })}${btn('Stay', 'stay', { kind: 'secondary small' })}</div></div>`;
}

const nameList = (data, list, empty = 'Nobody yet') => (list.length
  ? `<ul class="ruled">${list.map((id) => `<li><span>${esc(nameOf(data, id))}</span></li>`).join('')}</ul>`
  : `<p class="hint">${empty}</p>`);

const wordsList = (r) => `<dl class="ruled pairs">
  <div><dt>Healthy word</dt><dd>${esc(r.common)}</dd></div>
  <div><dt>Virus word</dt><dd>${esc(r.odd)}</dd></div></dl>`;

const pointsText = (n) => `<b>${n}</b> point${n === 1 ? '' : 's'}`;
const pts = (n) => `<span class="pts">${pointsText(n)}</span>`;

// Everyone dealt into this game, in a fixed order: still in, voted out, removed.
const dealt = (room) => [...room.inGame, ...room.out, ...room.gone];

// Points change only in a result, which names that round's carrier, so this table never points at the current one.
function pointsTable({ uid, data }) {
  const { room } = data;
  const score = (id) => room.points?.[id] ?? 0;
  const rows = dealt(room).map((id, i) => ({ id, i })).sort((x, y) => score(y.id) - score(x.id) || x.i - y.i)
    .map(({ id }) => `<li><span>${esc(nameOf(data, id))}${you(id === uid)}</span>${pts(score(id))}</li>`).join('');
  return `<section aria-label="Points"><h2>Points</h2><ol class="ruled tally">${rows}</ol></section>`;
}

// `final` stays true after a voided final and at game over: read it only during voting.
const finalLine = (room) => (room.final && room.phase === 'voting'
  ? '<p class="final"><b>Final battle!</b> Three of you left. This vote decides the top three.</p>' : '');

// "+2 Ann", "+1 Ben, Cara": the points a result just gave.
function gainsLines(data) {
  const { room } = data;
  const { gains } = room.result;
  const amounts = [...new Set(Object.values(gains))].sort((x, y) => y - x);
  if (!amounts.length) return '<p class="gains">No points this round.</p>';
  return amounts.map((n) => `<p class="gains"><b>+${n}</b> ${dealt(room).filter((id) => gains[id] === n).map((id) => esc(nameOf(data, id))).join(', ')}</p>`).join('');
}

// Every result names that round's carrier and shows both words. `heading` is the h1 tag (h2 under a game-over title).
function verdict(data, heading = 'h1') {
  const { room } = data;
  const r = room.result;
  const out = esc(r.outName ?? nameOf(data, r.outUid));
  const hiding = `<p class="verdict">The virus was hiding in <b>${esc(r.carrierName ?? nameOf(data, r.carrierUid))}</b>.</p>`;
  const head = r.voided ? `<b>${out}</b> left. This round doesn't count.`
    : r.wasCarrier ? `<b>${out}</b> had the virus! ${out} is cured.`
    // In the final nobody is sent to rest: the three of them make the podium.
    : `<b>${out}</b> was healthy${room.phase === 'gameOver' ? '' : ' and is sent to rest'}.`;
  return `<${heading} class="reveal">${head}</${heading}>${r.wasCarrier ? '' : hiding}${wordsList(r)}${gainsLines(data)}`;
}

// Only phones other than the host's say this: the host's own trouble shows as its run error.
const stallLine = (s) => {
  const { room, waiting } = s.data;
  const allVoted = room.phase === 'voting' && waiting?.length === 0;
  return !isHost(s) && s.since != null && stalled({ phase: room.phase, allVoted, since: s.since, now: s.now })
    ? `<p class="stall" role="status">Waiting for ${esc(room.gmName)}'s phone. Ask them to open the game.</p>` : '';
};

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;

// Reads the ranking stored with the result; never works it out again.
function gameOver({ uid, data }) {
  const { room } = data;
  const list = room.ranking ?? [];
  const hadFinal = list.some((e) => e.group === 'podium');
  const group = (g, title) => {
    const rows = list.filter((e) => e.group === g);
    return rows.length ? `${title ? `<h2>${title}</h2>` : ''}<ol class="ruled ranking ${g}">${rows.map((e) => `<li><span class="place">${ordinal(e.place)}</span><span class="who">${esc(e.name ?? nameOf(data, e.uid))}${you(e.uid === uid)}</span>${pts(e.points)}</li>`).join('')}</ol>` : '';
  };
  const head = !hadFinal ? 'Not enough players left.' : room.result?.wasCarrier ? 'The Heroes caught the virus!' : 'The virus got away!';
  return `<section class="result"><h1>${head}</h1>
    ${hadFinal && room.result ? verdict(data, 'h2') : ''}
    ${group('podium', 'Top three')}${group('out', hadFinal ? 'Voted out' : '')}${group('gone', 'Did not finish')}</section>`;
}

// Removing a player still in the game mid-vote voids the round, so those rows ask first. The host cannot remove themselves.
function removeList({ uid, data, ui }) {
  const { room } = data;
  const asks = (id) => room.phase === 'voting' && room.inGame.includes(id);
  // inGame too: a player who left has no record any more but still holds up the round.
  const ids = [...new Set([...data.players.map((p) => p.uid), ...room.inGame])].filter((id) => id !== uid);
  const rows = ids.map((id) => ({ uid: id, name: nameOf(data, id) })).map((p) => (ui.confirmRemove === p.uid && asks(p.uid)
    ? `<li class="confirm"><span>Remove ${esc(p.name)}? This round won't count.</span>
        <span class="row-actions">${btn('Yes, remove', 'remove', { arg: p.uid, kind: 'danger small', disabled: ui.busy })}${btn('Keep', 'cancelRemove', { kind: 'secondary small' })}</span></li>`
    : `<li><span>${esc(p.name)}</span><span class="row-actions">${btn('Remove', 'remove', { arg: p.uid, kind: 'secondary small', disabled: ui.busy, extra: ` aria-label="Remove ${esc(p.name)}"` })}</span></li>`)).join('');
  // For a player who just will not vote: removing them would cancel the round.
  const close = room.phase !== 'voting' ? '' : ui.confirmClose
    ? `<div class="close-vote"><p><b>Close the vote now? Counts the votes cast so far.</b></p>
      <div class="row-actions">${btn('Yes, close', 'closeVote', { kind: 'primary small', disabled: ui.busy })}${btn('Keep', 'cancelClose', { kind: 'secondary small' })}</div></div>`
    : `<div class="close-vote">${btn('Close the vote now', 'closeVote', { kind: 'secondary', disabled: ui.busy })}<p class="hint">Counts the votes cast so far.</p></div>`;
  return `<details class="manage" data-open="openRemove"${ui.confirmRemove || ui.confirmClose || ui.openRemove ? ' open' : ''}><summary>Remove a player</summary><ol class="ruled">${rows}</ol>${close}</details>`;
}

const keepOpen = '<p class="keep">Your phone runs this room. Keep this screen open.</p>';

const playerList = ({ uid, data }) => `<h2>Players (${data.players.length})</h2>
    <ol class="ruled numbered">${data.players.map((p) => `<li><span>${esc(p.name)}${you(p.uid === uid)}</span></li>`).join('')}</ol>`;

// What this phone knows about its own vote; shown above the order so it is seen without scrolling.
// Who the round is waiting for: public, the same on every phone. Shown in speaking order, whatever order the list arrived in.
function waitText(data) {
  const left = data.room.roundPlayers.filter((id) => data.waiting?.includes(id));
  return left.length ? `Waiting for: ${left.map((id) => esc(nameOf(data, id))).join(', ')}` : 'Everyone has voted.';
}
const waitLine = (s, prefix = '') => `<p class="sent" role="status">${prefix}${waitText(s.data)}</p>${stallLine(s)}`;

function voteStatus(s) {
  const { myVote } = s.data;
  if (myVote === undefined) return '<p class="status" role="status">Checking your vote…</p>';
  return waitLine(s, myVote ? '<b>Vote sent.</b> ' : '');
}

// The same words whether the virus stays or jumps: no phone knows which.
function nextLine(room) {
  const left = room.inGame.length;
  if (left < 3) return 'The game ends in a moment.';
  return `The virus is on the move. ${left === 3 ? 'The final battle starts in a moment.' : 'Next round starts in a moment.'}`;
}

const story = '<p class="story">A virus is hiding in one of you. Find it before it moves on.</p>';

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
    ${story}
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
    return `${over ? gameOver({ uid, data }) : ''}
      <section class="room-code">${over ? '<h2 class="label">Room code</h2>' : '<h1 class="label">Room code</h1>'}<p class="big">${esc(code)}</p><p>Read it out loud so players can join.</p></section>
      ${over ? '' : story}
      <h2>Players (${players.length})</h2>
      <ol class="ruled numbered">${rows}</ol>
      ${btn('New game', 'newGame', { disabled: short || ui.busy, extra: short ? ' aria-describedby="why-not"' : '' })}
      ${short ? `<p id="why-not" class="hint">Needs at least ${MIN_PLAYERS} players, you included. ${players.length} here so far.</p>` : ''}
      ${errorLine(ui.error)}
      ${handOver}
      ${others.length ? '<p class="hint">Hand the room to someone before you leave.</p>'
    : `${btn('Leave room', 'leave', { kind: 'link' })}<p class="hint">Nobody else is here, so leaving deletes this room.</p>`}`;
  },

  // In the game, voting. Nothing here depends on who carries the virus: only the word text differs.
  vote: (s) => {
    const { uid, data } = s;
    // The order and the vote are one list: every other name is a vote button until this phone has voted.
    const canVote = data.myVote === null;
    return `<h1 class="label">Your word</h1>
    <p class="word">${data.myWord ? esc(data.myWord) : '<span class="status">Getting your word…</span>'}</p>
    ${finalLine(data.room)}
    ${voteStatus(s)}
    <h2>Speaking order</h2>
    <p class="hint">Say one clue each, in this order. Don't say your word!${canVote ? ' Then tap who you think has the virus. You can only vote once.' : ''}</p>
    <ol class="ruled numbered order">${data.room.roundPlayers.map((id) => `<li>${canVote && id !== uid
    ? btn(esc(nameOf(data, id)), 'vote', { arg: id, kind: 'choice', disabled: s.ui.busy, extra: ` aria-label="Vote for ${esc(nameOf(data, id))}"` })
    : `<span>${esc(nameOf(data, id))}${you(id === uid)}</span>`}</li>`).join('')}</ol>
    ${errorLine(s.ui.error)}
    <p class="mine">You have ${pointsText(data.room.points?.[uid] ?? 0)}.</p>`;
  },

  // Voted out: no word, ever. Points and who is out.
  out: (s) => `<h1>You are out.</h1>
    <p>Watch the Heroes hunt the virus.</p>
    ${waitLine(s)}
    ${pointsTable(s)}
    <h2>Out</h2>${nameList(s.data, s.data.room.out)}`,

  lateJoiner: (s) => `<h1>A game is in progress. You're in the next one.</h1>${waitLine(s)}`,

  result: (s) => {
    const { uid, data } = s;
    const { room } = data;
    const playing = room.inGame.includes(uid) || room.out.includes(uid);
    return `<section class="result">${verdict(data)}</section>
      <p class="next" role="status">${playing ? nextLine(room) : "You're in the next game."}</p>
      ${stallLine(s)}
      ${pointsTable(s)}`;
  },

  gameOver: (s) => `${gameOver(s)}<p>Waiting for ${esc(s.data.room.gmName)} to start a new game.</p>`,
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
  if (prev.data?.room?.round !== next.data?.room?.round) Object.assign(ui, { confirmRemove: null, confirmLeave: false, confirmClose: false });
  return ui;
}

const TAP_GUARD_MS = 300;

export function render(root, s, actions) {
  const html = view(s);
  // Same markup: leave the DOM alone so typing and focus survive unrelated updates.
  if (root.renderedHtml === html) return;
  // A new screen, phase, vote sent, or a question under the finger: drop the second tap of a double tap.
  const key = `${screenFor(s)}:${s.data?.room?.phase}:${!!s.data?.myVote}:${s.ui.confirmRemove ?? ''}:${!!s.ui.confirmLeave}:${!!s.ui.confirmClose}`;
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
