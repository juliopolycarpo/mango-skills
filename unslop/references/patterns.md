# Pattern catalog

Mark every tell in the whole text first, strongest first, then rewrite each point instead of
patching phrases. Look at paragraph shape too: a contrast split over two sentences, three
parallel examples, or the same closer after each section is one tell at a larger scale.

Strength matters. Structural tells (sections A, D, E) persist across model releases and justify
an edit on one sighting. Word lists (section B) age with each model generation and are _weak
alone_: act when several cluster in one passage. A person can make any of these choices on
purpose, so keep one that carries information.

## A. Staging instead of stating

- **Not X but Y.** "Not just X, but Y", "it's not X, it's Y", "Y rather than X", the split form
  ("This doesn't mean X. It means Y."), and clipped tails (", no guessing"). The negative half
  names something nobody claimed. State Y. Keep a contrast that corrects a belief the reader
  actually holds, such as a reviewer's stated assumption.
- **One-line closers.** "That's the real win.", "This matters.", a sentence that names what the
  example above showed, or a row of fragments. Cut unless it adds a new fact or consequence.
- **Sayings that sound deep.** "At its core", "the real question is", "what really matters",
  "X is the language of Y". Replace with the specific claim.
- **Run-ups.** "Let's dive in", "Here's what you need to know", "Here's the thing", "Quick
  note", a standalone "Honestly?". Start at the point.
- **Arguing with no one.** "To be clear", "This isn't about", "A tempting approach would be",
  "You might think". Usually a leftover from an earlier draft. Keep an alternative a reviewer
  would actually weigh, and say why it lost.
- **Writing about the document.** "The table below compares", "This section is organized by",
  "anything unconfirmed is flagged". Readers can see the layout. Describing what changed is
  correct in commits, PRs, changelogs, and migration guides; elsewhere describe the subject.
- **Heading restated.** A first sentence that repeats its heading. Delete it.

## B. Inflation and borrowed authority

- **Significance claims.** "Pivotal", "testament to", "plays a key role", "sets the stage",
  "evolving landscape", "the future looks bright", stock "Challenges and outlook" sections. Keep
  the fact, drop the weight, end on the last concrete fact.
- **-ing riders.** ", ensuring reliability", ", highlighting the need", ", reflecting". Delete,
  or state the effect with its evidence.
- **Promotional words.** "Seamless", "robust" (figurative), "powerful", "comprehensive",
  "blazing fast", "groundbreaking". Use a measurement or a neutral description.
- **Vague authority.** "Experts say", "industry reports", "it is widely believed". Name the
  source or cut the claim. A missing citation alone is normal.
- **Vague association.** "Associated with", "tied to", "in connection with". Name the
  relationship if the source gives it; otherwise keep the vague wording rather than invent one.
- **Avoiding is/has.** "Serves as", "stands as", "functions as", "boasts", "features". Write
  `is` or `has`.
- **Word list** (_weak alone_, ages fast): additionally, align with, crucial, delve, enhance,
  foster, garner, intricate, landscape, leverage, meticulous, multifaceted, showcase, tapestry,
  underscore, utilize, vibrant. Abstract metaphor nouns used figuratively: north star,
  flywheel, wedge, ratchet. Technical senses (attack surface, API surface, gate a feature) are
  fine.

## C. Rhythm by rule

- **Forced triads.** Three items, examples, or adjectives because three sounds complete. Use the
  real count; a genuine list of three stays.
- **Uniform rhythm.** Every sentence the same length or opening ("This…", "It…"). Vary it by
  merging or reordering, not by adding flourishes.
- **Dashes everywhere.** A dash used to avoid deciding how clauses relate. One dash is _weak
  alone_. Do not trade it for a comma or period by reflex: newer models that avoid dashes
  overuse those instead. Pick the relation (because, so, which, colon) or split.
- **Stacked hedges.** "Could potentially", "might arguably", "it may be possible that". Keep one
  accurate qualifier; keep scope statements and real caveats. Single hedges are normal.
- **Filler.** "In order to" → "to"; "due to the fact that" → "because"; "it is important to
  note that" → delete; "significantly improves" → the measured delta.
- **Hidden actor.** "Is validated", "was handled". Name what validates or handles it. _Weak
  alone_: passive is right when the actor is unknown or irrelevant.

## D. Formatting by rule

- **Bold labels.** Lists where each item is "**Label:** restated label". Turn into prose or a
  table, or drop the labels.
- **Decorative structure.** Title Case headings, emojis or arrows in headings and lists, a rule
  between every section, a top heading repeating the title.
- **Wrong syntax for the surface.** Markdown headings or bold in a commit message, HTML in a
  plain-text field, skipped heading levels. Markdown itself is normal in PRs, issues, and docs.
- **Curly quotes** in your own text (_weak alone_). Leave quoted material as written.

## E. Leftovers

Remove these outright.

- **Chat residue.** "Great question", "Certainly!", "You're absolutely right", "I hope this
  helps", "Let me know if", "Would you like me to", "Here is a…". Keep the content inside.
- **Knowledge and source hedges.** "As of my last update", "based on available information",
  "not widely documented", followed by a guess. State what was checked and what is unknown.
- **Placeholders.** `[Insert X]`, `<your value>`, `TODO: fill`, `2026-xx-xx`, unchecked template
  prompts left as text.
- **Tool markup.** `:contentReference[oaicite:N]`, `citeturn0search0`, `[cite: N]`,
  `utm_source=chatgpt.com`, `[attached_file:1]`.
- **Process narration.** "Per reviewer feedback", "preserved X while improving Y", "address
  review comments", "as requested". Describe the result.

## F. Wrong reader

A reply in a thread or review has a reader who already knows the background. Rebuilding the
problem, the diagnosis, and proof before the decision buries the point and survives
sentence-level cleanup. Lead with the decision; keep only the one fact the reader lacks and the
link or commit they need to act. Act on this only when the text is clearly a reply.

## Source notes

The catalog draws on [Humanizer](https://github.com/blader/humanizer) and the editing ideas
in Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing).
It is for improving drafts, not for determining whether someone used AI. Preserve intentional
choices that serve the writer's meaning. Humanizer's license is bundled in [LICENSE.humanizer](../LICENSE.humanizer).
