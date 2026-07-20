import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as z from "zod/v4";

import { normalizeToolFailure, type ToolFailure } from "./errors.ts";

type TextRenderer<T> = string | ((value: T) => string);

export function createSuccess<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  value: unknown,
  render: TextRenderer<T>,
): CallToolResult {
  const parsed = schema.parse(value);
  const text = typeof render === "function" ? render(parsed) : render;

  return {
    content: [{ type: "text", text }],
    structuredContent: { ...parsed },
  };
}

export function createToolError(error: ToolFailure | unknown): CallToolResult {
  const failure = normalizeToolFailure(error);
  return {
    content: [{ type: "text", text: `${failure.code}: ${failure.message}` }],
    isError: true,
  };
}

export interface CappedText {
  value: string;
  truncated: boolean;
  warnings: string[];
}

export function capText(value: string, maximum: number, warning: string): CappedText {
  if (!Number.isInteger(maximum) || maximum < 0) {
    throw new RangeError("Text cap must be a non-negative integer.");
  }
  const characters = [...value];
  if (characters.length <= maximum) return { value, truncated: false, warnings: [] };
  return {
    value: characters.slice(0, maximum).join(""),
    truncated: true,
    warnings: [warning],
  };
}

export interface CappedArray<T> {
  value: T[];
  total: number;
  truncated: boolean;
  warnings: string[];
}

export function capArray<T>(
  value: readonly T[],
  maximum: number,
  warning: string,
): CappedArray<T> {
  if (!Number.isInteger(maximum) || maximum < 0) {
    throw new RangeError("Array cap must be a non-negative integer.");
  }
  if (value.length <= maximum) {
    return { value: [...value], total: value.length, truncated: false, warnings: [] };
  }
  return {
    value: value.slice(0, maximum),
    total: value.length,
    truncated: true,
    warnings: [warning],
  };
}
