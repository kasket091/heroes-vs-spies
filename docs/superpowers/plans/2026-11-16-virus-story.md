# Jumping Virus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the unreleased no-game-master version into the jumping-virus game: a new carrier and new words every round, a full reveal and personal points after each round, no teams or benches, and a ranking in which the last three always take the top three places.

**Architecture:** Same site and Firebase project, on the `no-game-master` code. Pure rules in `src/game.js` gain carrier picking, round points and the final ranking, and lose the team rules. The room record drops the team score, benches and the continuing word set, and gains points, an out list and a stored ranking, all written by the host's phone in the same transaction as each result. `firestore.rules` is not touched.

**Tech Stack:** unchanged (Vite, vanilla JS, Firebase JS SDK v12, Vitest, Firebase emulators with the project-local Java).

**Spec:** `docs/superpowers/specs/2026-11-16-virus-story-design.md` (read it first), building on `2026-11-15-no-game-master-design.md` and the designs under it.

## Global Constraints

- Every round: a new unused word pair and a new carrier, picked at random from the players still in, never the carrier named in the most recent result of this game if that player is still in. Round 1 of a game excludes nobody.
- First speaker: random; with 6 or more players still in, two speak before the carrier; with 5 or fewer, anyone.
- One player is voted out every round until three are left; then one final round.
- Points: a healthy Hero voted out gives that round's carrier +2; the carrier voted out gives +1 to every player still in who voted for them; in the final the carrier not voted out gets +4 in place of the +2. A cancelled round scores nothing.
- Every result (cancelled ones too) names the carrier and shows both words and the points just earned.
- Nothing may show or hint the CURRENT carrier or the other word before that round's result. The carrier's screen equals a Hero's; the host's equals a player's apart from the host-only controls.
- Ranking, fixed and stored when the game ends, in three groups in this order: the final three; everyone voted out, by points; anyone the host removed before they were voted out, by points, marked "did not finish". Virus survives the final: carrier 1st, the two Heroes 2nd and 3rd by points. Heroes catch it: the two Heroes 1st and 2nd by points, carrier 3rd. Level points share a place only inside a group.
- A game that ends with fewer than three players (no final): players still in and those voted out are ranked together by points, removed players below.
- No teams, no team score, no benches, no "gap plus 1". On screen: "the virus", "the carrier", "cured", "sent to rest". The game's name stays "Heroes vs Spies".
- `firestore.rules` is not changed. Lock record, expiry stamps, `votedRound`, used-pairs record, host run loop, removing, leaving, hand-over, "Close the vote now" all keep their behaviour.
- New rooms store the list of players still in as `inGame`, so pages from the previous preview version (which look for `seats`) and this version refuse each other's rooms.
- Dave's planning checks: no money, no previews of actions, no scheduled job. The automatic advance is a timer on the host's phone and acts on no existing room at deploy.
- UI work uses the `impeccable` skill and keeps the writing-pad look. Finish with `superpowers:verification-before-completion`.

## Review Focus

1. **Every way back in, for every role.** Reload, plain link, typed code, second tab: host (in, voted out), player in the round, voted-out player, late joiner, removed player. Voted-out players land on the points table; a removed player who rejoins waits for the next game. (Task 2 tests `re-entry: ...`, Task 3 tests `screenFor re-entry: ...`)
2. **Rooms and pages from the previous preview version, both directions.** A room with `seats` but no `inGame` is refused by this page and never run by this host loop; a room made here has no `seats`, so the previous page refuses it. (Task 2 tests `previous-version room`, Task 3 test `old room`)
3. **Recovery paths, tested at the control a person uses.** A player who left mid-round still has a Remove row; "Close the vote now" is offered to the host during every vote including the final; Leave is offered to everyone but a host with others present. (Task 3 tests, plus Task 2 for what each control calls)
4. **Trade-offs whose conditions changed.** With a new carrier every round: the named last carrier plus the two protected speakers never leave fewer than three suspects (hence 6, not 5); nothing public identifies the current carrier at any moment between a result and the next. (Task 1 `starterChoices`, Task 2 test `public record never names the current carrier`)
5. **Points and ranking written exactly once.** Two host tabs, a reload during the 10 seconds, a double "Close the vote now": one result, one set of points, one ranking. (Task 2 tests `exactly once: ...`)

## Stored state (decided here so tasks agree)

`rooms/{code}`:
- `inGame`: uids still in, seat order (replaces `seats`). `roundPlayers`: this round's speaking order.
- `out`: uids voted out, in order. `gone`: uids the host removed before they were voted out.
- `points`: `{ uid: number }` for everyone dealt into the game, starting at 0.
- `names`, `round`, `wordSet` (now +1 every round), `starterUid`, `final`, `resultAt`, `phase` (`lobby | voting | result | gameOver`): as today.
- `result` (null during a vote): `{ outUid, outName, wasCarrier, voided, carrierUid, carrierName, common, odd, gains }` where `gains` is `{ uid: number }` just added and is `{}` when nothing was scored.
- `ranking` (only at `gameOver`): array of `{ uid, name, points, place, group }`, `group` one of `'podium' | 'out' | 'gone'`.
- Removed: `seats`, `score`, `heroBench`, `spyBench`, `needsWords`, `setStart`, `winner`.

`rooms/{code}/gm/secret`: `{ common, odd, carrierUid, wordSet, lastCarrierUid }`. `gm/used`, `gm/lock`, `private/{uid}`, `players/{uid}`, `votes/{round}_{uid}`: as today.

---

### Task 1: Rules for the jumping virus

**Files:**
- Modify: `src/game.js`, `tests/game.test.js`

**Interfaces:**
- Produces (pure; `rand` defaults to `Math.random`):
  - `pickCarrier(inGame: string[], lastCarrierUid: string | null, rand?): string` uniform among `inGame` without `lastCarrierUid`
  - `starterChoices(ids: string[], carrierUid: string): string[]` safe starters when `ids.length >= 6`, otherwise everyone (the old third parameter is gone)
  - `pickStarter(ids, carrierUid, rand?): string`
  - `roundGains({ outUid, carrierUid, votes, final }): Record<string, number>` (`votes` is `{ voter: target }`)
  - `ranking({ inGame, out, gone, points, names, carrierUid, caught, hadFinal }): { uid, name, points, place, group }[]`
- Keeps: `whoIsOut`, `stage`, `pairKeys`, `pickUnusedPair`, `waitingFor`, `hostStep`, `stalled`, `speakingOrder`, `safeStarters`, `cleanName`, room-code helpers.
- Removes in Task 2, not here: `finalPoints`, `scoreRound`, `gameWinner`, `teams`, `pickSpy`.

- [ ] **Step 1: Write the failing tests**

```js
test('pickCarrier never returns the last carrier', () => {
  for (const r of [0, 0.34, 0.67, 0.99]) expect(pickCarrier(['a', 'b', 'c', 'd'], 'b', () => r)).not.toBe('b');
  expect(pickCarrier(['a', 'b', 'c'], null, () => 0)).toBe('a');
  expect(pickCarrier(['a', 'b', 'c'], 'x', () => 0.99)).toBe('c');
});
test('starterChoices: two speak before the carrier only from 6 players', () => {
  expect(starterChoices(['a', 'b', 'c', 'd', 'e', 'f'], 'c')).toEqual(['a', 'e', 'f']);
  expect(starterChoices(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['a', 'b', 'c', 'd', 'e']);
});
test('roundGains', () => {
  expect(roundGains({ outUid: 'b', carrierUid: 'c', votes: { a: 'b', c: 'b', d: 'c' }, final: false })).toEqual({ c: 2 });
  expect(roundGains({ outUid: 'c', carrierUid: 'c', votes: { a: 'c', b: 'c', c: 'a', d: 'a' }, final: false })).toEqual({ a: 1, b: 1 });
  expect(roundGains({ outUid: 'a', carrierUid: 'c', votes: { a: 'c', b: 'a', c: 'a' }, final: true })).toEqual({ c: 4 });
  expect(roundGains({ outUid: 'c', carrierUid: 'c', votes: { a: 'c', b: 'c', c: 'a' }, final: true })).toEqual({ a: 1, b: 1 });
  expect(roundGains({ outUid: 'c', carrierUid: 'c', votes: {}, final: false })).toEqual({});
});
const N = { a: 'Ana', b: 'Ben', c: 'Cara', d: 'Dino', e: 'Ella', f: 'Fe' };
const places = (r) => r.map((x) => `${x.place}:${x.uid}:${x.group}`);
test('ranking: the virus survives the final', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d', 'e'], gone: ['f'], names: N, carrierUid: 'c', caught: false, hadFinal: true,
    points: { a: 1, b: 3, c: 4, d: 6, e: 0, f: 9 } });
  expect(places(r)).toEqual(['1:c:podium', '2:b:podium', '3:a:podium', '4:d:out', '5:e:out', '6:f:gone']);
  expect(r[0]).toEqual({ uid: 'c', name: 'Cara', points: 4, place: 1, group: 'podium' });
});
test('ranking: the Heroes catch it', () => {
  const r = ranking({ inGame: ['a', 'b', 'c'], out: ['d'], gone: [], names: N, carrierUid: 'c', caught: true, hadFinal: true,
    points: { a: 2, b: 1, c: 9, d: 5 } });
  expect(places(r)).toEqual(['1:a:podium', '2:b:podium', '3:c:podium', '4:d:out']);
});
test('ranking: level points share a place only inside a group', () => {
  const caught = ranking({ inGame: ['a', 'b', 'c'], out: ['d', 'e'], gone: [], names: N, carrierUid: 'c', caught: true, hadFinal: true,
    points: { a: 2, b: 2, c: 2, d: 2, e: 2 } });
  expect(places(caught)).toEqual(['1:a:podium', '1:b:podium', '3:c:podium', '4:d:out', '4:e:out']);
  const survived = ranking({ inGame: ['a', 'b', 'c'], out: [], gone: [], names: N, carrierUid: 'c', caught: false, hadFinal: true,
    points: { a: 5, b: 5, c: 5 } });
  expect(places(survived)).toEqual(['1:c:podium', '2:a:podium', '2:b:podium']);
});
test('ranking: no final, everyone still in or voted out by points, removed players last', () => {
  const r = ranking({ inGame: ['a', 'b'], out: ['d'], gone: ['f'], names: N, carrierUid: null, caught: false, hadFinal: false,
    points: { a: 1, b: 0, d: 3, f: 7 } });
  expect(places(r)).toEqual(['1:d:out', '2:a:out', '3:b:out', '4:f:gone']);
});
```

(Players level inside a group keep their `inGame` / `out` order. After a shared place the next place skips: 1, 1, 3.)

- [ ] **Step 2:** `npm run test:unit` fails on the missing or changed exports.
- [ ] **Step 3:** Implement. Update the existing `starterChoices` and `pickStarter` tests for the new signature.
- [ ] **Step 4:** `npm run test:unit` passes. `npm test` may fail in `tests/room.test.js` and `tests/ui.test.js` where callers still pass the old third argument; list those in the report for Task 2.
- [ ] **Step 5: Commit.**

### Task 2: Room logic for the jumping virus

**Files:**
- Modify: `src/room.js`, `src/game.js` (remove the team rules), `tests/room.test.js`, `tests/game.test.js`, `tests/rules.test.js` (fixtures only)
- Do not modify: `firestore.rules`

**Interfaces:**
- Consumes: Task 1's functions; the stored state above.
- Produces (host only unless noted):
  - `createRoom`: a new room has `inGame: []`, `out: []`, `gone: []`, `points: {}`, no `seats`.
  - `joinRoom`: refuses a room without an `inGame` array with `Error('Old room')`.
  - `startGame(db, code, families, rand?)`: in `lobby` or `gameOver` with at least `MIN_PLAYERS`: `inGame` = current players, `out` and `gone` empty, `points` 0 for each, `ranking` removed, then deals.
  - Internal deal: `pickUnusedPair`, a random side for the carrier, `pickCarrier(inGame, lastCarrierUid)`, `pickStarter`; writes `gm/used`, `gm/secret` (with the new `carrierUid`; `lastCarrierUid` cleared only by `startGame`), a `private` record per player in `inGame`, and the room (`roundPlayers`, `starterUid`, `final` from `stage`, `wordSet + 1`, `round + 1`, `phase: 'voting'`, `result: null`, `resultAt: null`).
  - `closeVoting(db, code, rand?, round?)`: one transaction, does nothing unless `phase === 'voting'` and the round matches. `whoIsOut`, `roundGains`; writes the full `result`, adds `gains` to `points`, stores `lastCarrierUid` in the secret. Not final: moves the player from `inGame` to `out`, `phase: 'result'`. Final: nobody moves, writes `ranking` and `phase: 'gameOver'`.
  - `advance(db, code, families, rand?, round?)`: one transaction, does nothing unless `phase === 'result'`. With fewer than 3 in `inGame`: writes `ranking` (`hadFinal: false`) and `phase: 'gameOver'`. Otherwise deals a new round.
  - `removePlayer(db, code, uid)`: refuses the host's own uid. Not in `inGame`: deletes the player record only. In `inGame` during `voting`: moves the uid to `gone`, writes a `voided: true` result that names the carrier and both words with empty `gains`, sets `lastCarrierUid` to that round's carrier unless the removed player was the carrier (then null), `phase: 'result'`. In `inGame` during `result`: moves the uid to `gone`; if they were the named last carrier, clears `lastCarrierUid`.
  - `castVote`, `leaveRoom`, `deleteRoom`, `handOverGm`, `touchPlayer`, `runRoom`: as today, with `inGame`. `runRoom` does nothing unless the room has an `inGame` array and this uid is the host.
  - `subscribe`: emits `{ room, players, myWord, myVote, waiting }` (and `votesCast` for the host) as today; `myWord` only when the uid is in `room.inGame` and the private record's `wordSet` matches. Never loads `gm/secret` or `gm/used`.
  - Removed from `src/game.js`: `finalPoints`, `scoreRound`, `gameWinner`, `teams`, `pickSpy`, with their tests.

- [ ] **Step 1: Write the failing tests** against the emulators (host `h`, players `p1`..`p7`), with `rand`, `now` and `setTimer` injected and small fixed family lists where a known pair is needed.

```
new room                                 inGame, out, gone are [], points is {}, no `seats` field at any phase of a game
startGame with 4                         points 0 for all four; phase 'voting'
healthy Hero voted out                   result names the carrier and both words; gains {carrier: 2}; points updated;
                                         the Hero is in `out`, not in `inGame`
carrier voted out                        gains +1 for exactly the players who voted for the carrier; the carrier is in `out`
a new carrier and a new pair every round over a 7-player game: no pair repeats; consecutive rounds never share a carrier;
                                         wordSet moves by 1 each round
previous carrier is excluded             with rand fixed to pick index 0, the next carrier is not the one just named
first round of a new game excludes nobody  after gameOver, startGame can pick the previous game's last carrier
starter rule from 6                      with 6 in the round the carrier is never 1st or 2nd; with 5 the carrier can be 1st
public record never names the current carrier  during every `voting` phase of a whole game, the raw room record read as a
                                         player contains no carrier id, no word, and `result` is null
whole game by itself                     only startGame by hand: reaches gameOver; `ranking` has every player once
final: virus survives                    carrier +4 (not +2); ranking place 1 is the carrier; the Heroes 2 and 3 by points
final: Heroes catch it                   each Hero who voted for the carrier +1; the Heroes 1 and 2 by points; carrier 3
ranking is stored and stays              after gameOver a player leaves the room: `ranking` is unchanged
tie                                      with rand fixed, the drawn player is out and points follow from who that was
close with no votes                      a player is drawn; gains follow; in the final the ranking is written
cancelled round: Hero removed            voided result names the carrier and words, gains {}; uid in `gone`; next round has a
                                         new pair and a carrier other than the one just named
cancelled round: carrier removed         voided result; nobody is excluded from the next pick
removal below 3                          the next advance writes ranking with no podium group and phase 'gameOver'
exactly once: two host loops             two runRoom copies through a whole game: points equal the sum of the gains written;
                                         one result per round
exactly once: reload in result           a fresh runRoom after 10 s advances once
exactly once: closeVoting twice          concurrent calls: one result, points added once
late joiner / re-entry: voted-out player  subscribe gives myWord null and the points; joinRoom again changes nothing
re-entry: removed player rejoins         in players, not in inGame, out or gone-again; dealt in by the next game
previous-version room                    a room with `seats` and no `inGame`: joinRoom rejects 'Old room'; runRoom does nothing
host voted out                           the host is in `out`; runRoom still closes and advances
deleteRoom / handOverGm / leaveRoom      the existing cases still pass with `inGame`
```

- [ ] **Step 2:** `npm test` fails on the new cases.
- [ ] **Step 3:** Implement. `src/ui.js` and `src/main.js` still read the removed fields until Task 3: `npm run build` may still pass or fail, either is accepted; `npm test` must pass, with ui tests that depend on removed fields deleted here and listed in the report for Task 3.
- [ ] **Step 4:** `npm test` passes; `git diff main -- firestore.rules` is unchanged from before this task.
- [ ] **Step 5: Commit.**

### Task 3: Screens and story

**Files:**
- Modify: `src/ui.js`, `src/main.js`, `src/style.css`, `tests/ui.test.js`, `DESIGN.md`, `PRODUCT.md`, `.impeccable/surfaces/src-ui-js.md`

**Interfaces:**
- Consumes: Task 2's state; `stalled` from `src/game.js`.
- Produces: `screenFor` and `view` covering (first matching row wins):

| Condition | Screen |
|---|---|
| no room, or a room with no `inGame` array | Join / Create; for an old room, "This room is from an older version. Create a new one." |
| `lobby` | As today (host: New game, Remove, hand over, Leave rules; others: waiting and Leave), with one line of story: "A virus is hiding in one of you. Find it before it jumps." |
| `gameOver` | The ranking from `room.ranking`: place, name, points; the podium three set apart; "did not finish" on the `gone` group; one line for how it ended ("The virus got away!" / "The Heroes caught the virus!", or "Not enough players left." with no final). Then the lobby controls for the host, Leave for others |
| `result` | The reveal: "<name> had the virus! <name> is cured." or "<name> was healthy and is sent to rest. The virus was hiding in <carrier>." or, cancelled, "<name> left. This round doesn't count. The virus was hiding in <carrier>."; both words; the points just earned ("+2 <name>", "+1 <names>"); the points table; "The virus has jumped again. Next round starts in a moment." (or the final / game-over wording); the stalled line when `stalled` |
| in `players`, not in `inGame` or `out`, game running | "A game is in progress. You're in the next one." with the waiting line during a vote |
| in `out` (voted out), `voting` | "You are out. Watch the Heroes hunt the virus.", the waiting line, the points table, the list of who is out |
| in `inGame`, `voting` | Word, the one list that is speaking order and vote buttons, the waiting line, "Final battle" when `final`, the points table collapsed to one line of the player's own points |

  Host-only controls (Remove a player, Close the vote now, the keep-open line), Leave rules, the tap guard, inline errors, remembered room, `?dev`, "Checking your vote…", the stall timer: all as today.
- Words: "virus", "carrier", "cured", "sent to rest". No "spy", "team", "bench", "Heroes N · Spies N" anywhere on screen. `GAME_NAME` unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/ui.test.js`: one per table row; the reveal for each of the three result kinds including the gains line; game over for both endings, level Heroes, and the no-final ending, from a stored `ranking`; no view contains "spy", "bench" or a team score; the carrier's and a Hero's `voting` views are equal apart from the word, and the host's and a player's apart from host controls; a player who left mid-round still has a Remove row; "Close the vote now" for the host in a normal vote and in the final; Leave offered and withheld as today; `screenFor re-entry` per role; `old room` for a room with `seats` only.
- [ ] **Step 2:** `npm test` fails on them.
- [ ] **Step 3:** Build with the `impeccable` skill (read its `SKILL.md`, `reference/operate.md`, and `reference/craft-floor.md` right before the first UI edit), keeping `DESIGN.md`'s look. Update `PRODUCT.md`, `DESIGN.md` and the surface brief where they describe teams, benches or a spy.
- [ ] **Step 4:** `npm test` and `npm run build` pass.
- [ ] **Step 5:** Run impeccable `critique`, `audit` and `polish` on the changed screens at 375px wide; fix what they find.
- [ ] **Step 6: Commit.**

### Task 4: Play it, then update the preview (needs Dave)

- [ ] **Step 1:** With the emulators and dev server, play a whole game from 6 people in the browser (`?dev=NAME`, at most 2 tabs): a Hero sent to rest, a carrier cured, the final, the ranking; then a second game in the same room. Then by hand: a player leaving mid-round and being removed, Close the vote now, a host reload during a result.
- [ ] **Step 2:** `superpowers:verification-before-completion`: fresh `npm test` and `npm run build`; confirm `firestore.rules` is identical to what is deployed (`git diff` against the commit deployed on 2026-11-15).
- [ ] **Step 3: Ask Dave before deploying.** Only the preview is updated: `npx firebase hosting:channel:deploy nogm --expires 7d`. No rules deploy. State what happens: rooms made on the preview before the update show "older version"; everyone reloads the preview page once.
- [ ] **Step 4:** Dave plays a game on real phones at the preview address.

### Task 5: Go live and update the instructions (needs Dave)

- [ ] **Step 1:** With Dave's OK, show the command, then `npm run build` and `npx firebase deploy --only hosting`. Games in progress on the live version are abandoned; its rooms show "older version".
- [ ] **Step 2:** Check the live address in a fresh browser session: create a room; `/` is served with `Cache-Control: no-cache`.
- [ ] **Step 3:** Rewrite the "Heroes vs Spies: How to Play" document for the story and the automatic flow, and export a new PDF.
- [ ] **Step 4:** Commit, merge and push as Dave chooses.
