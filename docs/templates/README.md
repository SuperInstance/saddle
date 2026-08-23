# Rider Templates — the tack room's labeled stubs

One frozen-state **TEMPLATE STUB** per rider archetype in
[RIDER-TAXONOMY](../RIDER-TAXONOMY.md).

**These are NOT frozen states.** They are drafts wearing their doctrine as a
`$comment` annotation. Honest labeling, following the repo's
[REAL]/[CONTRACT] convention:

- Each file is shaped like an `AlignmentDraft` (see `src/frozens.ts`):
  `id`, `model`, `useCase`, `prompt`, `inputFilters`, `outputFilters`,
  `params`, `directiveChunks`.
- Each carries a top-level `"$comment"` block — the doctrine annotation
  (the rider, the horse, the tack that defines them, the fleet equivalent).
  **`$comment` is NOT part of the AlignmentDraft schema.** Strip it before
  freezing:

  ```bash
  jq 'del(.$comment)' rider-jockey.template.json > /tmp/draft.json
  # then freeze from your own harness code:
  #   freeze(dir, JSON.parse(fs.readFileSync('/tmp/draft.json','utf8')))
  ```

- `model` values are the *class* of horse, named for the current string
  (GLM-5.3, GLM-5-turbo, DeepSeek V4-Flash, Nemotron-Content-Safety-3.5,
  Wesley/Granite-3.1-2B, Liquid-LFM2.5-2.6B, ...). When the string changes,
  thaw-edit-refreeze — never edit a frozen state.
- The 8 **seed rungs** (Casey's list) plus 6 named extensions = 14 stubs.
  The gate stays open: `use-case dependent — the thousand others`.

| Template | Rider | Status |
|---|---|---|
| `rider-jockey.template.json` | race lane, <50ms | [TEMPLATE STUB] |
| `rider-rancher.template.json` | daily driver, long-horizon | [TEMPLATE STUB] |
| `rider-general-cavalry.template.json` | chain of command | [TEMPLATE STUB] |
| `rider-mounted-police.template.json` | public safety, fail-closed | [TEMPLATE STUB] |
| `rider-pony-express.template.json` | relay handoffs | [TEMPLATE STUB] |
| `rider-mule-packer.template.json` | bulk freight | [TEMPLATE STUB] |
| `rider-kids-pony.template.json` | school lane, sandboxed | [TEMPLATE STUB] |
| `rider-cabbie.template.json` | passenger UX | [TEMPLATE STUB] |
| `rider-endurance.template.json` | all-night loops | [TEMPLATE STUB] |
| `rider-dragoon.template.json` | edge, rides-then-dismounts | [TEMPLATE STUB] |
| `rider-trick-rider.template.json` | exhibition, golden ticket | [TEMPLATE STUB] |
| `rider-polo-player.template.json` | multi-model banter | [TEMPLATE STUB] |
| `rider-fox-hunter.template.json` | scent/retrieval | [TEMPLATE STUB] |
| `rider-stagecoach-shotgun.template.json` | paired driver + veto | [TEMPLATE STUB] |

The doctrine lives in [RIDER-TAXONOMY](../RIDER-TAXONOMY.md); the freeze
semantics live in [src/frozens.ts](../../src/frozens.ts) — content-addressed,
0444, hash-verified, never edited. Thaw. Edit. Freeze a new one.
