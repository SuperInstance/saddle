# Night Cycles

> The kennel after dark. What the corpus teaches while the cowboy sleeps.

---

## ✦ What a night cycle is

A scheduled pass over everything the fleet's cells have written in their books.
During the day, cells act and log — debit in, credit out, verdict, maybe an
escalation. At night, the harness walks the whole ledger and decides:

- **Which alignments earned their keep** (keep ratio per frozen state)
- **Which cells escalated** and need cowboy attention at sunrise
- **What the corpus is ready to teach** (enough worked examples of X? train.)
- **Which workflows are too fat** and should decompose into smaller cells

Today saddle ships the **stub runner** (`src/nightcycle.ts`): it streams the
ledger and emits the earned-keep report. That report is the input every future
pass consumes. The passes below are **contracts, not code** — deliberately.

## ✦ Pass contracts

### (a) Sim / shadow training pass — the Isaac drills

```
for each frozen alignment A with enough entries:
    for each recorded debit D where verdict == "worked":        # stream
        shadow-run A against D (no live side effects)
        score shadow credit vs recorded credit
    emit drift report: where has the dog drifted from its old self?
```

- **Input:** ledger (streamed), frozens (read-only)
- **Output:** drift report per alignment; candidate thaw list
- **Rules:** shadow runs never touch production; memory O(batch of drills);
  checkpoint after every N drills so a crashed night resumes, not restarts.

### (b) Corpus crunch — LoRA / micro-model training pass

```
for each cell C whose ledger shows stable verdicts:             # stream
    shard worked entries → positive examples
    shard failed entries → negative examples
    emit training shards (JSONL) for the trainer job (external)
```

- **Input:** ledger (streamed); **Output:** per-cell training shards + manifest
- **Rules:** saddle NEVER trains — it prepares data and hands it to an external
  trainer under the fleet's critical-path rules (list-form subprocess,
  checkpointed, systemd-supervised). Chunked reads, bounded memory, no
  corpus-in-RAM ever.

### (c) Cell decomposition pass

```
for each cell C:                                               # stream
    if verdict variance inside C is high (mixed responsibilities):
        propose split: C → C.subA, C.subB (each with focused frozen state)
    write proposal to report; cowboy approves at sunrise
```

- **Input:** ledger (streamed); **Output:** split proposals
- **Doctrine:** more processing in the *network of cells*, less inside the
  intra-model black-box. Small cells mean granular adjustments — you retrain a
  paw, not the whole dog.

## ✦ Scheduling

Cron-able today (see [ARCHITECTURE.md](ARCHITECTURE.md#-night-cycle-scheduler-design-cron-able)
for the crontab and systemd timer). The runner is a pure function:
`(ledger, frozens) → report`. Deployed passes follow fleet rules: systemd
timers with `MemoryMax`, `Restart=always`, ext4 scratch, no `/mnt/c`.

## ✦ Escalation policy (what happens to escalated entries)

1. Nightcycle collects every entry with `escalated: true` into the sunrise
   report's **attention list**.
2. The cowboy (human or harness agent) resolves each: thaw/refreeze alignment,
   split the cell, mark verdict as bad data, or dismiss.
3. Resolution is itself logged — the ledger keeps books on the cowboy too.

## ✦ Non-goals

- No training code in this repo, ever — contracts only.
- No live side effects from shadow passes.
- No whole-corpus reads. If a pass wants O(corpus) memory, the pass is wrong.
