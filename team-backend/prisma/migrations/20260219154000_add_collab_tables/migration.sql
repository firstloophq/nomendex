-- CreateTable
CREATE TABLE "collab_docs" (
    "id" TEXT NOT NULL,
    "org_workspace_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "last_snapshot_seq" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_ops" (
    "seq" BIGSERIAL NOT NULL,
    "collab_doc_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "op_json" TEXT NOT NULL,
    "source_client_id" TEXT,
    "source_clock" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_ops_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "collab_snapshots" (
    "id" TEXT NOT NULL,
    "collab_doc_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "etag" TEXT,
    "base_seq" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collab_docs_doc_id_key" ON "collab_docs"("doc_id");

-- CreateIndex
CREATE INDEX "collab_docs_org_workspace_id_idx" ON "collab_docs"("org_workspace_id");

-- CreateIndex
CREATE INDEX "collab_ops_collab_doc_id_seq_idx" ON "collab_ops"("collab_doc_id", "seq");

-- CreateIndex
CREATE INDEX "collab_ops_doc_id_idx" ON "collab_ops"("doc_id");

-- CreateIndex
CREATE INDEX "collab_snapshots_collab_doc_id_created_at_idx" ON "collab_snapshots"("collab_doc_id", "created_at");

-- CreateIndex
CREATE INDEX "collab_snapshots_doc_id_idx" ON "collab_snapshots"("doc_id");

-- AddForeignKey
ALTER TABLE "collab_docs" ADD CONSTRAINT "collab_docs_org_workspace_id_fkey" FOREIGN KEY ("org_workspace_id") REFERENCES "org_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_ops" ADD CONSTRAINT "collab_ops_collab_doc_id_fkey" FOREIGN KEY ("collab_doc_id") REFERENCES "collab_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_snapshots" ADD CONSTRAINT "collab_snapshots_collab_doc_id_fkey" FOREIGN KEY ("collab_doc_id") REFERENCES "collab_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
