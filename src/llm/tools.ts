/**
 * The `devperf_report` custom tool, built in-process with `defineTool`
 * (pi's tool definition) instead of a generated plugin source file.
 * `buildReportTool` derives the tool's parameter schema from the
 * shared report schema (`llmToolPayloadSchema`) — the JSON Schema
 * `z.toJSONSchema` produces is mapped onto a TypeBox schema (the
 * `Type.Create` converter does not exist in typebox 1.x, so the
 * mapping is hand-written over the small schema subset the report
 * uses). The tool's `execute` zod-validates the model's arguments and
 * writes the validated payload to `<llmDir>/<reportId>.json` — the
 * orchestrator maps sessions to users, so the tool never needs to know
 * the analyzed user's key.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import { z } from 'zod';
import { llmToolPayloadSchema } from '../report/index.js';

/** The `devperf_report` tool name, as seen by the model and the session events. */
export const REPORT_TOOL_NAME = 'devperf_report';

/** Model-facing description of the `devperf_report` tool. */
const TOOL_DESCRIPTION =
  "Reports the final dev-perf analysis for the user analyzed in this session: an optional overview and the user's changes split into distinct contributions (one feature, one bug fix, one refactor, and so on). Call this tool with the complete analysis before finishing the session; no other output format is accepted.";

/**
 * The subset of JSON Schema shapes the report schema uses; anything
 * else makes the mapper fail fast.
 */
interface ToolJsonShape {
  /** JSON Schema type keyword. */
  type?: string;
  /** Description from a `.describe()` call, if any. */
  description?: string;
  /** Enum values for string schemas. */
  enum?: string[];
  /** Named properties for object schemas. */
  properties?: Record<string, ToolJsonShape>;
  /** Names of the object's required properties. */
  required?: string[];
  /** Item schema for array schemas. */
  items?: ToolJsonShape;
}

/**
 * Maps one JSON Schema shape onto a TypeBox schema, mirroring
 * `z.toJSONSchema(llmToolPayloadSchema)`: objects, arrays, string
 * enums, and the scalar types. A property is optional when its name is
 * missing from the enclosing object's `required` list; descriptions are
 * attached where present so the model sees every field's meaning.
 *
 * @param shape - The JSON Schema shape to map.
 * @returns The TypeBox schema.
 * @throws {Error} For shapes outside the supported subset.
 */
function toToolSchema(shape: ToolJsonShape): TSchema {
  let schema: TSchema;
  if (shape.type === 'object') {
    const required = shape.required ?? [];
    const properties: Record<string, TSchema> = {};
    for (const [name, property] of Object.entries(shape.properties ?? {})) {
      const propertySchema = toToolSchema(property);
      properties[name] = required.includes(name) ? propertySchema : Type.Optional(propertySchema);
    }
    schema = Type.Object(properties);
  } else if (shape.type === 'array') {
    if (shape.items === undefined) {
      throw new Error('array schema without items');
    }
    schema = Type.Array(toToolSchema(shape.items));
  } else if (shape.enum !== undefined) {
    schema = Type.Union(shape.enum.map((value) => Type.Literal(value)));
  } else if (shape.type === 'string') {
    schema = Type.String();
  } else if (shape.type === 'integer') {
    schema = Type.Integer();
  } else if (shape.type === 'number') {
    schema = Type.Number();
  } else if (shape.type === 'boolean') {
    schema = Type.Boolean();
  } else {
    throw new Error(`unsupported tool schema shape: ${JSON.stringify(shape.type)}`);
  }
  return withDescription(schema, shape.description);
}

/**
 * Attaches a description to a TypeBox schema when present. TypeBox
 * schemas are plain JSON-schema objects, so a description is added by
 * spread without altering validation.
 *
 * @param schema - The TypeBox schema.
 * @param description - The description, if any.
 * @returns The schema with the description attached.
 */
function withDescription<T extends TSchema>(schema: T, description: string | undefined): T {
  return description === undefined ? schema : ({ ...schema, description } as T);
}

/**
 * The report file path of one session inside the entry's `llm/`
 * directory — free of the report service's `sessionReportPath` helper
 * so the tool never imports from the session layer.
 *
 * @param llmDir - The cache entry's `llm/` directory.
 * @param reportId - The dev-perf-generated report/session id.
 * @returns The report file path.
 */
function reportPath(llmDir: string, reportId: string): string {
  return path.join(llmDir, `${reportId}.json`);
}

/**
 * Builds the `devperf_report` custom tool for one session. Its
 * parameter schema mirrors `llmToolPayloadSchema` (the tool argument
 * is the whole payload object), and `execute` zod-validates the
 * model's arguments before writing the validated payload to
 * `<llmDir>/<reportId>.json`. Invalid payloads are returned to the
 * model as an error text, never written.
 *
 * @param reportId - The dev-perf-generated report/session id; names
 * the output file.
 * @param llmDir - Absolute path of the `<cache>/<hash>/llm/` directory
 * the tool writes its report files to.
 * @returns The `devperf_report` tool definition.
 */
export function buildReportTool(reportId: string, llmDir: string) {
  const parameters = toToolSchema(z.toJSONSchema(llmToolPayloadSchema) as ToolJsonShape);
  return defineTool({
    name: REPORT_TOOL_NAME,
    label: 'dev-perf analysis report',
    description: TOOL_DESCRIPTION,
    parameters,
    async execute(_toolCallId, args) {
      const parsed = llmToolPayloadSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text',
              text: `${REPORT_TOOL_NAME}: invalid analysis payload: ${parsed.error.message}`,
            },
          ],
          details: {},
        };
      }
      try {
        await mkdir(llmDir, { recursive: true });
        await writeFile(
          reportPath(llmDir, reportId),
          `${JSON.stringify(parsed.data, null, 2)}\n`,
          'utf8',
        );
      } catch (error) {
        // A filesystem failure (unwritable cache dir, disk full) must
        // degrade to a model-visible error instead of aborting the
        // session: the orchestrator's tool-start handler writes the
        // report file as well, so this write is a best-effort fallback.
        return {
          content: [
            {
              type: 'text',
              text: `${REPORT_TOOL_NAME}: failed to write report: ${String(error)}`,
            },
          ],
          details: {},
        };
      }
      return { content: [{ type: 'text', text: 'ok' }], details: {} };
    },
  });
}
