-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "installation_id" INTEGER NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "account_avatar_url" TEXT,
    "installed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_workspaces" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "gh_installation_id" TEXT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_installation_id_key" ON "github_installations"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_workspaces_org_id_repo_full_name_key" ON "org_workspaces"("org_id", "repo_full_name");

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_installed_by_id_fkey" FOREIGN KEY ("installed_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_workspaces" ADD CONSTRAINT "org_workspaces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_workspaces" ADD CONSTRAINT "org_workspaces_gh_installation_id_fkey" FOREIGN KEY ("gh_installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
