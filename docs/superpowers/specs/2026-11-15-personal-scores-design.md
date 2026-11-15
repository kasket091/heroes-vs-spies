# Personal scores: design

Date: 2026-11-15
Status: draft, awaiting Dave's approval
Builds on: `2026-11-15-no-game-master-design.md` (built, at a preview address, not yet live) and the designs under it. Everything in them still holds unless this design changes it.

Lines marked **(call)** are choices Claude made, not things Dave asked for. Everything else is Dave's.

## Intent

Dave noticed that a player can score for one side and be counted with the other at the end, because the spy role moves from person to person while winning is decided by which bench you ended on. He wants each player's own contribution to count. Each player gets a personal score that follows them all game, shown as a "Top players" table. Heroes vs Spies stays as the story and still decides who wins the game.

## Goals

- A personal score for every player in a game.
- Spy play pays more than Hero play ("heavier Spy points", chosen by Dave from a simulation):

| When | Who scores | Points |
|---|---|---|
| A Hero is voted out while you are the spy | You | +2 |
| You are the spy and are not voted out in the final battle | You | +4 (this replaces the +2 for that vote, as the final's team points replace the usual point) |
| The spy is voted out and you voted for them | You | +1 |
| Anything else (voted out as a Hero, voted for the wrong person, on the bench) | Nobody | 0 |

- A "Top players" table at game over, highest first, with every player who took part.
- The team result is unchanged: the final battle still decides whether Heroes or Spies win, and the team score still shows.

## Non-goals

- Changing who wins the game. The table is a second result beside the team result; the two can disagree (a simulation of 20,000 ten-round games put a player who never scored as a spy on top in about 1% or fewer of Spy wins with these points). **(call, discussed with Dave)**
- Scores carried from one game to the next in a room. **(call)**
- Showing each vote, or who voted for whom, with one unavoidable exception: when a spy is caught, the +1s show which players voted for that spy in that vote. That follows directly from scoring correct votes. Nothing is shown about votes in rounds where the spy was not caught. (An earlier design said the game never shows who voted for whom, and never says a vote was tied; a spy caught with very few +1s can now be guessed to have been a tie draw.) **(call: accepted as part of the scoring Dave chose; flagged to him)**

## Anti-goals

- **A score must never reveal the spy.** A spy's +2 for surviving a vote cannot be shown when it is earned: everyone would see whose score went up. It stays hidden until that spy is revealed.
- A score must never reveal how anyone voted in a round where the spy was not caught.
- All earlier anti-goals hold: no screen shows or hints the spy or the other word before the game reveals it; the spy's screen equals a Hero's.

## How scores are kept and shown

- **Hero points** are added at the moment the spy is voted out, to everyone still in who voted for them in that vote. The spy is revealed in the same result, so this gives nothing away. In a tie where the spy is the one drawn, the players who voted for the spy still score. **(call)**
- **Spy points** build up in secret while a spy survives. They are added to that player's shown score at the moment that spy is revealed by the game: when they are voted out, or when the game ends. The result screen says so, for example "Cara was the spy! Heroes +1. Cara survived 2 votes: +4 points."
- **A spy who is removed by the host loses their hidden points.** They keep whatever was already showing. This avoids a new way of revealing a spy outside a result, and a removed player has not finished the game. **(call)**
- **A game that ends without a final battle** (fewer than 3 players left): a spy still in gets the hidden +2s they had built up, and no +4, because no final was survived. **(call)**
- A spy who is never told they are the spy cannot see their hidden points either. Their own score looks the same as it would for a Hero until the reveal. **(call: required by the anti-goal)**
- **During a game** the scoreboard (on the bench, and on the result screen) lists players with the points shown so far. It is labelled so nobody reads it as final: "Points so far. Spy points appear when a spy is revealed." **(call)**
- **At game over** the screen shows, in this order: who won (Heroes or Spies, as today), the team score, the last spy and words, then **Top players**: every player who was dealt into the game, highest first, with their points. Players with the same points share a place. **(call)**
- A cancelled round (a player removed mid-vote) scores nothing for anyone, as it scores nothing for the teams.
- A player who was removed or who left keeps their line in the table with the points that were showing when they went. A player who left but whose vote was still counted scores from it like anyone else. **(call)**
- A new game starts everyone at 0.

## Trade-offs carried over from the earlier designs, re-weighed

- **"Nothing public may reveal the active spy."** Personal scores are a new public number per player, updated after votes: exactly the kind of thing that can leak. Handled by holding spy points back until the reveal (above). Hero points are only ever added in a result that already names the spy.
- **"The scoreboard never marks the active spy."** Still true: before a reveal the spy's line is indistinguishable from a Hero's.
- **"The host's phone holds the secret."** It now also holds the spy's hidden points and reads the votes to award Hero points, which it could already read. No new trust is asked of it.
- **"A vote cast early cannot be changed"** and **"Close the vote now counts the votes cast."** Unchanged. A player who did not vote scores nothing in that vote.
- **"Benched players do nothing."** Unchanged: they cannot score from the bench, but keep what they earned.
- **Updating a live game.** This version has not replaced the live game yet. It will go to the same preview address first. A player's phone holding the previous preview page would simply not show scores. A HOST's phone on the previous preview page would run a game without scores and would not reset them, so everyone testing must reload the preview page once after it is updated; the page is now served so that a reload always fetches the newest version. **(call: no version check is built for a preview)** No access rule changes: only the host's phone writes scores, into records it already writes.

## Approaches considered

- **A. Personal scores beside the team result (chosen).** Dave picked this, with heavier Spy points, after seeing that a simple version put a Hero on top in about 1 in 10 Spy wins.
- **B. The final crowns the individual too.** The surviving spy's bonus sized to always be first. It makes the earlier points nearly meaningless, the same clash the team score had.
- **C. Rank the winning team first.** Brings back the original complaint: you are ranked by where you ended up.

## How it is built (Claude's calls)

- New pure rules with unit tests: points for a vote that catches the spy, points released when a spy is revealed, the Top players ranking with shared places.
- The room record gains each player's shown points. The spy's hidden points live beside the host-only secret. Both are written by the host's phone in the same step that writes a result, so a result and its points cannot disagree.
- The host's phone already reads the votes when it closes a round; it uses them to find who voted for the spy. Nobody else can read votes, as today.
- Screens: Top players at game over; points on the scoreboard during a game with the "so far" label; one line on the result when points are released. Designed with the impeccable skill in the existing look.
- After go-live the How to Play document and PDF describe the scores (they are being rewritten for the no-game-master flow anyway).

## Testing

- Unit tests for the three pure rules, including the table above line by line, a tie where the spy is drawn, a cancelled round, and shared places.
- Emulator tests: a whole game where the public room record is read after every step and a script tries to tell the spy from the points alone (it must not be able to before the reveal); spy points appear exactly at the reveal; Hero points go only to those who voted for the caught spy; a removed spy's points are released; a new game starts at 0; the final's +4.
- The earlier secrecy tests still pass unchanged: the spy's and a Hero's screens are equal before a reveal, the host's and a player's too.
- A browser game, then Dave on phones at the preview address before anything goes live.

## Left to the builder

- Wording of the points lines and the "so far" label.
- Field names for shown and hidden points.
- How shared places are numbered (1, 1, 3 or 1, 1, 2).
