# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Vite with vanilla JavaScript (no framework), Firebase anonymous sign-in, Firestore and Firebase Hosting. Dave left the how to Claude and approved it in the design doc; chosen for no install and the least to build.

## Users

Families with kids, in the same room, each holding their own phone. Mixed ages and mixed reading speed. Everyone plays; there is no game master. The person who creates the room (the host) is a player like the others whose phone also runs the room. They are talking and laughing out loud; the phone is glanced at, not studied.

## Product Purpose

A word party game called Heroes vs Spies, told as a story: every player is a Hero, and a virus is hiding in one of them (the carrier), who gets a slightly different word and is not told. Players give clues out loud, then vote one player out. Every round the carrier is picked afresh at random from everyone still in (it may be the same player again) and new words are dealt. Each result reveals who was voted out, who had the virus and both words, and gives personal points: a healthy Hero voted out ("sent to rest") gives that round's carrier 2 points; a carrier voted out ("cured") gives 1 point to each player still in who voted for them. When 3 players are left, a final battle decides the order of the top three. Success is a round that starts in under a minute, never leaks the current carrier, and makes people want another game.

## Positioning

The game runs itself. Nobody sees both words or knows the carrier until that round's result reveals them, the host included. Words are picked at random, the first speaker is picked at random (with 5 or more players still in, at least 2 people speak before the carrier), and rounds advance by themselves about 10 seconds after each result. The host's only required action is tapping New game.

## Operating Context

- Phones held in one hand, often passed glances between speakers, in living-room light.
- The host's phone runs the room in the background and must stay open. If it sleeps, the other phones say so once everyone has voted or a result has shown for a while.
- Screens are read at arm's length for a second or two; other people may be sitting close enough to glance at a neighbour's screen.
- Players join with a short room code read out loud.

## Capabilities and Constraints

- Any number of players, minimum 4 to start, the host included.
- Phases: lobby, voting, result, gameOver. Vote buttons are on every phone from the start of a round; a vote is cast once and never changed.
- During a vote no screen may show or hint the current carrier or the other word; all player screens look identical apart from the word. Every result (a cancelled round too) names that round's carrier and shows both words and the points just earned. The result reads the same whether the virus stays or moves: "The virus is on the move."
- One vote per round puts one player out. A tie (or no votes) draws one of the tied players at random, the carrier included, and the result does not mention the tie.
- With 5 or more players still in, the carrier speaks third or later. With 4 or 3, anyone may start, the carrier included.
- Final battle at 3 players: one vote. If the carrier is not voted out, the carrier gets 4 points and is 1st, the two Heroes 2nd and 3rd by points; if the Heroes catch it, they are 1st and 2nd by points and the carrier 3rd. Below them: everyone voted out, by points, then anyone the host removed, by points, marked "did not finish". Level points share a place only inside a group. Fewer than 3 left (after removals) ends the game with everyone ranked by points alone ("Not enough players left.").
- Players voted out see only the points table and who is out, and are not dealt words. Late joiners wait for the next game. Points start at 0 each game.
- 63 word families of 4 related words in `words/word-families.json`; a pair is any two words of one family (378 pairs). A pair never repeats in a room until every pair has been used. Nobody types words.
- No chat, accounts, teams, points carried between games, or more than one carrier at a time.
- English interface.
- Players other than the host can always leave; the host leaves only alone (the room is deleted) or after handing the room to someone between games.
- Full rules: `docs/superpowers/specs/2026-11-16-virus-story-design.md` (builds on `2026-11-15-no-game-master-design.md` and the designs under it).

## Brand Commitments

- Name on screen: "Heroes vs Spies" (Dave, 2026-11-15). It is defined in one place, `GAME_NAME` in `src/ui.js`.
- Words on screen: "virus", "carrier", "cured", "sent to rest". Nobody is killed or eliminated. No "spy", "team" or "bench" (the game's name apart).
- No logo, colours or fonts are fixed.

## Evidence on Hand

- The word families list. No screenshots, testimonials or player data exist; none may be invented.

## Product Principles

1. The secret comes first: nothing on a player's screen may narrow down the current carrier.
2. One thing per screen: at any moment a phone shows the one thing its holder needs.
3. The room is the game: the app deals, counts and reveals, and stays out of the conversation.
4. A child can play: plain words, large type, big tap targets.

## Accessibility & Inclusion

Mixed ages including children and grandparents: large readable text, tap targets of at least 44px, strong contrast, and no information carried by colour alone.
