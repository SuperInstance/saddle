# Verifying things

Every rule here is a fault that was actually paid for, most of them in this
repository and several of them in sibling repositories during one week. None is
a style preference. They are written down because each one cost time that a
paragraph would have saved, and because the failure mode they share is the same:
**a claim outran the thing that was supposed to check it, and nothing noticed.**

This file is deliberately portable. Nothing in it is about music.

---

## 1. Success is not evidence

A green result means the check passed. It does not mean the check ran, or that
it was checking what you think.

- **`plainsong spec` printed `no specs found` and exited 0.** The spec files had
  once lived outside the package, so every `pip install` shipped without them.
  Every install, and every CI job running `plainsong spec`, read that zero as a
  pass. The self-verification the whole design leans on was doing nothing —
  loudly enough to print a warning, quietly enough that no exit status moved.
  It exits 1 now.

- **A sibling's CI suppresses its own build.** `make lib || echo "...syntax
  check only"` and `nvcc -fsyntax-only ... || true`. That pipeline has never
  failed and has never once demonstrated the code compiles. A step that cannot
  fail is decoration.

- **Six consecutive release runs failed at the same step and nobody read the
  log.** The `test` and `build` jobs passed every time, which made the failure
  easy to keep mis-reading. A release shipped a fix for the wrong cause,
  confidently, in a changelog. The actual error had been printed in full, six
  times: `invalid-publisher`.

**The rule:** when something reports success, ask what specific observation
would have made it report failure. If you cannot name one, you have not
verified anything.

## 2. A guard you cannot fail is not a guard

Write the check, then **break the thing on purpose and confirm the check goes
red.** If the suite stays green, the check is decoration and you have learned
that before relying on it, which is the only good time to learn it.

- Two guards in `TimeGrid` — a rounding step and an epsilon nudge — did the same
  job. No mutation could fail a test, because either one alone was sufficient.
  Collapsing to the nudge alone produced a guard that *did* fail when removed.

- Reordering a single addition in `coordinate.solve_one` — same terms, same
  mathematical value, different floating-point association — fails **1,803** of
  ~4,000 equivalence cases. That is what makes the extraction proof real rather
  than a reading exercise.

- Replacing a re-export with a local shim that forwards to the same function —
  behaviourally identical on every input — turns the sibling's suite red,
  because the test asserts *identity*, not equality. That catches a second
  implementation appearing before the two have had any chance to disagree.

**The rule:** an assertion you have never seen fail is a hypothesis.

## 3. Two copies drift into the same bug

Not into different bugs — the same one, because the second copy was a copy.

The loopback check lived twice. Both copies accepted `127.evil.example`
(a registrable domain that can be pointed at 127.0.0.1 — precisely the attack
the check exists to stop) and both mangled `[::1]` into `":"`, refusing a real
local caller. One fix, applied once, would have fixed neither.

A 300-line analysis module was byte-identical across two repositories. A
security fix existed in one copy and not the other for months, in the copy
people `pip install`.

**The rule:** when you are about to copy a definition, don't. If you must, add
a test that fails when the copies diverge — an identity assertion where the
languages allow it, a differential test where they do not.

## 4. Verify by doing, not by asking

The thing that tells you about the world is often not the world.

- **PyPI's JSON API reported an older version than `pip` then resolved** — twice
  in one week. `pip install` into a clean environment is the answer; the API is
  a rumour.

- **A test suite with the repository on `sys.path` is structurally blind to
  packaging.** The "no specs found" bug above lived through an entire release
  with a fully green suite, because the tests never met the artifact anyone
  installs. `tools/verify_release.py` builds a wheel, installs it into a
  throwaway virtualenv *outside the source tree*, and drives the console script
  from `/tmp` with `PYTHONPATH` stripped.

- **setuptools reuses whatever is already in `build/lib`.** A data file that has
  stopped being packaged still reaches the wheel from the last build that
  included it, so a broken package verifies perfectly. Clear `build/` and
  `*.egg-info` before any build you intend to trust. This was found by breaking
  the packaging deliberately and watching the check pass anyway.

- **A pipe eats the exit code.** `some_command | tail` reports `tail`'s status.
  A verification run reported exit 0 while printing two failures. Redirect to a
  file and read `$?`, or check `PIPESTATUS`.

**The rule:** verify the artifact people receive, in the environment they
receive it in.

## 5. A name is not a description, and a README is not a fact

- A repository called `magda-tensor` contains no tensors; it is a DAW fork.
- A repository's own audit graded its README **F**, listing three headline
  claims as false or unsupported, and concluded: *"treat the README as
  advertising copy, not technical fact."* The README was unchanged.
- A file named `bridge.rs` was markdown prose pasted into a `.rs` file. It would
  not compile and was not in the build.
- A package's `setup.py` declared `license="MIT"` with the OSI classifier over a
  repository containing no LICENSE file at all — the claim shipped in every
  wheel, the grant in none.
- A generated design document proposed three phases of architecture built on a
  library that does not exist, using vocabulary borrowed from an unrelated
  repository that happened to be real.

**The rule:** clone it and grep it. Reasoning about a repository from its name,
its README, or a document describing it is not research. "Not found" is a
valuable answer and should be reported as confidently as a discovery.

## 6. Report what happened

If tests fail, say so with the output. If a step was skipped, say that. When
something is verified, state it plainly with the evidence and without hedging.

Two failures in a verification run turned out to be the harness's own bugs
rather than the product's — an argument written in the wrong position and a JSON
key read at the wrong level. Diagnosing that honestly took ten minutes.
Reporting it as a product defect would have cost considerably more, and
reporting it as success would have cost the most of all.

**The rule:** the point of a check is to change what you believe. A check whose
result you would explain away is not one you are running.
