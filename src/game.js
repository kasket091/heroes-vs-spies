// Pure game rules: no Firebase, no DOM.
export const MIN_PLAYERS = 4;

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

// A starter is safe when the carrier speaks 3rd or later.
export function safeStarters(playerIds, spyId) {
  const n = playerIds.length;
  const spy = playerIds.indexOf(spyId);
  return playerIds.filter((_, i) => (((spy - i) % n) + n) % n >= 2);
}

export function speakingOrder(playerIds, starterId) {
  const i = playerIds.indexOf(starterId);
  return [...playerIds.slice(i), ...playerIds.slice(0, i)];
}

export function cleanName(raw) {
  return raw.slice(0, 20).trim() || null;
}

// The virus is drawn afresh each round from everyone still in, the last carrier included.
export const pickCarrier = (inGame, rand = Math.random) => pick(inGame, rand);

// From 5 players two speak before the carrier.
export const starterChoices = (ids, carrierUid) => (ids.length >= 5 ? safeStarters(ids, carrierUid) : [...ids]);

// votes is { voter: target }. Catching the carrier pays each other voter who named them 1; otherwise the carrier gets 2 (4 in the final).
export function roundGains({ outUid, carrierUid, votes, final }) {
  if (outUid !== carrierUid) return { [carrierUid]: final ? 4 : 2 };
  return Object.fromEntries(Object.entries(votes).filter(([voter, target]) => target === carrierUid && voter !== carrierUid).map(([voter]) => [voter, 1]));
}

// Highest points first, level points share a place (1, 1, 3), ties keep list order. Places continue from `start`.
const place = (uids, points, start, group, names) => {
  const sorted = uids.map((uid) => ({ uid, name: names[uid], points: points[uid] ?? 0, group })).sort((x, y) => y.points - x.points);
  let first = 0;
  return sorted.map((e, i) => { if (i && e.points !== sorted[i - 1].points) first = i; return { ...e, place: start + first }; });
};

export function ranking({ inGame, out, gone, points, names, carrierUid, caught, hadFinal }) {
  const others = inGame.filter((u) => u !== carrierUid);
  const podium = !hadFinal ? [] : caught
    ? [...place(others, points, 1, 'podium', names), ...place([carrierUid], points, 3, 'podium', names)]
    : [...place([carrierUid], points, 1, 'podium', names), ...place(others, points, 2, 'podium', names)];
  const outRank = place(hadFinal ? out : [...inGame, ...out], points, podium.length + 1, 'out', names);
  return [...podium, ...outRank, ...place(gone, points, podium.length + outRank.length + 1, 'gone', names)];
}

// Most votes goes out; a tie (or no votes) draws among the tied, in activeIds order.
export function whoIsOut(votes, activeIds, rand = Math.random) {
  const counts = Object.fromEntries(activeIds.map((id) => [id, 0]));
  for (const target of Object.values(votes)) if (Object.hasOwn(counts, target)) counts[target]++;
  const max = Math.max(...Object.values(counts));
  return pick(activeIds.filter((id) => counts[id] === max), rand);
}

export const stage = (activeCount) => (activeCount > 3 ? 'round' : activeCount === 3 ? 'final' : 'over');

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function newRoomCode(rand = Math.random) {
  return Array.from({ length: 4 }, () => pick(CODE_LETTERS, rand)).join('');
}

export const isRoomCode = (code) => new RegExp(`^[${CODE_LETTERS}]{4}$`).test(code);

// Every pair of words inside one family: "<family>:<i>-<j>", i < j.
export const pairKeys = (families) =>
  families.flatMap((words, f) => words.flatMap((_, i) => words.slice(i + 1).map((__, k) => `${f}:${i}-${i + 1 + k}`)));

// Random unused pair from the families used least so far, so a family returns only after every family has
// come up (people who remember its earlier reveal could rule that pair out). Once every pair is used the list starts over.
export function pickUnusedPair(families, usedKeys, rand = Math.random) {
  const used = new Set(usedKeys);
  const unused = pairKeys(families).filter((k) => !used.has(k));
  const count = {};
  for (const k of used) { const f = k.split(':')[0]; count[f] = (count[f] ?? 0) + 1; }
  const fewest = Math.min(...unused.map((k) => count[k.split(':')[0]] ?? 0));
  const key = pick(unused.length ? unused.filter((k) => (count[k.split(':')[0]] ?? 0) === fewest) : pairKeys(families), rand);
  const [f, i, j] = key.split(/[:-]/).map(Number);
  return { key, pair: [families[f][i], families[f][j]], usedKeys: unused.length ? [...usedKeys, key] : [key] };
}

export const pickStarter = (ids, carrierUid, rand = Math.random) => pick(starterChoices(ids, carrierUid), rand);

export const waitingFor = (roundPlayers, players, round) =>
  roundPlayers.filter((uid) => players.find((p) => p.uid === uid)?.votedRound !== round);

const RESULT_MS = 10000;
const VOTE_STALL_MS = 10000;
const RESULT_STALL_MS = 20000;

// What the host's phone does next; every other phone waits.
export function hostStep({ phase, allVoted, resultAt, now }) {
  if (phase === 'voting') return allVoted ? 'close' : null;
  if (phase === 'result') {
    // No stamp (an older write): do not wait for a time that is not there.
    if (resultAt == null || now - resultAt >= RESULT_MS) return 'advance';
    return { wait: RESULT_MS - (now - resultAt) };
  }
  return null;
}

// True when the host's phone looks stuck, so another phone may step in.
export function stalled({ phase, allVoted, since, now }) {
  if (phase === 'voting') return !!allVoted && now - since >= VOTE_STALL_MS;
  if (phase === 'result') return now - since >= RESULT_STALL_MS;
  return false;
}
