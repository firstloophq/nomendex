# Issue: Residual List Divergence After ProseMirror Step-Capture Fix

- Date: 2026-02-19
- Branch: `jake/nomendex-team-homemadecrdt`
- Scope: `@crdt/lib` ProseMirror mapping/capture
- Status: Reproduced after applying the `instanceof`-mismatch fix

## What Improved
The prior critical bug (no local ops captured) appears fixed.

In the latest trace we now see full op flow:
- `local_ops_captured` present
- `send_ops` present
- `transport_on_ops` present
- `remote_ops_received` + `remote_ops_applied` present

## Remaining Problem
Document content is **mostly** synced, but list structure still diverges between peers.

Observed UI symptom (from latest screenshot):
- One client shows ordered list items (`1.`, `2.`)
- Other client shows bullet list items for corresponding content

## Key Log Evidence
Logs pulled from:
`GET /api/logs/recent?limit=1800&contains=CRDT:`

### Session A (bootstrap-origin)
Session: `dbg-1771471974415-xfh2bq` (03:32:54.416Z -> 03:33:13.942Z)
- `sync_complete`: 1
- `bootstrap_dispatched`: 1
- `local_ops_captured`: 1 event with **count=91**
- That bootstrap batch is mostly `insert` ops (+ 1 `delete`), includes list blocks in summary (`bullet_list`, `list_item`)
- Then receives 43 remote `insert` ops and applies them

### Session B (active typing)
Session: `dbg-1771471977979-k6czt8` (03:32:57.983Z -> 03:33:08.288Z)
- `bootstrap_skip`: 1
- `editor_keydown`: 47
- `pm_dispatch`: 43 (all `ReplaceStep4`)
- `local_ops_captured`: 43
- `local_ops_sent`: 43
- `send_ops`: 43
- `opTypeFreq`: only `insert` (45 inserts total because Enter emitted 2-op batches)

### Notable signal
- During this typing run, structural ops (`reparent`, `attr_update`, `format`, `delete` except bootstrap) are not observed.
- Remote side applies inserts, but final list type still diverges.

## Interpretation
High confidence that we have a **round-trip structural mismatch** in list handling:

1. Bootstrap client keeps its local PM view (markdown-parse origin) while other clients rebuild from CRDT via `crdtToProseMirror`.
2. If PM->CRDT->PM mapping is not identity for list structures/attrs, clients can become structurally non-equivalent while text stays similar.
3. Subsequent character inserts continue to sync, but on top of slightly different structures (visible as ordered-vs-bullet divergence).

Related clue: historical requirements doc already flagged list/nesting/table mapping gaps.

## Suspected Root Causes (CRDT library)
1. **List structure/attrs are not fully preserved** across PM->CRDT->PM.
2. **ReplaceStep-only handling is too text-centric** for certain list transitions; some structure-changing semantics may still be underrepresented.
3. **Bootstrap path may create canonicalization asymmetry**: origin client not forced through same CRDT->PM reconstruction as followers.

## Requests to CRDT Team
1. Add/verify a strict identity test:
   - Start with PM doc containing bullet + ordered lists (nested list_items)
   - Run PM -> ops -> CRDT -> PM
   - Assert structural equality (node types + attrs), not just text.

2. Add collaborative two-client list test:
   - Client A bootstraps from markdown
   - Client B joins from sync
   - Edit near list boundaries (Enter, backspace, continue list, convert list type)
   - Assert both PM trees remain equivalent.

3. Confirm list-specific attrs and semantics survive conversion:
   - `ordered_list.order`
   - list node boundaries and parent relationships

4. Consider canonical bootstrap behavior:
   - After bootstrap on origin client, rebuild from CRDT canonical state (or apply own ops as remote canonicalization) so both peers converge on same representation.

## Local App Workaround (optional, short-term)
After bootstrap send, force a local canonicalization pass (re-subscribe/apply snapshot/rebuild from CRDT state) on the origin client so both peers render through identical path.

## Related Context
- `instanceof` capture fix is applied and working for op emission.
- This issue is the next layer: structural fidelity of list representation and canonicalization.
