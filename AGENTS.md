# AGENTS.md — BLOB ARCADE

> **Preserve the game, not the implementation.**
>
> Existing code is a starting point, not a sacred artifact.
> Be creative. Refactor when justified. Optimize when useful.
> Keep gameplay truth deterministic and readable.
> Rendering may cheat aggressively for feel and spectacle.
> Never sacrifice player comprehension for effects.

## 1. Purpose

This file defines how coding agents should work on **BLOB ARCADE / multi-mini-game**.

It is a decision framework, not a creativity limiter. Agents are expected to:
- understand the existing architecture before changing it;
- preserve project-wide contracts;
- improve weak or duplicated systems when useful;
- experiment with game feel, rendering, audio and performance;
- keep changes understandable, testable and scoped;
- avoid local hacks that silently bypass shared systems.

The target is a project that becomes **more expressive and more maintainable at the same time**.

## 2. Project identity

BLOB ARCADE is a collection of arcade mini-games sharing:
- one Blob universe;
- one engine and lifecycle;
- shared input, audio, FX and UI foundations;
- adaptive music;
- deterministic sessions where gameplay randomness matters;
- keyboard + controller support;
- local multiplayer foundations;
- replay/debug infrastructure.

Games may have radically different gameplay and visual staging.

Think:

> **Same universe, different rides.**

Shared identity must not flatten each game's personality.

## 3. Source-of-truth precedence

When information disagrees, use this order:

1. **Current user task**
2. **This `AGENTS.md`**
3. **Game/system-specific design and work documents**
4. **Current implementation and tests**
5. **General documentation such as `README.md`**

Before materially redesigning a game or system, search for related documents.

Examples currently include:
- `CAVE_GAME_FEEL.md`
- `CAVE_RACER.md`
- `DESIGN_BLOB_UNIVERSE.md`
- `BLOB_BREAKER_DOSSIER_TRAVAIL/`
- `arcade_music_orientation_final/`

Do not assume the README contains the newest design decision.

If current specific documents conflict:
- prefer the document closest to the system being changed;
- preserve existing functional contracts unless the task intentionally changes them;
- report conflicts that materially affected implementation.

## 4. Creative mandate

Creativity is explicitly allowed.

You may:
- redesign internal systems;
- generalize useful primitives;
- replace fragile implementations;
- introduce modern rendering techniques;
- add procedural animation and visual cheats;
- improve camera, audio, adaptive music or haptics;
- add debug tooling;
- optimize hot paths;
- add reusable helpers;
- add assets when beneficial;
- promote a local solution to `js/core/` when it becomes genuinely reusable.

Do **not** interpret this file as:
- make the smallest diff at any cost;
- never touch core;
- never add assets;
- never introduce a dependency;
- preserve every implementation detail.

Every larger change must still serve a concrete goal. Avoid speculative rewrites and architecture for its own sake.

## 5. Core philosophy — simulation is truth, rendering is theatre

Gameplay simulation determines:
- hitboxes;
- collisions;
- timing;
- scoring;
- player state;
- procedural gameplay generation;
- hazards and pickups;
- movement;
- win/loss conditions.

Rendering may exaggerate:
- shape;
- apparent speed;
- camera motion;
- depth and parallax;
- squash/stretch;
- deformation;
- trails and particles;
- fake lighting;
- impact waves;
- screen-space anticipation;
- environmental motion;
- temporary visual offsets.

The image does not need to be a literal representation of simulation.

It needs to communicate the simulation better.

> **Simulation is truth. Rendering is theatre.**
>
> **Theatre must never hide the truth the player needs to make a decision.**

## 6. Readability beats spectacle

Game feel should be strong. Visual noise should not be.

Before adding or intensifying an effect, ask:
- Can the player identify their character immediately?
- Can they see the next meaningful danger?
- Can they understand why they were hit?
- Does the effect clarify an event or merely decorate it?
- Does camera motion preserve spatial understanding?
- Is collision geometry still readable at peak intensity?

Useful visual hierarchy:
1. gameplay-critical geometry;
2. player;
3. hazards/objectives;
4. direct feedback;
5. environmental motion;
6. decoration/post effects.

When appropriate, redraw gameplay-critical boundaries above decorative layers.

> **Spectacle is encouraged; visual noise is not.**

## 7. Game feel is part of the feature

A gameplay feature that technically works but feels unfinished may not be done.

Consider:
- anticipation;
- acceleration/deceleration;
- squash & stretch;
- secondary motion and follow-through;
- hitstop;
- screenshake;
- recoil/camera kick;
- sound and pitch variation;
- vibration;
- particles/trails;
- environmental reactions;
- short slow-motion moments;
- UI timing.

Use different feedback weights for different events.

Example hierarchy:

`minor pickup < good hit < near miss < major combo < death / major impact`

Do not trigger every feedback channel for every event.

## 8. Blob universe contract

Refer to `DESIGN_BLOB_UNIVERSE.md` for detailed visual direction.

High-level contracts:
- the Blob remains soft, expressive and readable;
- it should feel alive even in mechanically simple games;
- it is the same character/family across game accents;
- expressions support gameplay state instead of becoming constant noise.

### Hitbox contract

`blob.r` is gameplay truth.

Do not silently change gameplay hitboxes to match a new drawing.

The rendered Blob may stretch, squash, wobble, overshoot, trail or visually extend beyond its hitbox.

Change the hitbox only when gameplay design actually requires it.

### Procedural character identity

Do not replace the procedural Blob character with a static bitmap merely for convenience.

Assets may absolutely be used around it.

If character rendering itself is intentionally redesigned, treat that as an architectural/design change rather than a local shortcut.

## 9. Architecture map

Important areas:

```text
js/core/        engine, BaseGame, input, audio, music, FX, blob,
                physics, collisions, RNG, replay, devtools, pools, UI
js/games/       individual mini-games
js/main.ts      browser entry
js/menu.ts      arcade hub
js/demos.ts     attract-mode previews
tests/          project tests
```

Check for an existing shared capability before rebuilding one inside a game.

## 10. BaseGame and lifecycle

Mini-games should integrate through `BaseGame` unless a task intentionally redesigns this architecture.

Shared concerns include:
- pause;
- restart;
- quit;
- game-over;
- score/stat persistence;
- music lifecycle;
- session metadata;
- player inputs;
- seeded RNG.

Do not create a second local implementation of these systems without strong reason.

If a game needs a new lifecycle concept, first consider whether the shared abstraction should expose it.

## 11. Core vs game-local code

Ask:

> Is this mechanic game-specific, or am I creating a reusable arcade primitive?

Keep genuinely game-specific concepts local.

Examples:
- Cave tunnel generation;
- Golf lie/ball rules;
- Fish tension mechanics;
- rhythm chart rules.

Consider `js/core/` for reusable primitives such as:
- camera impulse models;
- generic particle emitters;
- object pooling;
- collision helpers;
- debug graphs;
- common animation/easing tools;
- generic screen-space impact effects.

Do not move code to core merely to shorten a file.

Core should contain real shared concepts.

## 12. Adjacent improvements

You may improve adjacent code when it materially supports the requested task.

Good:
- improving a particle pool because the requested effect causes excessive allocations.

Bad:
- redesigning the menu while changing Cave particles because you dislike its structure.

Keep adjacent changes relevant, understandable and limited. Mention meaningful ones in the final report.

> **Don't fix adjacent things silently.**

## 13. Determinism, RNG and replay

Gameplay randomness must be reproducible.

Use `this.rng` or another explicitly seeded RNG derived from `this.session.seed` for randomness affecting:
- procedural geometry;
- obstacles/items;
- enemy decisions;
- gameplay timing;
- scoring opportunities;
- physical outcomes.

Do not introduce `Math.random()` into gameplay-critical simulation.

Purely cosmetic nondeterminism may be acceptable for:
- background dust;
- decorative stars;
- transient noise;
- cosmetic spark variation.

Prefer seeded visual randomness when it helps replay fidelity or debugging.

A good pattern is a separate visual RNG derived from `session.seed`.

## 14. Input contract

The project is controller-first but keyboard-friendly.

Before adding input logic:
- inspect the shared input layer;
- use project abstractions;
- preserve gamepad support;
- preserve keyboard support;
- avoid browser-global event hacks inside games.

Do not create different gameplay rules for keyboard/controller unless intentionally designed.

Pointer input should not silently alter gameplay in games designed around controller/keyboard input.

## 15. Local multiplayer awareness

Do not assume every system is permanently solo.

The engine already carries:
- session mode;
- player count;
- per-player input;
- replay/session metadata.

Not every feature must immediately support multiplayer, but new architecture should not make multiplayer impossible without reason.

If a feature is intentionally solo-only, make that constraint explicit.

## 16. Audio

Use the shared audio system.

Avoid unmanaged per-game WebAudio graphs when the common layer can support the feature.

Audio feedback is part of game feel. Consider:
- transient shape;
- pitch and pitch progression;
- intensity;
- rhythmic timing;
- stereo position when useful;
- variation;
- layering;
- fatigue over repeated play.

Do not make every event louder. Use contrast.

## 17. Adaptive music

Adaptive music is a project-level system.

Games should communicate meaningful state instead of micromanaging an isolated composition.

Prefer exposing:
- tension;
- speed;
- danger;
- combo;
- success;
- near miss;
- waves/phases;
- player damage;
- major events.

Use existing music adapters/events where possible.

If the API lacks an important reusable concept, improve the shared adapter instead of bypassing it locally.

## 18. Assets

The project historically relied heavily on procedural rendering. That is a direction, not a prison.

Assets are allowed when they materially improve:
- readability;
- identity;
- atmosphere;
- production quality;
- iteration speed;
- performance.

Prefer procedural techniques when expressive, lightweight and easily parameterized.

Prefer assets when procedural recreation would be expensive, visually weaker or unnecessarily complex.

Optimize image/audio assets for web delivery and avoid redundant large files.

## 19. Dependencies

Keep the runtime footprint deliberate.

Do not add a runtime dependency merely to save a few lines.

A dependency may be justified for:
- substantial rendering capability;
- proven performance improvement;
- difficult cross-browser behavior;
- a complex system that would otherwise be poorly reimplemented.

Consider:
- bundle size;
- runtime cost;
- maintenance;
- browser support;
- native platform alternatives;
- whether the project already has the needed capability.

Dev dependencies are less sensitive but still need a purpose.

## 20. Performance philosophy

Optimize where the bottleneck actually is.

Watch for:
- allocations inside frame loops;
- array/object churn;
- repeated path construction;
- expensive filters/gradients/shadows;
- per-pixel work;
- unnecessary canvas state changes;
- unbounded particles;
- retained-object growth;
- audio node leaks;
- unnecessary DOM/layout work.

Prefer:
- pooling when useful;
- reusable buffers/arrays;
- cached geometry;
- bounded effect counts;
- LOD/density strategies;
- profiling before complex optimization.

Do not sacrifice clarity for unmeasured micro-optimizations.

## 21. Modern rendering tricks are encouraged

Appropriate techniques may include:
- Canvas compositing;
- offscreen canvases;
- masks;
- additive layers;
- procedural textures;
- dynamic gradients;
- parallax;
- fake depth/lighting;
- screen-space distortion;
- motion streaks;
- camera transforms;
- particle fields;
- layered silhouettes;
- shader-like approximations;
- WebGL when justified.

The project embraces visual cheating.

Ask:
- Is it readable?
- Is it performant?
- Is it stable?
- Does it improve the game?

Do not add complexity only because a technique is fashionable.

## 22. Camera rules

Camera movement should communicate motion and impact, not destroy spatial understanding.

Good uses:
- brief impact kick;
- directional anticipation;
- velocity framing;
- subtle look-ahead;
- controlled zoom;
- short shake;
- transition choreography.

Avoid:
- continuous high-amplitude shake;
- unpredictable rotation;
- zoom hiding upcoming hazards;
- camera motion that makes collision position ambiguous.

## 23. Effects hierarchy

Possible feedback channels:
- Blob deformation;
- particles;
- ring/shockwave;
- camera;
- sound;
- adaptive music event;
- vibration;
- UI;
- environment reaction;
- color/exposure;
- time manipulation.

Major events may combine several channels.

Minor events should usually use fewer.

Avoid activating every channel on every event.

## 24. Difficulty and fairness

Difficulty should come from:
- faster decisions;
- tighter spaces;
- richer patterns;
- resource pressure;
- meaningful trade-offs;
- combinations of learned mechanics.

Avoid fake difficulty caused by:
- unreadable hazards;
- surprise collision geometry;
- camera obstruction;
- invisible state;
- effects covering obstacles;
- inconsistent input;
- uncontrolled randomness.

The player should generally understand why they failed.

## 25. Procedural generation

Procedural generation should create variety, not noise.

Prefer:
- authored constraints;
- readable pattern families;
- seeded generation;
- controlled transitions;
- safe-state guarantees where needed;
- difficulty-aware ranges.

Avoid unconstrained randomness.

Keep procedural systems debuggable and expose/log problematic seeds when practical.

## 26. UI and HUD

Prioritize information by immediate gameplay value.

Avoid turning play screens into dashboards.

Prefer:
- strong hierarchy;
- compact information;
- animation tied to change;
- consistent Blob Arcade language;
- soft/rounded forms when appropriate.

Do not animate persistent HUD elements merely because animation is possible.

Animate meaningful state changes.

## 27. Debuggability

Debug tooling is welcome.

Useful visualizations include:
- hitboxes;
- collision normals;
- procedural boundaries;
- spawn positions;
- difficulty curves;
- speed/frame-time graphs;
- particle/object counts;
- seed;
- music state;
- player/AI state;
- camera target vs render position.

Integrate with existing devtools/analyzer systems where practical.

Debug visualization must be easy to disable and should not become production gameplay logic.

## 28. TypeScript

Do not weaken TypeScript just to make code compile.

Avoid adding broad `any` escape hatches when a reasonable type can be expressed.

Existing legacy `any` is not a precedent.

Prefer:
- narrow interfaces;
- explicit state shapes;
- discriminated unions when useful;
- typed helper returns;
- shared types for real shared contracts.

Do not over-engineer types for trivial private details.

## 29. Error handling

Do not silently swallow unexpected errors.

For recoverable conditions:
- preserve game flow;
- use a safe fallback;
- expose useful debug information when appropriate.

For programmer errors:
- fail clearly during development;
- use assertions/devtools for invalid state.

Debugging infrastructure should not casually crash normal production gameplay.

## 30. Comments and tuning

Comments should explain:
- intent;
- non-obvious constraints;
- mathematical tricks;
- visual cheats;
- gameplay contracts;
- reasons for unusual constants.

Avoid comments that merely restate code.

Keep related gameplay tuning constants discoverable and named. Avoid scattering unexplained magic numbers through update/render code.

Do not create a global configuration framework merely to avoid a few constants.

## 31. Game-specific experimentation

A game is allowed to develop a strong identity.

Do not force every game to share the same:
- camera;
- particle density;
- background;
- pace;
- composition;
- control complexity;
- mechanic structure.

The Blob universe is connective tissue, not a uniform skin.

A Cave game should feel like Cave. Breaker should feel like Breaker. Golf should feel like Golf.

## 32. Demos / attract mode

After materially changing a game's primary mechanic or visual fantasy, check `js/demos.ts`.

The demo does not need full gameplay fidelity, but it should not become misleading or visibly obsolete.

## 33. Documentation

Update documentation when a change alters a durable contract:
- architecture;
- controls;
- reusable APIs;
- game rules;
- asset pipeline;
- build workflow;
- rendering systems.

Do not edit every document for tiny tuning changes.

If implementation intentionally diverges from a dedicated design document, document that decision.

## 34. Scope discipline

Prefer the **smallest coherent change**, not necessarily the smallest diff.

A coherent task may legitimately include:
- a game implementation;
- one reusable core primitive;
- one test;
- one documentation update.

Avoid unrelated cleanup sweeps.

Perform a larger refactor when:
- it materially helps the requested work;
- the benefit is understandable;
- behavior can be validated;
- the resulting architecture is simpler or more capable.

## 35. Validation

Before considering a coding task complete, run relevant validation.

Baseline:

```bash
npm run typecheck
npm test
```

For substantial changes:

```bash
npm run build
```

Also manually validate relevant behavior where possible:
- controller;
- keyboard;
- pause/resume;
- restart;
- return to menu;
- game over;
- audio start/stop;
- resizing;
- visual settings;
- replay;
- local multiplayer;
- deterministic seed behavior.

Do not claim validation you did not perform.

## 36. Visual validation

Compilation is not sufficient for rendering or game-feel work.

Inspect visual changes for:
- readability;
- layering/clipping;
- excessive brightness;
- motion sickness risk;
- effects hiding hazards;
- camera framing;
- HUD collisions;
- inconsistent scale;
- peak-intensity behavior;
- performance.

If visual inspection is impossible in the current environment, state that explicitly.

Do not pretend code review is equivalent to playing the result.

## 37. Definition of Done

A gameplay change is complete when:
- the intended rule works;
- player feedback makes it understandable;
- important interactions feel intentional;
- gameplay-critical visuals remain readable;
- input remains correct;
- relevant validation passes;
- durable architectural changes are documented;
- no severe known regression remains.

A visual/game-feel change is complete when:
- it materially improves the intended sensation;
- it does not obscure gameplay truth;
- it remains controlled at peak intensity;
- it does not introduce obvious performance problems;
- it degrades gracefully when effects are reduced.

## 38. Recommended agent workflow

For non-trivial tasks:

### 1 — Understand
Read the relevant game, core systems, specific design docs and relevant tests.

### 2 — Identify contracts
Determine what must not accidentally change: hitbox, controls, score, seed behavior, APIs, replay compatibility, player-count behavior, etc.

### 3 — Choose scope
Decide whether the change belongs locally, in core, or in both.

### 4 — Implement
Favor clear behavior over cleverness.

### 5 — Add feel
For player-facing mechanics, verify that feedback is sufficient.

### 6 — Validate
Run typecheck/tests/build as appropriate and inspect visuals when relevant.

### 7 — Report
Summarize meaningful changes, validation and remaining limitations.

## 39. Final agent report

For substantial tasks, report concisely:

### Changed
What materially changed.

### Why
Important design or architectural reasoning.

### Validation
Commands/tests/manual checks actually performed.

### Notes
Known limitations, intentional trade-offs or meaningful adjacent changes.

Do not dump a long edit diary or file list unless useful.

## 40. Explicit anti-patterns

Do not:
- bypass shared input without reason;
- create a second pause/session/stats system inside one game;
- make gameplay randomness nondeterministic;
- change hitboxes just to match visual deformation;
- use effects to hide unfair gameplay;
- leave particle/object counts unbounded;
- rewrite core only for aesthetic preference;
- introduce dependencies casually;
- silence TypeScript with broad `any`;
- claim tests passed without running them;
- treat README as newer than specific current design docs;
- preserve bad code purely because it exists;
- remove unusual behavior before checking whether it is intentional game feel;
- flatten all games into one visual style;
- mistake visual complexity for quality.

## 41. Questions to use when uncertain

### Architecture
> Is this truly game-specific, or am I rebuilding a core capability?

### Gameplay
> Is the rule deterministic, understandable and fair?

### Rendering
> Can I exaggerate this more without hiding gameplay truth?

### Game feel
> Does the player feel the event, or merely see that a value changed?

### Performance
> Do I know this is a bottleneck, or am I guessing?

### Refactor
> Will this make the requested feature and future work simpler?

### Scope
> Is this adjacent change helping the task, or distracting from it?

### Blob identity
> Does this still feel like the same living Blob visiting a different arcade ride?

## 42. Final principle

BLOB ARCADE should not become conservative because agents are involved.

The architecture exists to support experimentation, not prevent it.

Protect:
- gameplay truth;
- readability;
- determinism;
- shared contracts;
- performance;
- maintainability.

Inside those boundaries:

> **Push the feel.**

Use animation, sound, camera, procedural motion, environment reactions, visual cheats and technical creativity to make simple arcade mechanics feel disproportionately alive.

The best implementation is not necessarily the one with the fewest changes.

It is the one that makes the game better **without making the project worse**.
