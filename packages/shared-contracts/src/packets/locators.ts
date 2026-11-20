import { z } from "zod/v4";
import {
  boundedString,
  idSchema,
  nonNegativeIntSchema,
  NOTE_MAX_CHARS,
  PATH_MAX_CHARS,
  positiveIntSchema,
} from "./bounds.js";

const regionSchema = z
  .tuple([
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().positive(),
    z.number().positive(),
  ])
  .refine(([x, y, w, h]) => x >= 0 && y >= 0 && w > 0 && h > 0, {
    message: "region must be [x, y, w, h] with nonnegative origin and positive dimensions",
  });

const jsonPointerSchema = z.string().max(PATH_MAX_CHARS).regex(/^(?:\/(?:[^~/]|~0|~1)*)*$/, {
  message: "jsonPointer must be an RFC 6901 JSON pointer",
});

export const TurnLocatorSchema = z
  .object({
    kind: z.literal("turn"),
    turnId: idSchema,
    start: nonNegativeIntSchema,
    end: nonNegativeIntSchema,
  })
  .strict()
  .refine((locator) => locator.end >= locator.start, {
    message: "end must be >= start",
    path: ["end"],
  });

export const PdfLocatorSchema = z
  .object({
    kind: z.literal("pdf"),
    page: positiveIntSchema,
    charStart: nonNegativeIntSchema,
    charEnd: nonNegativeIntSchema,
    bbox: regionSchema.optional(),
  })
  .strict()
  .refine((locator) => locator.charEnd >= locator.charStart, {
    message: "charEnd must be >= charStart",
    path: ["charEnd"],
  });

/** Snake_case shape published in external-intake.md. Same span rule as `PdfLocatorSchema`. */
export const PdfIntakeLocatorSchema = z
  .object({
    kind: z.literal("pdf"),
    page: positiveIntSchema,
    char_start: nonNegativeIntSchema,
    char_end: nonNegativeIntSchema,
    bbox: regionSchema.optional(),
  })
  .strict()
  .refine((locator) => locator.char_end >= locator.char_start, {
    message: "char_end must be >= char_start",
    path: ["char_end"],
  });

export const DocxLocatorSchema = z
  .object({
    kind: z.literal("docx"),
    paragraph: positiveIntSchema,
    charStart: nonNegativeIntSchema,
    charEnd: nonNegativeIntSchema,
  })
  .strict()
  .refine((locator) => locator.charEnd >= locator.charStart, {
    message: "charEnd must be >= charStart",
    path: ["charEnd"],
  });

export const TextLocatorSchema = z
  .object({
    kind: z.literal("text"),
    lineStart: positiveIntSchema,
    lineEnd: positiveIntSchema,
    charStart: nonNegativeIntSchema,
    charEnd: nonNegativeIntSchema,
  })
  .strict()
  .refine(
    (locator) => locator.lineEnd >= locator.lineStart && locator.charEnd >= locator.charStart,
    { message: "lineEnd and charEnd must not precede their starts" },
  );

export const ImageLocatorSchema = z
  .object({
    kind: z.literal("image"),
    region: regionSchema,
    ocrText: boundedString(NOTE_MAX_CHARS).optional(),
  })
  .strict();

export const SpecLocatorSchema = z
  .object({
    kind: z.literal("spec"),
    jsonPointer: jsonPointerSchema,
  })
  .strict();

const EvidenceLocatorDiscriminatedSchema = z.discriminatedUnion("kind", [
  TurnLocatorSchema,
  PdfLocatorSchema,
  DocxLocatorSchema,
  TextLocatorSchema,
  ImageLocatorSchema,
  SpecLocatorSchema,
]);

/**
 * Six locator kinds, camelCase as specified, plus the snake_case `pdf` object
 * copied in external-intake.md. CamelCase kinds stay a discriminated union;
 * the intake example is an additional closed arm so that sample parses unchanged.
 */
export const EvidenceLocatorSchema = z.union([
  EvidenceLocatorDiscriminatedSchema,
  PdfIntakeLocatorSchema,
]);

export type TurnLocator = z.infer<typeof TurnLocatorSchema>;
export type PdfLocator = z.infer<typeof PdfLocatorSchema>;
export type DocxLocator = z.infer<typeof DocxLocatorSchema>;
export type TextLocator = z.infer<typeof TextLocatorSchema>;
export type ImageLocator = z.infer<typeof ImageLocatorSchema>;
export type SpecLocator = z.infer<typeof SpecLocatorSchema>;
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;
