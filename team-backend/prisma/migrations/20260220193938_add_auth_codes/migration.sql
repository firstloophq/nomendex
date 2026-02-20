-- CreateTable
CREATE TABLE "auth_codes" (
    "code" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "clerk_session_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "auth_codes_pkey" PRIMARY KEY ("code")
);
