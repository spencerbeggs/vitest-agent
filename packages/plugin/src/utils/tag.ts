import type { TestTagDefinition } from "@vitest/runner";

export type TagOptions = Omit<TestTagDefinition, "name">;

const RESERVED = new Set(["and", "or", "not"]);
// Vitest tag-filter expression syntax disallows these characters in tag names.
const FORBIDDEN_CHAR = /[()&|!*\s]/;

function validateTagName(name: string): void {
	if (!name) throw new Error("Tag name is empty");
	if (RESERVED.has(name)) throw new Error(`Tag name "${name}" is reserved (and/or/not)`);
	if (FORBIDDEN_CHAR.test(name)) {
		throw new Error(`Tag name "${name}" contains an invalid character (no spaces, ()&|!*)`);
	}
}

export class Tag {
	readonly name: string;
	readonly definition: TestTagDefinition;

	private constructor(name: string, options: TagOptions) {
		this.name = name;
		this.definition = { name, ...options };
	}

	static make(name: string, options: TagOptions = {}): Tag {
		validateTagName(name);
		return new Tag(name, options);
	}
}
