---
version: 1
slug: "src-ui-js"
primary_target: "src/ui.js"
related_targets: ["index.html","src/style.css"]
---

# Heroes vs Spies screens

Scope: every screen of the web app (join/create, host lobby, waiting lobby, round with the vote, bench, late joiner, result, game over). There is no game master: the host is a player whose phone runs the room. Mode: Operate. Phone-first, read at arm's length for a second or two.

Audience and job: families with kids, mixed ages, same room, each on their own phone. Players need one fact per screen (their word, who to vote for, the result). The host's screens equal everyone else's plus a keep-open strip and a collapsed Remove a player; the host's phone must stay open.

Constraints: screens identical for the spy, the heroes and the host (apart from the host-only controls); nobody sees both words or the spy before the game reveals them; tap targets 44px+; plain words; nothing carried by colour alone.

Memorable moment: "Your word" written huge on a three-line handwriting guide, like a child's first copybook word.

Name: Heroes vs Spies (one constant, `GAME_NAME`). Custom fonts are loaded from Google Fonts at run time.

## Direction contract

THESIS: The phone is a page from a school writing pad, the kind every kid in the family has filled in. Refuses the spy-game default of a dark noir dossier with redacted bars and trench-coat silhouettes.

OWN-WORLD: Cool newsprint page ground ruled with pale blue writing lines and one red margin rule; a deep cobalt pad-cover band carries the title and room code; graphite ink for text; red is reserved for the spy and for errors, always paired with a written word. One family, Andika (a typeface designed for beginning readers), regular and bold. Buttons are solid cobalt blocks with white bold labels, secondary buttons are outlined in graphite.

STORY: Everyone sees their word at once, reads it in a glance, says a clue out loud in the order shown, then taps one name in that same list. The result shows on every phone and the next round starts by itself.

FIRST VIEWPORT: Cobalt cover band on top with "Heroes vs Spies" and, once in a room, the room code. Below, the ruled page: on a player phone the word set at about 3.5rem on a dashed three-line guide, then the speaking order as a numbered ruled list whose other names are the vote buttons. Primary action is one full-width button at thumb height.

FORM: Intermediate writing pad, candidate 7 of 7 (grounded list: Pinoy Henyo word cards, reunion bingo cards, fiesta banderitas, jeepney signboards, cartolina classroom charts, sari-sari price board, writing pad). seed:8b163826fd897357. Raises: from the Crouwel grid specimen (declined), every row snaps to the ruled-line pitch so the page keeps one rhythm; from the exposure-record sheets (declined), state is drawn as marks and words (struck names, a written SPY tag in the margin) before colour; from the character goods catalog (competitive on audience, declined on clarity), players are a finite roster of whole-width name rows that reflow as whole cells.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
