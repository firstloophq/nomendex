-- Drop durable op-log table (snapshot-only persistence).
DROP TABLE IF EXISTS "collab_ops";

-- Collab docs now track snapshot metadata directly.
ALTER TABLE "collab_docs"
  DROP COLUMN IF EXISTS "last_snapshot_seq",
  ADD COLUMN IF NOT EXISTS "snapshot_version" TEXT,
  ADD COLUMN IF NOT EXISTS "state_vector_json" TEXT;

-- Snapshot rows no longer use op-seq checkpoints.
ALTER TABLE "collab_snapshots"
  DROP COLUMN IF EXISTS "base_seq",
  ADD COLUMN IF NOT EXISTS "snapshot_version" TEXT,
  ADD COLUMN IF NOT EXISTS "state_vector_json" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Keep exactly one latest snapshot row per doc.
CREATE UNIQUE INDEX IF NOT EXISTS "collab_snapshots_collab_doc_id_key"
  ON "collab_snapshots"("collab_doc_id");
