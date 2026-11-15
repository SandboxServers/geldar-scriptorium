import type { AnySchema, ValidateFunction } from 'ajv';
import ajv2020 from 'ajv/dist/2020.js';
import type { Tool } from './types.ts';

/** The longest schema error kept in a corrective answer. */
const MESSAGE_MAX = 300;

/** The 2020-12 validator class: ajv is CommonJS, so its default export sits on the module object. */
const Ajv2020 = ajv2020.default;

/**
 * Compiles every tool's parameter schema once for a round. The returned check gives null when the
 * arguments are valid and otherwise the first error as one short line. A schema that does not compile
 * is the world's problem, not the kit's: that tool is checked only for being an object (always true
 * here, the loop has parsed the arguments already).
 */
export function compileTools(
  tools: Tool[],
): (name: string, args: Record<string, unknown>) => string | null {
  // A fresh Ajv per round, so schemas that share an $id cannot collide across rounds.
  const ajv = new Ajv2020({ allErrors: false, strict: false });
  const checks = new Map<string, ValidateFunction | null>();
  for (const tool of tools) checks.set(tool.name, compile(ajv, tool.parameters));
  return (name, args) => {
    // Unknown names are refused by the loop before the check runs.
    const validate = checks.get(name);
    if (!validate || validate(args)) return null;
    const error = validate.errors?.[0];
    return `${error?.instancePath || 'arguments'} ${error?.message ?? 'is not valid'}`.slice(
      0,
      MESSAGE_MAX,
    );
  };
}

/** The compiled schema, or null when the schema does not compile. */
function compile(
  ajv: { compile(schema: AnySchema): ValidateFunction },
  schema: Record<string, unknown>,
): ValidateFunction | null {
  try {
    return ajv.compile(schema as AnySchema);
  } catch {
    return null;
  }
}
