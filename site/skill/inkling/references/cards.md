# Turning text into Inkling card lines

Use this when the user pastes notes, a chapter or a word list and wants Inkling flashcards from it.

## Rules for each line

1. One fact per card. Keep the front short and specific, and the back only the answer.
2. Use `Term :: Definition` for terms, names, dates, vocabulary and short questions: `What does a ribosome build? :: Proteins`.
3. Use a cloze when the fact reads best as a sentence: `{{c1::Bern}} is the capital of Switzerland`. Give spans the same number to hide them together, different numbers for separate cards. Add a hint with a second `::` inside the braces: `{{c1::1848::year}}`.
4. Never put `::` in the front of a `Term :: Definition` line. The first `::` splits the line; a later `::` stays in the answer.
5. Keep each card on one line. If the answer is a short list, end the line with `::` and put each item on its own line below, starting with a space.
6. Write plain text. Do not number the lines or start them with `-`, `*` or `- [ ]`: pasted as plain text, those characters end up in the front of the card. Formatting such as bold is not kept on cards.
7. Leave headings and blank lines out. The user can type a heading into the note after pasting.
8. Give every card in one note a different front.

## Output

Return the card lines in one plain code block and nothing else inside it, so the copy button copies plain text. Then tell the user, in one or two sentences, to paste the lines into a note and click Flashcards in the toolbar.

Example:

```
Mitochondrion :: Makes most of the cell's ATP
Ribosome :: Builds proteins from amino acids
{{c1::Photosynthesis}} turns light into chemical energy in the {{c2::chloroplast}}
Three parts of a nucleotide ::
 a phosphate group
 a sugar
 a nitrogen base
```

This makes five cards: two plain cards, two cards from the cloze line (one per number) and one card with a three-line answer.

## Changing cards that already exist

- The user edits the lines in the note and clicks Flashcards again. Changed lines keep their review history; new lines become new cards; deleted lines lose their cards.
- If the user replaces lines with a revised version you wrote, keep each front exactly as it was. A pasted line is matched to its old card by its front text, so a card whose front is unchanged keeps its history.
- A changed front on a pasted line counts as a new card, and the old card is removed.
