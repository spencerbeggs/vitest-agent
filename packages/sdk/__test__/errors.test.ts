/**
 * vitest-agent-sdk
 *
 * Tests for Effect Data.TaggedError types.
 */

import { describe, expect, it } from "vitest";
import { DataStoreError, extractSqlReason } from "../src/errors/DataStoreError.js";
import { DiscoveryError } from "../src/errors/DiscoveryError.js";
import {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddTaskAlreadyEndedError,
	TddTaskNotFoundError,
} from "../src/errors/TddErrors.js";

describe("DiscoveryError", () => {
	it("constructs with glob operation", () => {
		const err = new DiscoveryError({ operation: "glob", path: "/project", reason: "pattern invalid" });
		expect(err._tag).toBe("DiscoveryError");
		expect(err.operation).toBe("glob");
		expect(err.path).toBe("/project");
		expect(err.reason).toBe("pattern invalid");
	});

	it("constructs with read operation", () => {
		const err = new DiscoveryError({ operation: "read", path: "/project/src", reason: "ENOENT" });
		expect(err._tag).toBe("DiscoveryError");
		expect(err.operation).toBe("read");
	});

	it("constructs with stat operation", () => {
		const err = new DiscoveryError({ operation: "stat", path: "/project/src/file.ts", reason: "ENOENT" });
		expect(err._tag).toBe("DiscoveryError");
		expect(err.operation).toBe("stat");
	});

	it("is an instance of Error", () => {
		const err = new DiscoveryError({ operation: "glob", path: "/tmp", reason: "fail" });
		expect(err).toBeInstanceOf(Error);
	});

	it("derives a message from operation, path, and reason", () => {
		const err = new DiscoveryError({ operation: "stat", path: "/tmp/file", reason: "ENOENT" });
		expect(err.message).toBe("[stat /tmp/file] ENOENT");
	});
});

describe("DataStoreError", () => {
	it("is a tagged error with correct tag", () => {
		const error = new DataStoreError({
			operation: "write",
			table: "test_runs",
			reason: "SQLITE_CONSTRAINT",
		});
		expect(error._tag).toBe("DataStoreError");
		expect(error.operation).toBe("write");
		expect(error.table).toBe("test_runs");
		expect(error.reason).toBe("SQLITE_CONSTRAINT");
	});

	it("supports read and migrate operations", () => {
		const read = new DataStoreError({ operation: "read", table: "test_cases", reason: "not found" });
		const migrate = new DataStoreError({ operation: "migrate", table: "schema", reason: "failed" });
		expect(read.operation).toBe("read");
		expect(migrate.operation).toBe("migrate");
	});

	it("derives a message from operation, table, and reason", () => {
		const err = new DataStoreError({
			operation: "write",
			table: "test_history",
			reason: "UNIQUE constraint failed: test_history.full_name",
		});
		expect(err.message).toBe("[write test_history] UNIQUE constraint failed: test_history.full_name");
	});

	it("preserves field access on instance", () => {
		const err = new DataStoreError({ operation: "write", table: "files", reason: "disk full" });
		expect(err.operation).toBe("write");
		expect(err.table).toBe("files");
		expect(err.reason).toBe("disk full");
	});
});

describe("extractSqlReason", () => {
	it("returns cause.message for an Effect SqlError-shaped error", () => {
		const err = { message: "Failed to execute statement", cause: { message: "SQLITE_BUSY: database is locked" } };
		expect(extractSqlReason(err)).toBe("SQLITE_BUSY: database is locked");
	});

	it("falls back to message when cause is missing", () => {
		const err = { message: "Failed to execute statement" };
		expect(extractSqlReason(err)).toBe("Failed to execute statement");
	});

	it("returns string cause directly", () => {
		expect(extractSqlReason({ cause: "raw cause string" })).toBe("raw cause string");
	});

	it("falls back to String(e) when nothing useful is available", () => {
		expect(extractSqlReason("plain string")).toBe("plain string");
		expect(extractSqlReason(42)).toBe("42");
		expect(extractSqlReason(null)).toBe("null");
	});

	it("falls back to JSON.stringify when message is empty and no cause", () => {
		const err = { message: "", code: 42 };
		expect(extractSqlReason(err)).toBe('{"message":"","code":42}');
	});

	it("falls back to String(e) when JSON.stringify throws on circular refs", () => {
		const err: { message: string; self?: unknown } = { message: "" };
		err.self = err;
		expect(extractSqlReason(err)).toBe("[object Object]");
	});
});

describe("GoalNotFoundError", () => {
	it("is a tagged error carrying id and reason with derived message", () => {
		const err = new GoalNotFoundError({ id: 7, reason: "session has no goals yet" });
		expect(err._tag).toBe("GoalNotFoundError");
		expect(err.id).toBe(7);
		expect(err.reason).toBe("session has no goals yet");
		expect(err.message).toBe("[goal not_found id=7] session has no goals yet");
		expect(err).toBeInstanceOf(Error);
	});
});

describe("BehaviorNotFoundError", () => {
	it("is a tagged error carrying id and reason with derived message", () => {
		const err = new BehaviorNotFoundError({ id: 12, reason: "behavior was deleted" });
		expect(err._tag).toBe("BehaviorNotFoundError");
		expect(err.id).toBe(12);
		expect(err.reason).toBe("behavior was deleted");
		expect(err.message).toBe("[behavior not_found id=12] behavior was deleted");
		expect(err).toBeInstanceOf(Error);
	});
});

describe("TddTaskNotFoundError", () => {
	it("is a tagged error carrying id and reason with derived message", () => {
		const err = new TddTaskNotFoundError({ id: 3, reason: "no tdd session for this id" });
		expect(err._tag).toBe("TddTaskNotFoundError");
		expect(err.id).toBe(3);
		expect(err.reason).toBe("no tdd session for this id");
		expect(err.message).toBe("[tdd_task not_found id=3] no tdd session for this id");
		expect(err).toBeInstanceOf(Error);
	});
});

describe("TddTaskAlreadyEndedError", () => {
	it("is a tagged error carrying outcome and endedAt with derived message", () => {
		const err = new TddTaskAlreadyEndedError({
			id: 5,
			endedAt: "2026-04-29T00:01:00Z",
			outcome: "succeeded",
		});
		expect(err._tag).toBe("TddTaskAlreadyEndedError");
		expect(err.id).toBe(5);
		expect(err.outcome).toBe("succeeded");
		expect(err.endedAt).toBe("2026-04-29T00:01:00Z");
		expect(err.message).toBe("[tdd_task ended id=5] outcome=succeeded endedAt=2026-04-29T00:01:00Z");
	});

	it("accepts blocked and abandoned outcomes", () => {
		const blocked = new TddTaskAlreadyEndedError({
			id: 5,
			endedAt: "2026-04-29T00:01:00Z",
			outcome: "blocked",
		});
		const abandoned = new TddTaskAlreadyEndedError({
			id: 5,
			endedAt: "2026-04-29T00:01:00Z",
			outcome: "abandoned",
		});
		expect(blocked.outcome).toBe("blocked");
		expect(abandoned.outcome).toBe("abandoned");
	});
});

describe("IllegalStatusTransitionError", () => {
	it("derives a message from entity, id, from→to, and reason", () => {
		const err = new IllegalStatusTransitionError({
			entity: "goal",
			id: 3,
			from: "done",
			to: "pending",
			reason: "cannot revert a completed goal",
		});
		expect(err._tag).toBe("IllegalStatusTransitionError");
		expect(err.entity).toBe("goal");
		expect(err.from).toBe("done");
		expect(err.to).toBe("pending");
		expect(err.message).toBe("[goal illegal_transition id=3] done → pending: cannot revert a completed goal");
	});

	it("supports behavior and session entities", () => {
		const beh = new IllegalStatusTransitionError({
			entity: "behavior",
			id: 12,
			from: "abandoned",
			to: "in_progress",
			reason: "abandoned is terminal",
		});
		const task = new IllegalStatusTransitionError({
			entity: "task",
			id: 5,
			from: "ended",
			to: "in_progress",
			reason: "task already ended",
		});
		expect(beh.entity).toBe("behavior");
		expect(task.entity).toBe("task");
	});
});
