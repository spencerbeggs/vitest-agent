import type { TestTagDefinition } from "@vitest/runner";

/**
 * Options for a `Tag`, mirroring `TestTagDefinition` minus the `name` field.
 * @public
 */
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

/**
 * A validated Vitest tag with its `name` string and a `TestTagDefinition` for registration.
 * @public
 */
export class Tag {
	/** The tag name string (validated on construction). */
	readonly name: string;
	/** The full `TestTagDefinition` object to pass to Vitest's `test.tags` config. */
	readonly definition: TestTagDefinition;

	private constructor(name: string, options: TagOptions) {
		this.name = name;
		this.definition = { name, ...options };
	}

	/**
	 * Create a validated `Tag`.
	 * @param name - Tag identifier; must not be empty, reserved, or contain forbidden characters
	 * @param options - Optional timeout, retry, and other Vitest tag settings
	 * @returns A new `Tag` instance
	 */
	static make(name: string, options: TagOptions = {}): Tag {
		validateTagName(name);
		return new Tag(name, options);
	}
}
