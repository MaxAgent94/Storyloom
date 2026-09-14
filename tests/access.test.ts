import test from "node:test";
import assert from "node:assert/strict";
import { accessResult, RequestError } from "../lib/server.ts";

test("access check distinguishes an unauthorized account from a failed query", () => {
  assert.throws(
    () => accessResult(null, null, "example.supabase.co"),
    (error: unknown) =>
      error instanceof RequestError &&
      error.code === "ACCESS_DENIED" &&
      error.status === 403,
  );

  assert.throws(
    () =>
      accessResult(
        null,
        { code: "42501", message: "permission denied for table allowed_users" },
        "example.supabase.co",
      ),
    (error: unknown) =>
      error instanceof RequestError &&
      error.code === "ACCESS_CHECK_FAILED" &&
      error.status === 503 &&
      error.message.includes("42501"),
  );

  assert.doesNotThrow(() =>
    accessResult(
      { user_id: "1b2e2215-6aa7-4c2b-b555-04f9b007adb3" },
      null,
      "example.supabase.co",
    ),
  );
});
