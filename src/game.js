// Pure game rules: no Firebase, no DOM.
export const MIN_PLAYERS = 4;

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

// A starter is safe when the spy speaks 3rd or later.
export function safeStarters(playerIds, spyId) {
  const n = playerIds.length;
  const spy = playerIds.indexOf(spyId);
  return playerIds.filter((_, i) => (((spy - i) % n) + n) % n >= 2);
}

export function speakingOrder(playerIds, starterId) {
  const i = playerIds.indexOf(starterId);
  return [...playerIds.slice(i), ...playerIds.slice(0, i)];
}

export const pickSpy = (playerIds, rand = Math.random) => pick(playerIds, rand);

export function dealPair(pair, rand = Math.random) {
  const flip = rand() >= 0.5;
  return { common: pair[flip ? 1 : 0], spy: pair[flip ? 0 : 1] };
}

export function validPair(a, b) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x !== '' && y !== '' && x !== y;
}

export function cleanName(raw) {
  return raw.slice(0, 20).trim() || null;
}

// Only the first round of a word set protects the spy: repeated every round it would clear two more players each time.
export const starterChoices = (activeIds, spyId, firstRound) =>
  firstRound && activeIds.length >= 5 ? safeStarters(activeIds, spyId) : [...activeIds];

// Most votes goes out; a tie (or no votes) draws among the tied, in activeIds order.
export function whoIsOut(votes, activeIds, rand = Math.random) {
  const counts = Object.fromEntries(activeIds.map((id) => [id, 0]));
  for (const target of Object.values(votes)) if (Object.hasOwn(counts, target)) counts[target]++;
  const max = Math.max(...Object.values(counts));
  return pick(activeIds.filter((id) => counts[id] === max), rand);
}

export const finalPoints = ({ heroes, spies }) => Math.abs(heroes - spies) + 1;

export function scoreRound({ outUid, spyUid, score, final }) {
  const wasSpy = outUid === spyUid;
  const team = wasSpy ? 'heroes' : 'spies';
  const points = final ? finalPoints(score) : 1;
  return { wasSpy, team, points, score: { ...score, [team]: score[team] + points } };
}

export const stage = (activeCount) => (activeCount > 3 ? 'round' : activeCount === 3 ? 'final' : 'over');

export const gameWinner = ({ heroes, spies }) => (heroes > spies ? 'heroes' : spies > heroes ? 'spies' : 'draw');

export function teams({ active, heroBench, spyBench, spyUid }) {
  return {
    heroes: [...active.filter((id) => id !== spyUid), ...heroBench],
    spies: [...active.filter((id) => id === spyUid), ...spyBench],
  };
}

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function newRoomCode(rand = Math.random) {
  return Array.from({ length: 4 }, () => pick(CODE_LETTERS, rand)).join('');
}

export const isRoomCode = (code) => new RegExp(`^[${CODE_LETTERS}]{4}$`).test(code);
