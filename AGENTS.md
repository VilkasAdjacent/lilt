# Agent notes

This repo is a personal voice-training app ("Lilt", a static GitHub Pages site in `app/`) plus its analysis tooling. The repo is **public**.

## Docs

- **Context, intake, plan and open items:** start with `research/HANDOFF.md`. It's local only (gitignored). If it's missing, ask the user. Don't reconstruct personal context from guesses.
- **Evidence:** `research/targets.md`, `top_changes.md`, `library_comparison.md`, `sources.md` and `prediction.md`, also local only.
- **Design doc:** a Claude Doc, linked from `research/HANDOFF.md`.
- **App internals:** `app/README.md`. Test tolerances and actual results: `app/test/README.md`.

## Privacy

- **Never commit** audio, `recordings/` (except `RECORDING_SCRIPT.md`), `research/`, `analysis/results/`, `analysis/cache/` or bench tracks. `.gitignore` enforces this; don't weaken it.
- **Committed files stay free of personal details:** no health or intake details in code, comments, commit messages or these notes.
- **Pages publishes only** `app/index.html`, `app/src/` and `app/vendor/`, via `.github/workflows/pages.yml`. Never switch it to "deploy from a branch".

## Habits

- Parse, don't verify.
- Aim for correct-by-construction.
- Prefer the simplest correct design.
- No narrative or contractual comments. Comments are for "why" 95%+ of the time; use descriptive variable names instead.
- Use red-green style workflows.
- Use the language to its maximum potential.
- Avoid unnecessary abstractions.
- Compose and reuse functions instead of duplicating code.
- Prefer recursion, functional composition and array methods (`map`/`filter`/`reduce`) over manual for loops and building collections element by element. DSP inner loops over typed arrays are the exception.
- **Tests are a budget, not a goal.** Write a test only where a silent regression would be expensive, or where the behaviour is subtle enough that a plausible edit could break it without anyone noticing. Here that means DSP accuracy against synthetic truth, smoothing and windowing maths, and settings migration. Don't test glue. When a test misses its tolerance, report the actual error; don't loosen the tolerance silently.

## App

- **No build step.** Plain ES modules, with vendored dependencies in `app/vendor/`. No SharedArrayBuffer and no COOP/COEP.
- **Analysis plug-ins** live in `app/src/analysis/index.js`. Defaults: `pitchy` (clarity ≥ 0.8), **`lpc12`** formants, and `h1h2` weight. `lpc10` is experimental. Settings follow `defaultChoice` unless the user picked engines by hand.
- **Analysis runs in a module Worker,** falling back to the main thread. The Live view shows 1 s rolling medians (`src/ui/smoothing.js`) plus a 10 s pitch average.
- **Targets:** Firefox and Chrome on Android (Pixel 7), and desktop Firefox. iOS Safari is secondary.
- **Tone:** low-pressure and kind. No streaks, and keep the vocal-safety nudges.

## Analysis

- **Re-running:** `analysis/.venv/Scripts/python.exe analysis/run.py recordings/<dir>`, then `compare.py` / `targets.py`.
- **VS Code:** the workspace disables venv auto-activation in terminals (`.vscode/settings.json`), because auto-activation interrupted background agents before.

## Scratch

A gitignored `.agent_scratch/` directory sits at the root of the repo. If you expect to do lots of operations in a directory outside the repo, do them in there instead.

## Context

You may be sandboxed. If you are, don't download toolchains just to verify code. `cd app && npm test` (Node) and the existing `analysis/.venv` are fine to use.
