# Heroes vs Spies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live one-vote spy game into an elimination game: players are voted out until 3 remain, Heroes and Spies score along the way, benched players watch a scoreboard, and a final battle worth the score gap plus 1 settles the winner.

**Architecture:** Same site, same Firebase project. New pure rules go in `src/game.js`. The room record gains the game state (active players, benches, score, word set), still written only by the game master's phone. The security rules file should not need to change: a benched player is simply no longer in `roundPlayers`.

**Tech Stack:** unchanged (Vite, vanilla JS, Firebase JS SDK v12, Vitest, Firebase emulators with the project-local Java).

**Spec:** `docs/superpowers/specs/2026-11-15-heroes-vs-spies-design.md`, which builds on `docs/superpowers/specs/2026-11-15-spy-game-design.md`. Read both before any task.

## Global Constraints

- At least 4 players to start a game. The game runs until 3 active players remain, then plays a final battle.
- Voted-out player was the spy: Heroes +1, Spy bench, next round starts a new word set (new words, new spy among active players).
- Voted-out player was not the spy: Spies +1, Hero bench, same word set continues (same spy, same words).
- Final battle at 3 active players: its points replace the usual 1 point; the winner gets (gap + 1). Nobody is benched after it.
- Tie for most votes: one tied player is drawn at random and the round is scored as if they were voted out; the spy is in the draw. No votes cast: every active player is tied. The result never says there was a tie.
- First speaker: 5 or more active players, only safe starters (`(p - s) mod n >= 2`); 4 or 3 active players, anyone. One shared function decides.
- While a spy is still active nothing public may reveal them: a "not the spy" result carries no spy id, no spy name and no words. The Spy bench lists only caught spies.
- Player screens stay identical for the spy and everyone else apart from the word.
- Benched players do nothing; their phone shows only the scoreboard. They are not dealt a word.
- Removing an active player during clues or voting voids the round: no point, nobody benched. Between rounds it voids nothing. A removed active player is on no team.
- Count check when the next round starts: exactly 3 active is the final; fewer than 3 ends the game on the current score, level score is a draw.
- Late joiners wait for the next game. Game master hand-over only between games. Scores reset each game.
- Dave's planning checks (previews, money guards, scheduled jobs): none apply.
- UI work uses the `impeccable` skill and keeps the current writing-pad look (`DESIGN.md`). Finish with `superpowers:verification-before-completion`.

## Review Focus

1. **Every way back in, for every role.** Paths: reload with `?room=`, the bare link (remembered room), typing the code again. Roles: game master, active player, benched player, late joiner, a removed active player who rejoins. Expected: game master and active player return to their screen and word; a benched player returns to the scoreboard and never gets a word; a late joiner or a rejoining removed player waits for the next game and is not in `active`. (Task 2 tests `re-entry: ...`, Task 3 tests `screenFor re-entry: ...`)
2. **A room made by the live version** (no `active`, no `score`). After the deploy it must not crash or hang: it shows the join form with "This room is from an older version. Create a new one." (Task 3 test `old room`)
3. **The shortest and the shrinking game.** A 4-player game (one round, then the final), and a game where removals drop it below 3: it must reach game over, never a stuck screen. (Task 2 tests `4-player game`, `removal below 3`)
4. **No votes, or voting closed early.** A player is still drawn and the game moves on. (Task 1 `whoIsOut: no votes`, Task 2 `close with no votes`)
5. **Double taps on Next round or Close voting.** The second tap does nothing: one round advances, one result is written. (Task 2 tests `nextRound twice`, `closeVoting twice`)

## Stored state (decided here so tasks agree)

`rooms/{code}` keeps `gmUid, gmName, round, roundPlayers, starterUid, result` and changes or gains:

- `phase`: `'lobby' | 'clues' | 'voting' | 'result' | 'gameOver'` (replaces `reveal` and `cancelled`)
- `active`: uids still in the game, in seat (join) order. `roundPlayers` is this round's speaking order, a rotation of `active`.
- `names`: `{ uid: name }` for everyone in the game, frozen when the game starts
- `heroBench`, `spyBench`: uid arrays
- `score`: `{ heroes, spies }`
- `wordSet`: integer, +1 on every deal. `round` is +1 on every round. `private/{uid}` and `gm/secret` carry `wordSet` instead of `round`.
- `needsWords`: true when the next round needs a new deal
- `final`: true while the current round is the final battle
- `result` (null during a round's clues): `{ outUid, outName, wasSpy, team, points, voided, spyUid, spyName, common, spy }`. The last four are null unless `wasSpy` is true or the phase is `gameOver`.
- `winner` (only at `gameOver`): `'heroes' | 'spies' | 'draw'`

---

### Task 1: Game rules

**Files:**
- Modify: `src/game.js`, `tests/game.test.js`

**Interfaces:**
- Produces (pure; `rand` defaults to `Math.random`):
  - `starterChoices(activeIds: string[], spyId: string): string[]`
  - `whoIsOut(votes: Record<string, string>, activeIds: string[], rand?): string` (tied players keep `activeIds` order before the draw)
  - `finalPoints(score: { heroes: number, spies: number }): number`
  - `scoreRound({ outUid, spyUid, score, final }): { wasSpy: boolean, team: 'heroes' | 'spies', points: number, score: { heroes, spies } }`
  - `stage(activeCount: number): 'round' | 'final' | 'over'`
  - `gameWinner(score): 'heroes' | 'spies' | 'draw'`
  - `teams({ active, heroBench, spyBench, spyUid }): { heroes: string[], spies: string[] }` (`spyUid` may be null)
- Keeps `tally` for now: `src/room.js` still imports it. Task 2 removes `tally` and its tests.

- [ ] **Step 1: Write the failing tests**

```js
test('starterChoices: the 2-before rule applies from 5 players', () => {
  expect(starterChoices(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['a', 'd', 'e']);
  expect(starterChoices(['a', 'b', 'c', 'd'], 'a')).toEqual(['a', 'b', 'c', 'd']);
  expect(starterChoices(['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c']);
});
test('whoIsOut: clear winner', () => {
  expect(whoIsOut({ a: 'c', b: 'c', d: 'a' }, ['a', 'b', 'c', 'd'], () => 0)).toBe('c');
});
test('whoIsOut: a tie draws among the tied only', () => {
  const votes = { a: 'c', b: 'd' };
  expect(whoIsOut(votes, ['a', 'b', 'c', 'd'], () => 0)).toBe('c');
  expect(whoIsOut(votes, ['a', 'b', 'c', 'd'], () => 0.99)).toBe('d');
});
test('whoIsOut: no votes draws among everyone', () => {
  expect(whoIsOut({}, ['a', 'b', 'c'], () => 0)).toBe('a');
  expect(whoIsOut({}, ['a', 'b', 'c'], () => 0.99)).toBe('c');
});
test('finalPoints is the gap plus 1', () => {
  expect(finalPoints({ heroes: 1, spies: 4 })).toBe(4);
  expect(finalPoints({ heroes: 2, spies: 2 })).toBe(1);
});
test('scoreRound: spy caught, hero out, and both finals from the spec', () => {
  expect(scoreRound({ outUid: 'c', spyUid: 'c', score: { heroes: 0, spies: 0 }, final: false }))
    .toEqual({ wasSpy: true, team: 'heroes', points: 1, score: { heroes: 1, spies: 0 } });
  expect(scoreRound({ outUid: 'b', spyUid: 'c', score: { heroes: 1, spies: 0 }, final: false }))
    .toEqual({ wasSpy: false, team: 'spies', points: 1, score: { heroes: 1, spies: 1 } });
  expect(scoreRound({ outUid: 'c', spyUid: 'c', score: { heroes: 1, spies: 4 }, final: true }).score)
    .toEqual({ heroes: 5, spies: 4 });
  expect(scoreRound({ outUid: 'a', spyUid: 'c', score: { heroes: 1, spies: 4 }, final: true }).score)
    .toEqual({ heroes: 1, spies: 8 });
});
test('stage', () => {
  expect([5, 4, 3, 2].map(stage)).toEqual(['round', 'round', 'final', 'over']);
});
test('gameWinner', () => {
  expect(gameWinner({ heroes: 5, spies: 4 })).toBe('heroes');
  expect(gameWinner({ heroes: 1, spies: 8 })).toBe('spies');
  expect(gameWinner({ heroes: 2, spies: 2 })).toBe('draw');
});
test('teams', () => {
  expect(teams({ active: ['a', 'c'], heroBench: ['b'], spyBench: ['d'], spyUid: 'c' }))
    .toEqual({ heroes: ['a', 'b'], spies: ['c', 'd'] });
  expect(teams({ active: ['a', 'c'], heroBench: [], spyBench: ['d'], spyUid: null }))
    .toEqual({ heroes: ['a', 'c'], spies: ['d'] });
});
```

- [ ] **Step 2:** `npm run test:unit` fails on the missing exports.
- [ ] **Step 3:** Implement them in `src/game.js`. `starterChoices` calls the existing `safeStarters`.
- [ ] **Step 4:** `npm run test:unit` and `npm test` pass.
- [ ] **Step 5: Commit.**

### Task 2: Room logic for a whole game

**Files:**
- Modify: `src/room.js`, `tests/room.test.js`, `tests/rules.test.js`
- Modify only if a test below cannot pass otherwise, and never to loosen: `firestore.rules`

**Interfaces:**
- Consumes: Task 1's functions; the stored state above.
- Produces (each takes `db` first; game master only unless noted):
  - `createRoom` writes the new fields with a lobby's empty values.
  - `dealWords(db, code, common, spy)`: in `lobby` or `gameOver` it starts a new game (needs `MIN_PLAYERS`; `active` = current players, `names`, empty benches, 0–0, `round` 1); in `result` with `needsWords` it starts a new word set for the current `active`. Either way: `wordSet + 1`, a `private` doc per active player, `gm/secret`, `starterUid: null`, `result: null`, `final` from `stage`, `phase: 'clues'`. Throws `Error('Not enough players')`, `Error('Invalid word pair')`, `Error('Round already running')`. If `stage(active.length)` is `'over'` it ends the game instead (see `endGame` below) and deals nothing.
  - `nextRound(db, code)`: only in `result` without `needsWords`; otherwise it returns without writing. `round + 1`, `starterUid: null`, `result: null`, `final` from `stage`, `phase: 'clues'`; ends the game instead when `stage` is `'over'`.
  - `pickStarter(db, code, starterUid)`: throws `Error('Not a safe starter')` unless in `starterChoices(roundPlayers, spyUid)`.
  - `openVoting`, `castVote`: as today.
  - `closeVoting(db, code)`: one transaction; does nothing unless `phase === 'voting'`. Reads the votes by id for `roundPlayers`, `whoIsOut`, `scoreRound`. Normal round: removes the player from `active`, adds them to the right bench, writes `score`, `result`, `needsWords: wasSpy`, `phase: 'result'`. Final: benches nobody, writes `score`, `winner`, a full `result`, `phase: 'gameOver'`.
  - `removePlayer(db, code, uid)`: not in `active`, or phase `lobby`/`gameOver`: deletes the player doc only. Active during `clues`/`voting`: also removes them from `active`, writes a `voided: true` result (with spy and words only if they were the spy), `needsWords` = they were the spy, `phase: 'result'`. Active during `result`: removes them from `active`; if they were the spy sets `needsWords: true`.
  - Internal `endGame`: `phase: 'gameOver'`, `winner: gameWinner(score)`, a full `result` (spy and words of the current word set, or nulls if the spy was removed).
  - `handOverGm`: only in `lobby` or `gameOver`.
  - `leaveRoom(db, code, uid)` (any player): as today; the screens decide when to offer it.
  - `subscribe`: `myWord` only when `uid` is in `room.active` and `private.wordSet === room.wordSet`; `secret` only when `secret.wordSet === room.wordSet`; `votesCast` for the current `round`.

- [ ] **Step 1: Write the failing tests** against the emulators (users `gm`, `p1`..`p6`). Give the code a way to make draws predictable in tests (an optional `rand` argument on `dealWords` and `closeVoting`).

```
dealWords with 3 players                 rejects 'Not enough players'
dealWords with 6                         phase 'clues', active has 6, score 0-0, exactly one word differs
vote out a hero                          phase 'result'; result.wasSpy false; score 0-1; uid in heroBench, not in active;
                                         room has needsWords false; result.spyUid, spyName, common, spy are all null
nextRound after a hero is out            same wordSet; every active player still has the same word; round is +1
vote out the spy                         result.wasSpy true with both words and the spy's name; score +1 heroes;
                                         uid in spyBench; needsWords true
nextRound while needsWords               writes nothing (phase stays 'result')
dealWords after the spy is caught        wordSet +1; a benched player's subscribe gives myWord null;
                                         the new spy is an active player
tie                                      with rand fixed, the drawn tied player is out and the result has no tie field
close with no votes                      someone from active is out; phase 'result'
closeVoting twice                        one result; score moved once
nextRound twice                          round moved once
benched player votes                     rejected by the rules; an active player's vote in the same round succeeds
full game from 6                         three rounds bring it to 3 active; that round has final true;
                                         closing it gives phase 'gameOver', the winner's score ahead, nobody newly benched
final at 1-4 won by heroes               score 5-4, winner 'heroes'
4-player game                            round with 4 (any starter accepted, including the spy), then final true at 3
pickStarter with 5 active                the spy as starter rejects 'Not a safe starter'
remove an active hero during clues       result.voided true, no score change, no bench change, needsWords false
remove the active spy during voting      result.voided true with words and spy name, needsWords true
remove an active player in 'result'      active shrinks; score and result unchanged
removal below 3                          the next nextRound/dealWords call gives phase 'gameOver'; level score gives 'draw'
late joiner mid-game                     in players, not in active, myWord null; dealt in by the next new game
re-entry: active player                  a fresh subscribe mid-round gives the same word and seat
re-entry: benched player                 a fresh subscribe gives myWord null; joinRoom again keeps them benched
re-entry: removed player rejoins         joinRoom succeeds; not in active until the next game
new game after game over                 score 0-0, benches empty, everyone in players is active
handOverGm during 'result'               rejects; during 'gameOver' succeeds
```

In `tests/rules.test.js` add the pair: a uid not in `roundPlayers` cannot create a vote; a uid in `roundPlayers` can.

- [ ] **Step 2:** `npm test` fails on the new cases.
- [ ] **Step 3:** Implement in `src/room.js`. Replace `dealRound` and the `reveal`/`cancelled` phases; delete `tally` and its tests from `src/game.js` and `tests/game.test.js`. `src/ui.js` and `src/main.js` still call the old names until Task 3, so `npm run build` may fail between Task 2 and Task 3; `npm test` must pass, with the old ui tests that depend on removed phases deleted here and replaced in Task 3.
- [ ] **Step 4:** `npm test` passes (the old one-vote tests are rewritten or removed, not left failing or skipped).
- [ ] **Step 5: Commit.**

### Task 3: Screens

**Files:**
- Modify: `src/ui.js`, `src/main.js`, `src/style.css`, `tests/ui.test.js`, `DESIGN.md` if a new pattern is added

**Interfaces:**
- Consumes: Task 2's state and actions; `starterChoices`, `finalPoints`, `teams`, `stage` from `src/game.js`.
- Produces: `screenFor` and `view` covering:

| Condition | Screen |
|---|---|
| no room, or room without `active` (made by the old version) | Join / Create; for an old room, "This room is from an older version. Create a new one." |
| game master, `lobby` or `gameOver` | Lobby: code, players, "New game" (disabled under 4 with the reason), hand over, leave. At `gameOver` the final result sits above it |
| game master, words needed (new game, or `result` with `needsWords`) | Words: pair, Skip, "Use these words", own words, as today |
| game master, `clues` without a starter | Pick starter: `starterChoices` decides what is tappable; with 4 or 3 players no "too close to the spy" text |
| game master, `clues` / `voting` | Round: both words, spy, order, voting controls, scoreboard, active and benched lists, "Keep this screen open"; a "Final battle, worth N" line when `final` |
| game master, `result` | Round result, scoreboard, "Next round" (opens Words when `needsWords`), Remove |
| active player, `clues` / `voting` | Word, order, vote, "Vote sent", "Checking your vote…" as today, plus one score line and, when `final`, "Final battle, worth N". Identical for the spy apart from the word |
| benched player, any phase before `gameOver` | Scoreboard only: score, both benches by name, players still in, and "You're on the Hero bench" / "You're on the Spy bench" |
| in `players` but not in the game, game running | "A game is in progress. You're in the next one." |
| anyone, `result` | "Cara was the spy! Heroes +1." with both words, or "Ben was not the spy. Spies +1." with no words, or "Ben left. This round doesn't count." Then the scoreboard |
| anyone, `gameOver` | Final score, the winning team (or "It's a draw"), both teams by name, the last spy and the last words when there are any |

"Leave room" is offered to benched players and between games, never to an active player mid-game.

- [ ] **Step 1: Write the failing tests** in `tests/ui.test.js`: one per table row; `screenFor re-entry` for game master, active, benched and late joiner; `old room`; a "not the spy" result view contains neither word and no spy name; the active spy's view equals a hero's view apart from the word, including when `final`; the benched view contains no word; "Next round" opens Words only when `needsWords`.
- [ ] **Step 2:** `npm test` fails on them.
- [ ] **Step 3:** Build the screens with the `impeccable` skill (read its `SKILL.md`, `reference/operate.md`, and `reference/craft-floor.md` right before the first UI edit), following `DESIGN.md` and `PRODUCT.md`: families with kids, plain words, tap targets at least 44px, nothing by colour alone. In `main.js`, auto-close voting when every round player has voted, as today.
- [ ] **Step 4:** `npm test` and `npm run build` pass.
- [ ] **Step 5:** Run impeccable `critique`, `audit` and `polish` on the new and changed screens at 375px wide; fix what they find.
- [ ] **Step 6: Commit.**

### Task 4: Play it before it replaces the live game

- [ ] **Step 1:** With the emulators and dev server, play a full game from 5 players in the browser (`?dev=NAME`, at most 2 tabs open at once): a hero voted out, the spy caught, a tie, a benched player's screen, the final, game over, a new game. Then the Review Focus lines by hand.
- [ ] **Step 2:** Use `superpowers:verification-before-completion`: fresh `npm test` and `npm run build`.
- [ ] **Step 3: Ask Dave before any deploy.** Offer a preview first: `npx firebase hosting:channel:deploy heroes --expires 7d` puts this version at a temporary address while the live site stays as it is. It uses the live database, which is safe because the access rules do not change (if Task 2 had to change `firestore.rules`, say so and deploy the rules first with his OK).
- [ ] **Step 4:** Dave plays a game on real phones at the preview address.

### Task 5: Go live (needs Dave)

- [ ] **Step 1:** With Dave's OK, show him the command, then `npm run build` and `npx firebase deploy --only hosting`. Games in progress on the old version are abandoned.
- [ ] **Step 2:** Check the live address in one browser: create a room, and an old-version room code shows the "older version" message.
- [ ] **Step 3:** Commit, merge and push as Dave chooses.
