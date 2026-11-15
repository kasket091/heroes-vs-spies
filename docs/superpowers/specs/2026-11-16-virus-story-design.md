# The jumping virus: design

Date: 2026-11-16
Status: approved by Dave 2026-11-16
Builds on: `2026-11-15-no-game-master-design.md` (built, at a preview address, not live) and the designs under it. Everything in them still holds unless this design changes it.
Replaces: `2026-11-15-personal-scores-design.md` (a draft that was never approved or built).

Lines marked **(call)** are choices Claude made, not things Dave asked for. Everything else is Dave's.

## Intent

Dave wants the game to have a story that explains itself, and an ending where the last three players always take the top three places.

**The story.** Every player is a Hero. A virus is hiding in one of them, and that player does not know. The Heroes' mission is to find it. The virus is clever: after every round it jumps to a different Hero. When only three players are left, the two healthy Heroes get one shot at picking the carrier out of the three.

## What changes for people

| The no-game-master version at the preview | New |
|---|---|
| The same spy and the same words carry on until the spy is caught | A new carrier and new words every round |
| Heroes vs Spies team score, a Hero bench and a Spy bench | No teams, no team score, no benches. Each player has their own points |
| The result hides the spy and the words when a Hero is voted out | Every result reveals who the carrier was and both words |
| The final is worth the score gap plus 1 and decides which team wins | The final decides the order of the top three |
| "Spy" | "The virus" and its "carrier" on screen **(call on the words; the game's name stays "Heroes vs Spies" unless Dave renames it)** |

## Goals

- A new carrier every round, picked at random from the players still in. The virus never jumps straight back to the player it just left. (Dave; **call** on "straight back" being the only exclusion.) "The player it just left" is the carrier named in the most recent result of this game, if that player is still in. The first round of a new game excludes nobody. **(call)**
- New words every round, from the word families, never repeating a pair in a room.
- One player is voted out every round, until three are left. Then the final battle.
- After every round the game reveals: who was voted out and whether they were the carrier, who the carrier was, both words, and the points just earned.
- Points:

| When | Who scores | Points |
|---|---|---|
| The group votes out a healthy Hero | That round's carrier | +2 |
| The group votes out the carrier | Every player still in who voted for the carrier | +1 each |
| The carrier is not voted out in the final battle | The carrier | +4 (in place of the +2) |

- The ranking at the end:

| The final ends with | 1st | 2nd | 3rd | Below |
|---|---|---|---|---|
| The virus survives | The carrier | The Hero with more points | The other Hero | Everyone voted out, by points |
| The Heroes catch it | The Hero with more points | The other Hero | The carrier | Everyone voted out, by points |

- Kid-friendly wording throughout: the carrier is "cured", never killed; a Hero voted out by mistake is "sent to rest". **(call; Dave's audience is families with kids)**

## Non-goals

- Teams, a team score, benches, and the "gap plus 1" final. Removed.
- A running total across games in a room. Discussed and simulated, not decided; left out of this change. **(call)**
- Changing how words, clues, voting, the automatic rounds, removing, leaving or the host work. All as in the no-game-master design.

## Anti-goals

- Nothing may show or hint who the CURRENT carrier is, or the other word, before that round's result. The carrier's screen equals a Hero's.
- The points table must never move in a way that points at the current carrier. (It cannot: points are only added in a result, and the result names that round's carrier, who by then is no longer the carrier.)

## Things this design knowingly accepts

- **Points decide little.** The last three always take the top three places, so points only order the two Heroes on the podium and the players below it. In a simulation of the points alone, the three highest scorers were exactly the last three in 8% to 64% of games; in the rest, someone voted out had more points than someone on the podium. Dave chose the clear ending. (Told to Dave.)
- **One fewer suspect each round.** The result names the last carrier, and the virus never jumps straight back, so that player is known to be healthy in the next round. (Told to Dave.) At the final this can leave only two suspects among the three: if the last carrier is one of the final three, everyone knows the virus is in one of the other two.
- **The +1s show who voted for a caught carrier.** Nothing is shown about votes in rounds where the carrier survived.
- **The first two speakers are known to be healthy** in a round with 6 or more players. This now applies in every round, because every round has new words. It does not add up from round to round, since the carrier changes. Together with the named last carrier, a round can have three players known to be healthy. That is why the rule now starts at 6 players, not 5: at 5 it would leave only 2 suspects, fewer than a 4-player round has. **(call: changes Dave's original threshold; flagged to him)**

## Trade-offs carried over from the earlier designs, re-weighed

- **"A spy's points must stay hidden until the spy is revealed"** (from the personal-scores draft). No longer needed: the carrier is revealed in the same result that awards their points.
- **"A result hides the spy and words when a Hero is voted out, because the word set continues."** No longer needed: the word set never continues.
- **"The safe-starter rule applies only in the first round of a word set"** (added after it was found to reveal the spy across rounds). Every round is now a first round. The problem it fixed came from the same spy across rounds, which can no longer happen.
- **"Word families are used evenly, so a returning family cannot be narrowed from memory."** Still needed and more important: a 12-player game now uses 10 pairs instead of roughly 4.
- **"The host's phone holds the secret."** Unchanged. It now also picks a new carrier every round and awards points; it could already read everything needed.
- **"Removing a player during a round cancels that round."** Unchanged, and simpler: the next round always has a new carrier and new words anyway. A cancelled round scores nothing, and its result still reveals the carrier and the words, because nothing depends on hiding them any more. **(call)**
- **"Every automatic step is safe to run twice."** Must still hold with points: a result and its points are written in one step.
- **Rooms from an earlier version.** Rooms made on the current preview follow the old rules, and a phone still on the old preview page would run a new room wrongly. New rooms therefore store their list of players still in under a new name again, so each version refuses the other's rooms in both directions. Preview games in progress are abandoned. **(call)**

## How a game goes

1. **Lobby.** As now: the host is a player; New game needs at least 4 people.
2. **Round.** The game picks an unused word pair, a carrier (not the last one), and a first speaker (with 6 or more players, two speak before the carrier; with 5 or fewer, anyone may speak first). Each phone shows its word and the list that is both speaking order and vote buttons.
3. **Vote.** As now, including ties (one tied player is drawn at random) and "Close the vote now".
4. **Result.** One of:
   - "Ana had the virus! She is cured." and +1 for everyone who voted for Ana.
   - "Ben was healthy! The virus was hiding in Ana." and +2 for Ana.
   - then, in both cases while more than three were playing: "The virus has jumped again." Both words are shown, and the points table.
5. **Next round** starts by itself after about 10 seconds, as now.
6. **Final battle** with three players, announced on every phone. One vote.
   - The carrier is voted out: the Heroes win. Each Hero who voted for the carrier gets +1.
   - Otherwise: the virus wins. The carrier gets +4.
7. **Game over.** The ranking, as in the table above, with everyone's points. **(calls)**
   - The ranking has three groups, always in this order: the final three (placed by the table above), then everyone voted out (by points), then anyone the host removed before they were voted out (by points, marked "did not finish").
   - Level points share a place only inside a group: the two Heroes can share a place; players voted out can share a place. A carrier never shares with a Hero, and nobody outside the final three can rise into it.
   - The ranking is fixed when the game ends and stored with the result. It does not change if someone leaves the room afterwards.
   - A player who taps Leave is still in the game until the host removes them: a voted-out player who leaves keeps their place among those voted out, and a final-three player who leaves keeps their podium place.

Other cases:

- **The game ends early** because removals leave fewer than three players: there was no final, so the players still in and those voted out are ranked together by points alone, with removed players below them as above. **(call)**
- **"Close the vote now" in the final** stays available. With no votes, or one vote each, the usual random draw among the tied players decides the final. **(call: an escape hatch, not normal play)**
- A voted-out player's phone shows the points table and a plain list of who is out, in place of the bench screen.

## Approaches considered

- **A. Rework the no-game-master version in place (chosen).** It has not gone live, so nothing needs to stay compatible except the preview, and the change mostly removes things: teams, benches, hidden results, the continuing word set.
- **B. Go live with the no-game-master version first, then change it.** Two updates for players instead of one, and the first would ship rules Dave has already moved on from.
- **C. Keep teams and add the story as wording only.** Leaves the fairness problem Dave raised and two results that can disagree.

## How it is built (Claude's calls)

- Same stack and Firebase project, on top of the no-game-master branch.
- Pure rules, each with unit tests: picking the next carrier, points for a round, the final ranking (both endings, shared places, the early-ending case).
- Room logic: every advance deals new words and a new carrier; every result carries the carrier, both words and the points; the team score, benches and "same words continue" paths are removed. Points live on the room record, written with each result.
- No access rule changes: only the host's phone writes results and points, into the room record it already writes.
- Screens: the story's wording, the result with the reveal and points, the points table for players who are out, the final ranking at game over. Designed with the impeccable skill in the existing look.
- The same preview address is updated. Everyone testing reloads the page once.
- After go-live: the How to Play document and its PDF are rewritten for the story.

## Testing

- Unit tests for the three pure rules, including both ranking tables line by line, level points, and the early ending.
- Emulator tests: a whole game where every round has a different carrier and a new pair; the carrier never repeats back to back; points appear only in results; the public record never identifies the current carrier during a round; a tie; a cancelled round; the final both ways; the early ending; double steps (two host tabs, a reload) never score twice.
- The existing secrecy tests still pass: the carrier's and a Hero's screens are equal during a round, the host's and a player's too.
- A browser game, then Dave on phones at the preview address before anything goes live.

## Left to the builder

- Exact wording of the story lines and results.
- Field names.
- How shared places are numbered.
