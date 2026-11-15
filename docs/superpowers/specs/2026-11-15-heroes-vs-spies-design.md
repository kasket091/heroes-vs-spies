# Heroes vs Spies: elimination game with a scoreboard

Date: 2026-11-15
Status: approved by Dave 2026-11-15
Builds on: `2026-11-15-spy-game-design.md` (the live game). Everything in that design still holds unless this one changes it.

Lines marked **(call)** are choices Claude made, not things Dave asked for. Everything else is Dave's.

## Intent

Today one vote ends the round. Dave wants a full game: players are voted out one at a time until only 3 are left, two teams (Heroes and Spies) score along the way, and a final battle between the last 3 settles who wins. Voted-out players are not idle losers: they sit on their team's bench and win or lose with it.

## Words used here

- **Game:** from the first deal until the final battle is decided.
- **Round:** one set of clues followed by one vote.
- **Word set:** one pair of words and one spy. A word set lasts until its spy is caught, which can take several rounds.
- **Active players:** players still in the game. **Benched players:** players voted out.

## Goals

- At least 4 players to start a game. The game runs until 3 active players remain, then plays a final battle.
- Each vote benches one player and scores one point.
  - The voted-out player was the spy: Heroes +1, that player goes to the **Spy bench**, and the next round starts a new word set with new words and a new spy among the active players.
  - The voted-out player was not the spy: Spies +1, that player goes to the **Hero bench**, and the same word set continues: same spy, same words, new clues, another vote.
- A scoreboard, Heroes vs Spies, with both benches listed by name.
- **Final battle** when 3 active players remain: one more round. If the spy is voted out, the Heroes win the final; otherwise the Spies win it. The final is worth the score gap plus 1, so whoever wins the final wins the game.
  - Example: Heroes 1, Spies 4. The final is worth 4. Heroes win it: 5–4. Spies win it: 8–1.
- Who wins the game:
  - Heroes win: every active player who is not the spy, and everyone on the Hero bench.
  - Spies win: the final spy and everyone on the Spy bench.
- Benched players do nothing. Their phone shows only the scoreboard.
- The game master picks the first speaker every round. In the first round after new words are dealt, with 5 or more active players, at least 2 speak before the spy. In later rounds with the same words, and with 4 or 3 active players, the game master picks anyone. (Changed 2026-11-15 after the final review, Dave's decision: applied every round, the rule cleared two more players each time and could leave one suspect.)

## Non-goals

- Keeping the old one-vote round as an option. This replaces it. **(call)**
- Scores carried from one game to the next. **(call)**
- Benched players voting, chatting or seeing anyone's word.
- More than one spy at a time.

## Anti-goals

- All anti-goals of the first design still hold.
- While a spy is still active, nothing public may reveal them. When a non-spy is voted out, the result says only who is out and that they were not the spy. The words and the spy stay secret, because that word set continues.
- The scoreboard must not reveal the current spy either: the Spy bench lists only spies already caught.

## How a game goes

1. **Lobby.** As today. "New game" needs at least 4 players. Everyone in the lobby is an active player; scores start at 0–0 and both benches are empty.
2. **Words.** The game master sees a word pair and approves or skips it, as today. This happens at the start of the game and again each time a spy is caught.
3. **Deal.** The app picks a spy at random from the active players and sends each active player their word.
4. **First speaker.** The game master taps who goes first.
   - First round of a word set with 5 or more active players: only safe starters are tappable (spy speaks third or later).
   - Later rounds of the same word set: any player is tappable. (Dave, 2026-11-15)
   - 4 active players: any player is tappable. **(call: the 2-before rule would leave only 2 suspects)**
   - 3 active players: any player is tappable. (Dave)
5. **Clues.** Out loud, in the order shown.
6. **Vote.** Only active players vote, each for one other active player. The game master sees the count and can close early; voting closes by itself when all active players have voted.
7. **Tie.** If two or more players share the most votes, the app picks one of the tied players at random, and the round is scored exactly as if that player had been voted out: if it is the spy, the spy is caught. If nobody voted, every active player counts as tied. If the game master closes voting early, only the votes cast count. The result does not say that there was a tie. **(call: no revote, and the spy is in the draw. An earlier idea, "bench a tied non-spy and give the Spies the point", would tell everyone the spy is one of the tied players who stayed.)**
8. **Result of the round.** Every phone shows who is out and what it meant:
   - "Cara was the spy! Heroes +1." Shows both words. Cara goes to the Spy bench.
   - "Ben was not the spy. Spies +1." Shows no words. Ben goes to the Hero bench.
9. **Next round.** The game master taps "Next round".
   - Spy was caught and more than 3 remain: back to step 2 with a new word set.
   - Spy was caught and exactly 3 remain: step 2 with a new word set; this is the final battle.
   - Spy not caught: back to step 4 with the same word set. With exactly 3 active players, this is the final battle.
10. **Final battle.** One round with the 3 active players. Every phone is told it is the final and what it is worth. One vote (with the tie rule above). The final's points replace the usual 1 point: the winner of the final gets (gap + 1) and nothing else is added. Nobody is benched after the final; the result and the game-over screen are one screen. **(call)**
11. **Game over.** Every phone shows the final score, the winning team, both benches, the last spy and the last words. The game master can start a new game with everyone who is in the room; late joiners are dealt in then.

A 4-player game is the shortest: one round with 4, then the final battle with 3.

## What each phone shows

| Who | Shows |
|---|---|
| Active player, during a round | Their word, the speaking order, the vote when it opens, and a small score line (Heroes N, Spies N). Identical for the spy and everyone else, as today. |
| Benched player | Only the scoreboard: the score, both benches, how many players are still in, and which bench they are on. |
| Game master | Everything they see today, plus the scoreboard, who is active and who is benched. |
| Everyone, between rounds | The round result, then the scoreboard. |

## Rules the app enforces

- Minimum 4 players to start a game.
- The safe-starter rule comes from one shared function, given the number of active players and whether this is the first round of a word set: first round with 5 or more applies the rule; anything else allows anyone.
- Final points = (the difference between the two scores) + 1.
- **Removing or losing a player mid-game** **(call)**:
  - A benched player can be removed or leave freely; they stay listed on their bench by name.
  - Removing an active player during a round (clues or voting) voids that round: no point is scored and nobody is benched. If the removed player was the spy, the words are shown and the next round starts a new word set. If not, the same word set continues.
  - Removing an active player between rounds (on a result screen) voids nothing; if they were the spy, the next round starts a new word set.
  - A removed active player is on no team and no bench, and is not listed in the result.
  - The count is checked when the next round starts: exactly 3 active players means the final battle; fewer than 3 means the game ends at once and the current score decides it, with a level score a draw. The winners are then the benches as usual plus the remaining active players: with the Spies if they are the current spy, with the Heroes otherwise.
- **Joining mid-game:** late joiners wait in the lobby until the next game. **(call)**
- **Handing over the game master role:** only between games. **(call)**
- **Leave room:** offered to benched players and between games, never to an active player mid-game.
- The game master's phone still runs the game and must stay open. If it is lost for good, the game is lost and the group starts a new room, as in the live game. **(call)**
- Benched players are not dealt a word in later word sets. They see the final words only at game over.

## Approaches considered

- **A. Extend the live game in place (chosen).** Same site, same Firebase project, same rules-based secrecy; the room record gains the game state (active players, benches, score). Chosen by Claude: it reuses everything that is tested and live.
- **B. Add it as a second mode beside the one-vote round.** Two sets of rules and screens to keep working. Dave asked for this to be how the game plays, so one mode is enough.
- **C. A separate new app.** Duplicates the lobby, joining, words and voting for no gain.

## How it is built (Claude's calls)

- Same stack and project as the live game. The live site is replaced by the new version on deploy; rooms that exist at that moment are abandoned (there is no saved progress to lose).
- New pure rules in the shared rules module, each with unit tests: who is out (including the random tie draw), points for a round, final points, safe starters by player count, who wins, what happens when an active player is removed.
- The game master's phone still writes results. The access rules still keep words, the spy and votes from players, and are extended so that a benched player cannot vote.
- The round result written for everyone must carry the spy's identity and the words only when the spy was the one voted out, or when the game is over.
- Screens designed with the impeccable skill, keeping the current writing-pad look.

## Testing

- Unit tests for every new rule above, including: the example scores in this document, a 4-player game, a tie with the spy drawn and with a non-spy drawn, a vote with no votes cast, and the final-points formula at a level score.
- Emulator tests: a benched player cannot vote and has no word for the new word set; the result of a "not the spy" round contains no spy and no words; a full game from 6 players to game over.
- A browser run of a full game, and a check on real phones by Dave before the live site is replaced.

## Left to the builder

- The exact shape of the stored game state.
- Wording and layout of the scoreboard, benches and result screens.
- How the random tie draw is made (it happens on the game master's phone).
