---
name: Spy Game
description: A page from a school writing pad, for a family word game played out loud.
colors:
  paper: "#f3f5f2"
  paper-deep: "#e6ebe7"
  ink: "#1f2429"
  ink-soft: "#46505a"
  rule: "#b7cbe4"
  rule-strong: "#6f93c8"
  cobalt: "#1f4fa8"
  cobalt-press: "#163c84"
  on-cobalt: "#ffffff"
  on-cobalt-soft: "#d5e1f6"
  red: "#b3261e"
  margin: "#e08a84"
typography:
  word:
    fontFamily: "Andika, Trebuchet MS, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 12vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.45
  room-code:
    fontFamily: "Andika, Trebuchet MS, system-ui, sans-serif"
    fontSize: "4rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.18em"
  h1:
    fontFamily: "Andika, Trebuchet MS, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  h2:
    fontFamily: "Andika, Trebuchet MS, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Andika, Trebuchet MS, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.5
  hint:
    fontFamily: "Andika, Trebuchet MS, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.4rem"
spacing:
  line: "2.75rem"
  gutter: "1rem"
  margin-gutter: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1.25rem"
    height: "3rem"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-press}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "3rem"
  button-choice:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.cobalt}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
    width: "100%"
  button-choice-hover:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
  button-danger:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-cobalt}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
  cover:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-cobalt}"
    height: "3.5rem"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "3rem"
---

# Design System: Spy Game

## Overview

The phone is a page from a school writing pad, the kind every kid in the family has filled in: a cobalt pad cover on top, a cool newsprint page below it, pale blue writing rules, and one red margin rule down the left. It refuses the spy-game default (dark noir, redacted bars, dossiers). Mode is Operate: the world lends palette, type, density and one signature move; the controls are plain web buttons, fields and lists.

The signature move is the player's word written on a copybook three-line guide (top line, light middle line, baseline), large enough to read at arm's length in a glance.

## Colors

### Primary
- **Cobalt** (`cobalt`): the pad cover band and every primary button. White text on it.

### Neutral
- **Paper** (`paper`) is the page ground; **Paper deep** (`paper-deep`) is the one second layer (the game master's "Keep this screen open" strip, secondary-button hover).
- **Ink** and **Ink soft** carry all text. Ink soft is for labels, hints and numbers in lists, never below 4.5:1 on paper.
- **Rule** and **Rule strong** draw the writing lines. They are decoration only and carry no meaning.

### Named Rules
- **The Red Pen Rule.** Red (`red`) marks only the spy and errors, and is always paired with a written word ("SPY", "Problem:"). The margin rule (`margin`) is the only decorative red.

## Typography

One family, Andika (a typeface designed for beginning readers: single-storey a and g, distinct I/l/1), regular and bold, loaded from Google Fonts with Trebuchet MS and the system sans as fallback. Fixed rem steps; only the word scales with the viewport so long words fit a phone.

### Hierarchy
- Word: 2.25 to 3.5rem bold on the three-line guide.
- Room code: 4rem bold, tracked 0.18em.
- h1 2rem, h2 1.375rem, body 1.125rem, hints 1rem.

## Layout

A single column, max 34rem, padded 1rem on the right and 2rem on the left so text clears the red margin rule. Lists are ruled rows of at least one line pitch (`line`, 44px), one item per writing line, with a pale blue rule under each. Primary actions are full width.

## Elevation & Depth

Flat. No shadows. Layers are told apart by the cover band, the paper-deep strip and rules.

## Shapes

Small 0.4rem corners on buttons, fields, tags and the error box. Everything else is square, like paper.

## Components

### Buttons
- Primary: solid cobalt, white bold label, full width, 48px tall.
- Secondary: transparent with a 2px ink outline, full width.
- Choice: a whole ruled line you can tap (a name to pick or vote for): paper fill, cobalt text, rule-strong outline; fills cobalt on press, and on hover only on devices with a real pointer (`@media (hover: hover)`), because :hover sticks after a tap on phones.
- Small: the per-row actions (Remove, Make game master), at least 44px tall.
- Danger: solid red, only for confirming a removal that ends the round.
- Disabled: 45% opacity with the reason written beside it.

### Inputs / Fields
White fields with a 2px ink-soft border and a bold label above. The room code field is uppercase and tracked.

### Navigation
None beyond the cover band. Each screen shows one thing; the game state decides the screen.

### Score line and scoreboard
- Score line: "Heroes **N** · Spies **N**" in tabular numerals, the same on every phone (the spy's too). The numbers are 1.5rem on round screens and 2rem on the scoreboard and at game over, where the score is the point of the screen.
- Scoreboard: an h2 "Score" and the score line, then one ruled label-and-names row each for Hero bench, Spy bench and Still in (the same row pattern as the word pairs, names in regular weight, comma-separated). Still in is left out where a speaking order already lists the players. The Spy bench lists only caught spies.

### Final battle note
A white box with a 2px cobalt outline and the words "Final battle, worth N points" in bold cobalt. Shown during the final round only, identical for every player.

### Spy tag
An outlined red uppercase "SPY" word next to a name. Shown only on the game master's screens and in results.

## Do's and Don'ts

### Do:
- Put one thing per screen and let the big word or the big code lead.
- Write every state in words: "Vote sent", "3 of 5 voted", "too close to the spy", struck names for unsafe starters.
- Keep player screens identical for the spy and everyone else: only the word text may differ.

### Don't:
- Don't use red, or any colour, as the only signal.
- Don't add noir, dossier or redaction imagery.
- Don't use a modal or `alert`; errors sit inline next to the control.
