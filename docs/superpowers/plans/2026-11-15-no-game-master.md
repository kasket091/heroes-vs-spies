# No Game Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heroes vs Spies runs itself: no game master, random words from word families that never repeat in a room, and the room's creator only taps "New game".

**Architecture:** The room creator (the host, still stored as `gmUid`) becomes a normal player whose phone runs the room in the background: it deals, picks the first speaker, closes the vote when everyone has voted and advances about 10 seconds after each result. It reads the secret only inside those steps, never into anything a screen draws. New rooms store the list of players still in under a new name so pages from before this change refuse them.

**Tech Stack:** unchanged (Vite, vanilla JS, Firebase JS SDK v12, Vitest, Firebase emulators with the project-local Java).

**Spec:** `docs/superpowers/specs/2026-11-15-no-game-master-design.md` (read it first), building on `2026-11-15-heroes-vs-spies-design.md` and `2026-11-15-room-cleanup-design.md`.

## Global Constraints

- No screen, the host's included, shows or hints the spy or the other word before the game reveals it. During a round the host's screen equals any player's apart from "Remove a player" and the line "Your phone runs this room. Keep this screen open."
- The used-pairs record is readable by the host's phone only. Nothing public narrows down the pair in play.
- At least 4 people in the room to start, the host included.
- A pair is any two words from one family in `words/word-families.json`; a pair never repeats in a room; when all are used the record is cleared.
- First speaker: random among `starterChoices(seats order, spy, first round of the word set)`.
- Votes are open from the start of a round, cast once, never changed. No vote timer.
- Result shows about 10 seconds, then the next step runs by itself. Every automatic step is safe to run twice (two tabs, a reload).
- A game must never be left stuck: a non-voter can be removed by the host; players other than the host can always leave; a host alone can leave (the room is deleted); a host with others present hands the room over between games.
- Access rules loosen in exactly two ways: the host may have a player record; a player may set `votedRound` on their own record. Everything else is unchanged or tighter. Every refusal test is paired with an allowed case on the same path.
- Scoring, benches, ties, the final battle, who wins, late joiners, the lock record, expiry stamps and delete-on-leave are unchanged unless stated here.
- Dave's planning checks: no money and no previews. The automatic advance is a timer on the host's phone, not a scheduled job; nothing runs on deploy night.
- UI work uses the `impeccable` skill and keeps the writing-pad look. Finish with `superpowers:verification-before-completion`.

## Review Focus

1. **Every way back in, for every role.** Reload, the plain link, typing the code, a second tab: host (still in, benched), active player, benched player, late joiner, removed player. The host reloading during the countdown or with all votes in must carry on, exactly once. (Task 2 tests `re-entry: ...`, Task 3 tests `screenFor re-entry: ...`)
2. **Updating a live game.** An old page must refuse a new room (no `active` array); the new page must refuse a current-version room ("older version"); the current page must keep working under the new rules; rules deploy before hosting. (Task 2 test `old page refuses`, Task 3 test `old room`, Task 4 Step 3)
3. **Ways a game can stop.** Someone never votes; the host's phone sleeps mid-vote and mid-result; the host is voted out; a player leaves mid-game; removals drop it below 3. Each has a way forward and none scores twice. (Task 2 tests `stall: ...`)
4. **Trade-offs carried over, now under new conditions.** The first-round starter rule with a random pick still clears exactly two players once per word set and nothing more; votes open during clues reveal nothing through who has voted. (Task 1 `pickStarter`, Task 2 test `voted marks carry no target`)
5. **Word families at the edges.** 378 deals in one room never repeat a pair and the 379th works; the used record is never public; a word's partner cannot be read off any public record. (Task 1 `pickUnusedPair`, Task 2 test `used pairs are host-only`)

## Stored state (decided here so tasks agree)

- `rooms/{code}`: `active` is renamed `seats` (same meaning: uids still in, seat order). New field `resultAt` (milliseconds from the host's clock, written with each result, read only by the host's phone). Everything else as today. `phase` goes straight from a deal to `'voting'`; `'clues'` is no longer used.
- `rooms/{code}/players/{uid}`: the host has one too. New optional field `votedRound` (integer): the round this player has voted in.
- `rooms/{code}/gm/used`: `{ keys: string[], expiresAt }`, pair keys already dealt in this room. `gm/secret` and `gm/lock` as today.
- A pair key is `"<family index>:<i>-<j>"` with `i < j`.

---

### Task 1: Rules for an automatic game

**Files:**
- Modify: `src/game.js`, `tests/game.test.js`

**Interfaces:**
- Produces (pure; `rand` defaults to `Math.random`):
  - `pairKeys(families: string[][]): string[]` every key, in order
  - `pickUnusedPair(families, usedKeys: string[], rand?): { key: string, pair: [string, string], usedKeys: string[] }` (when every key is used, starts over: the returned `usedKeys` holds only the new key)
  - `pickStarter(seats: string[], spyId: string, firstRound: boolean, rand?): string` random among `starterChoices`
  - `waitingFor(roundPlayers: string[], players: { uid: string, votedRound?: number }[], round: number): string[]` uids still to vote, in `roundPlayers` order
  - `hostStep({ phase, allVoted, resultAt, now }): 'close' | 'advance' | { wait: number } | null` what the host's phone should do: `voting` with `allVoted` gives `'close'`; `result` gives `'advance'` once `now - resultAt >= 10000`, else `{ wait: remaining ms }`; anything else `null`
  - `stalled({ phase, allVoted, since, now }): boolean` for other phones: `voting` with `allVoted` for 10 s or more, or `result` for 20 s or more; `since` is when that phone first saw the state
- Removes nothing yet (`dealPair`, `validPair` stay until Task 2).

- [ ] **Step 1: Write the failing tests**

```js
const F = [['Cola', 'Water', 'Juice', 'Milk'], ['Dog', 'Cat', 'Rabbit', 'Hamster']];
test('pairKeys: 6 per family of 4', () => {
  expect(pairKeys(F)).toHaveLength(12);
  expect(pairKeys(F)[0]).toBe('0:0-1');
});
test('pickUnusedPair never repeats, then starts over', () => {
  let used = []; const seen = new Set();
  for (let n = 0; n < 12; n += 1) {
    const r = pickUnusedPair(F, used, Math.random);
    expect(seen.has(r.key)).toBe(false); seen.add(r.key); used = r.usedKeys;
  }
  expect(used).toHaveLength(12);
  const again = pickUnusedPair(F, used, () => 0);
  expect(again.usedKeys).toEqual([again.key]);
});
test('pickUnusedPair returns two different words of one family', () => {
  const r = pickUnusedPair(F, [], () => 0);
  expect(r.key).toBe('0:0-1');
  expect(r.pair).toEqual(['Cola', 'Water']);
});
test('the real list: 378 deals without a repeat', () => {
  let used = []; const seen = new Set();
  for (let n = 0; n < 378; n += 1) { const r = pickUnusedPair(families, used); seen.add(r.key); used = r.usedKeys; }
  expect(seen.size).toBe(378);
});
test('pickStarter keeps two speakers ahead of the spy only in a first round of 5 or more', () => {
  const P = ['a', 'b', 'c', 'd', 'e'];
  for (const r of [0, 0.3, 0.6, 0.99]) expect(['a', 'd', 'e']).toContain(pickStarter(P, 'c', true, () => r));
  expect(pickStarter(P, 'c', false, () => 0.5)).toBe('c');
  expect(pickStarter(['a', 'b', 'c', 'd'], 'a', true, () => 0)).toBe('a');
});
test('waitingFor lists who has not voted this round', () => {
  const players = [{ uid: 'a', votedRound: 7 }, { uid: 'b', votedRound: 6 }, { uid: 'c' }, { uid: 'x', votedRound: 7 }];
  expect(waitingFor(['c', 'a', 'b'], players, 7)).toEqual(['c', 'b']);
});
test('hostStep', () => {
  expect(hostStep({ phase: 'voting', allVoted: true, now: 0 })).toBe('close');
  expect(hostStep({ phase: 'voting', allVoted: false, now: 0 })).toBeNull();
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 4000 })).toEqual({ wait: 7000 });
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 11000 })).toBe('advance');
  expect(hostStep({ phase: 'result', resultAt: 1000, now: 999999 })).toBe('advance');
  expect(hostStep({ phase: 'lobby', now: 0 })).toBeNull();
  expect(hostStep({ phase: 'gameOver', now: 0 })).toBeNull();
});
test('stalled', () => {
  expect(stalled({ phase: 'voting', allVoted: true, since: 0, now: 9000 })).toBe(false);
  expect(stalled({ phase: 'voting', allVoted: true, since: 0, now: 10000 })).toBe(true);
  expect(stalled({ phase: 'voting', allVoted: false, since: 0, now: 600000 })).toBe(false);
  expect(stalled({ phase: 'result', since: 0, now: 19000 })).toBe(false);
  expect(stalled({ phase: 'result', since: 0, now: 20000 })).toBe(true);
});
```

(`families` is `words/word-families.json`, imported in the test.)

- [ ] **Step 2:** `npm run test:unit` fails on the missing exports.
- [ ] **Step 3:** Implement them in `src/game.js`.
- [ ] **Step 4:** `npm run test:unit` and `npm test` pass (185 before this task).
- [ ] **Step 5: Commit.**

### Task 2: Room logic without a game master

**Files:**
- Modify: `src/room.js`, `src/game.js` (remove `dealPair`, `validPair`), `firestore.rules`, `tests/room.test.js`, `tests/rules.test.js`, `tests/game.test.js`
- Delete: `words/word-pairs.json`

**Interfaces:**
- Consumes: Task 1's functions; the stored state above.
- Produces (each takes `db` first; "host only" means `gmUid`):
  - `createRoom(db, uid, rawName)`: also creates the host's own player record; a new room has `seats: []`.
  - `joinRoom`: unchanged for players; the host re-typing their code returns quietly. Refuses a room with no `seats` array with `Error('Old room')`.
  - `startGame(db, code, families, rand?)` (host only): in `lobby` or `gameOver`, with at least `MIN_PLAYERS` player records (host included): new game state as today, then deals (below).
  - Internal deal: `pickUnusedPair` against `gm/used`, a random side for the spy, `pickSpy` among `seats`, `pickStarter`; writes `gm/used`, `gm/secret`, a `private` record per seat, and the room with `roundPlayers` in speaking order, `starterUid`, `setStart: true`, `phase: 'voting'`, `result: null`, `resultAt: null`.
  - `advance(db, code, families, rand?)` (host only): one transaction; does nothing unless `phase === 'result'`. Ends the game when fewer than 3 seats; deals new words when `needsWords`; otherwise the same word set with `round + 1`, a new random starter, `setStart: false`, `phase: 'voting'`.
  - `castVote(db, code, uid, target)`: as today, and sets `votedRound` to the current round on the caller's own player record.
  - `closeVoting(db, code, rand?)` (host only): as today, with `seats` and `resultAt: Date.now()` on every result.
  - `removePlayer(db, code, uid)` (host only): as today with `seats` and `resultAt`; refuses the host's own uid with `Error('Hand the room over first')`.
  - `leaveRoom(db, code, uid)`: a player other than the host may leave at any time (deletes their own record). 
  - `deleteRoom(db, code)` (host only): deletes the room, `gm/secret`, `gm/used` and the host's own player record when no OTHER player record exists and the phase is `lobby` or `gameOver`; keeps `gm/lock`; returns whether it deleted.
  - `handOverGm(db, code, newHostUid)` (host only, `lobby`/`gameOver`): the new host must have a player record and keeps it; the old host keeps theirs.
  - `subscribe(db, code, uid, onState)`: emits `{ room, players, myWord, myVote, waiting }` for everyone, where `players` carry `votedRound` and `waiting = waitingFor(...)` during `voting`. It never loads `gm/secret` or `gm/used` for anyone. For the host it also emits `votesCast` (votes from `roundPlayers` this round).
  - `runRoom(db, code, families, { now = Date.now, setTimer = setTimeout, rand } = {})` (host only): given each emitted state, applies `hostStep`: `'close'` calls `closeVoting`, `'advance'` calls `advance`, `{ wait }` sets one timer and re-checks. Returns a function that stops it. Running it twice at once must not double any step.
  - Removed: `dealWords`, `nextRound`, `pickStarter`, `openVoting` as public functions.
- Access rules:
  - `players` create: drop the `gmUid != uid` condition. Allowed keys become `name`, `joinedAt`, `expiresAt`, `votedRound`; `votedRound`, when present, must be an integer.
  - `players` update: may also change `votedRound` (integer); `name`, `joinedAt` and `expiresAt` rules as today.
  - Nothing else changes.

- [ ] **Step 1: Write the failing tests** against the emulators (users `h` for the host, `p1`..`p6`), with `families` set to a small fixed list where a test needs a known pair, and `rand`/`now`/`setTimer` injected.

```
createRoom                               the host is in the player list; seats is []
startGame with 3 people                  rejects 'Not enough players'
startGame with 4 (host + 3)              phase 'voting'; seats has 4 including the host; roundPlayers[0] is starterUid;
                                         each seat's subscribe gives a word; exactly one differs; no state anyone
                                         receives contains the secret or the used list
host as spy                              with rand fixed so the host is the spy, the host's state has the spy word as myWord
                                         and is otherwise the same shape as a player's
used pairs are host-only                 a player reading gm/used is refused; the host can; the room doc has no pair keys
no repeat in a room                      with a 1-family list, 6 deals across games give 6 different pairs, the 7th works
voted marks carry no target              after castVote the voter's player record has votedRound and nothing about the target;
                                         every player's `waiting` drops that uid
automatic round                          runRoom running: when the last vote is cast the result appears without any call;
                                         with the injected clock moved 10 s on, the next round starts without any call
whole game from 5                        only startGame is called by hand; it reaches gameOver with a winner
host voted out                           the host is benched; runRoom still closes and advances the following round
stall: non-voter                         one player never votes: phase stays 'voting', waiting names them; removePlayer voids
                                         the round; after the wait the next round starts
stall: host asleep then awake            votes all in and time passed with runRoom stopped: nothing changes; starting runRoom
                                         closes the vote once; a result older than 10 s advances at once
stall: second tab                        two runRoom loops on the same room: one result per round, round number moves by 1
stall: removal below 3                   the next advance gives 'gameOver'; a level score is a draw
removePlayer of the host                 rejects 'Hand the room over first'
player leaves mid-game                   their record is gone; they are still in seats; waiting names them; removing them works
deleteRoom, host alone                   room, secret, used and the host's player record are gone; the lock remains
deleteRoom with another player           returns false; nothing deleted
handOverGm                               new host keeps a player record; old host keeps theirs; the new host's runRoom advances
re-entry: host reload in result          a fresh subscribe + runRoom after 10 s advances exactly once
re-entry: active, benched, late, removed as in the current tests, with seats
old page refuses                         a new room has no `active` field at any phase
old room                                 joinRoom to a room with `active` but no `seats` rejects 'Old room'
```

`tests/rules.test.js` (paired): the host creates their own player record (succeeds); a stranger creates the host's record (FAILS); a player sets their own `votedRound` to an integer (succeeds), to a string (FAILS), on someone else's record (FAILS); a player reads `gm/used` (FAILS), the host reads it (succeeds).

- [ ] **Step 2:** `npm test` fails on the new cases.
- [ ] **Step 3:** Implement. Rename `active` to `seats` everywhere in `src/` and tests. `src/ui.js` and `src/main.js` still call removed names until Task 3: `npm run build` may fail between Task 2 and Task 3; `npm test` must pass, with ui tests that depend on removed things deleted here and listed in the report for Task 3 to replace.
- [ ] **Step 4:** `npm test` passes.
- [ ] **Step 5: Commit.**

### Task 3: Screens

**Files:**
- Modify: `src/ui.js`, `src/main.js`, `src/style.css`, `tests/ui.test.js`, `firebase.json`, `DESIGN.md` and `PRODUCT.md` where they describe a game master

**Interfaces:**
- Consumes: Task 2's state and functions; `stalled`, `finalPoints`, `teams` from `src/game.js`; `words/word-families.json`.
- Produces: `screenFor` and `view` covering (first matching row wins):

| Condition | Screen |
|---|---|
| no room, or a room with no `seats` array | Join / Create; for an old room, "This room is from an older version. Create a new one." |
| `lobby` | Player list with everyone, the host included. Host: **New game** (disabled under 4 people, reason shown), Remove, hand over, and Leave (alone: "leaving deletes this room"; with others: "Hand the room to someone before you leave"). Others: "Waiting for <host> to start the game." and Leave |
| in `players`, not in `seats`, game running | "A game is in progress. You're in the next one." and Leave |
| benched, before `gameOver` | Scoreboard and which bench, as today, and Leave |
| in `seats`, `voting`, not voted | Word, speaking order, "Final battle, worth N" when final, the vote buttons, score line |
| in `seats`, `voting`, voted | Word, order, "Vote sent", "Waiting for: <names>" |
| anyone, `voting`, everyone voted and `stalled` | adds "Waiting for <host>'s phone. Ask them to open the game." |
| anyone, `result` | Result as today, then "Next round starts in a moment." (or "The final battle starts in a moment." / the game-over step), and the stalled line when `stalled` |
| anyone, `gameOver` | As today. Host: **New game**, Remove, hand over, Leave. Others: Leave |

During a game the host's screens also carry a collapsed **Remove a player** and "Your phone runs this room. Keep this screen open." Players other than the host have a low-emphasis **Leave room** on every screen; mid-game it asks "You're in a game. Leaving can hold it up for the others." before leaving.

- `src/main.js`: the host starts `runRoom` when a room opens and stops it on leaving; `newGame` calls `startGame(db, code, families)`; no words, skip, own-words, pick-starter, open-voting, close-voting or next-round actions remain.
- `firebase.json` hosting: `Cache-Control: no-cache` for `/index.html` and `/`, long caching left to the hashed files under `/assets`.

- [ ] **Step 1: Write the failing tests** in `tests/ui.test.js`: one per table row; the host's and a player's views in `voting` are equal once the host-only controls and "(you)" are masked, for the host as spy and as hero; no view before `gameOver` contains the other word or a spy name unless the result carries it; `screenFor re-entry` for each role; `old room`; Leave is offered to an active player with the confirmation and never to a host with others present; nothing in `view` reads `secret`.
- [ ] **Step 2:** `npm test` fails on them.
- [ ] **Step 3:** Build with the `impeccable` skill (read its `SKILL.md`, `reference/operate.md`, and `reference/craft-floor.md` right before the first UI edit), keeping `DESIGN.md`'s look. Remove the game master's words, pick-starter, round and result views.
- [ ] **Step 4:** `npm test` and `npm run build` pass.
- [ ] **Step 5:** Run impeccable `critique`, `audit` and `polish` on the changed screens at 375px wide; fix what they find.
- [ ] **Step 6: Commit.**

### Task 4: Play it, then preview (needs Dave)

- [ ] **Step 1:** With the emulators and dev server, play a whole game from 5 people in the browser (`?dev=NAME`, at most 2 tabs open at once): only New game is tapped by hand. Then by hand: a player who never votes and is removed; the host's tab closed during a result and reopened; a second host tab; a player leaving mid-game; the host alone leaving; hand-over between games.
- [ ] **Step 2:** `superpowers:verification-before-completion`: fresh `npm test` and `npm run build`.
- [ ] **Step 3: Ask Dave before any deploy.** Rules first (`npx firebase deploy --only firestore:rules`): they only add to what the live page may do, so the live game keeps working. Then a preview: `npx firebase hosting:channel:deploy nogm --expires 7d`. State what happens on deploy: rooms from the current version show "older version" on the new page, and new rooms are refused by any phone still on the current page.
- [ ] **Step 4:** Dave plays a game on real phones at the preview address.

### Task 5: Go live and update the instructions (needs Dave)

- [ ] **Step 1:** With Dave's OK, show the command, then `npm run build` and `npx firebase deploy --only hosting`. Games in progress are abandoned.
- [ ] **Step 2:** Check the live address in a fresh browser session: create a room, the old-version message for a current-version code, and that `/index.html` is served with `Cache-Control: no-cache`.
- [ ] **Step 3:** Rewrite the "Heroes vs Spies: How to Play" document for the new flow (no game master sections; the host's one button; automatic rounds; who the game is waiting for; word families) and export a new PDF.
- [ ] **Step 4:** Commit, merge and push as Dave chooses.
