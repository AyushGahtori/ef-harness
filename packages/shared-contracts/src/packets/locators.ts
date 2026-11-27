import { z } from "zod";
import {
  boundedString,
  idSchema,
  nonNegativeIntSchema,
  NOTE_MAX_CHARS,
  PATH_MAX_CHARS,
  positiveIntSchema,
} from "./bounds.js";

export const ImageRegionSchema = z
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

export const TurnIntakeLocatorSchema = z
  .object({
    kind: z.literal("turn"),
    turn: idSchema,
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
    bbox: ImageRegionSchema.optional(),
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
    bbox: ImageRegionSchema.optional(),
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

export const DocxIntakeLocatorSchema = z
  .object({
    kind: z.literal("docx"),
    paragraph: positiveIntSchema,
    char_start: nonNegativeIntSchema,
    char_end: nonNegativeIntSchema,
  })
  .strict()
  .refine((locator) => locator.char_end >= locator.char_start, {
    message: "char_end must be >= char_start",
    path: ["char_end"],
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

export const TextIntakeLocatorSchema = z
  .object({
    kind: z.literal("text"),
    line_start: positiveIntSchema,
    line_end: positiveIntSchema,
    char_start: nonNegativeIntSchema,
    char_end: nonNegativeIntSchema,
  })
  .strict()
  .refine(
    (locator) => locator.line_end >= locator.line_start && locator.char_end >= locator.char_start,
    { message: "line_end and char_end must not precede their starts" },
  );

export const ImageLocatorSchema = z
  .object({
    kind: z.literal("image"),
    region: ImageRegionSchema,
    ocrText: boundedString(NOTE_MAX_CHARS).optional(),
  })
  .strict();

export const ImageIntakeRegionLocatorSchema = z
  .object({
    kind: z.literal("image"),
    region: ImageRegionSchema,
    ocr_text: boundedString(NOTE_MAX_CHARS).nullable().optional(),
  })
  .strict();

export const ImageIntakeCoordsLocatorSchema = z
  .object({
    kind: z.literal("image"),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: z.number().positive(),
    h: z.number().positive(),
    ocr_text: boundedString(NOTE_MAX_CHARS).nullable().optional(),
  })
  .strict();

export const SpecLocatorSchema = z
  .object({
    kind: z.literal("spec"),
    jsonPointer: jsonPointerSchema,
  })
  .strict();

export const SpecIntakeLocatorSchema = z
  .object({
    kind: z.literal("spec"),
    pointer: jsonPointerSchema.min(1),
  })
  .strict();

export const CanonicalEvidenceLocatorSchema = z.union([
  TurnLocatorSchema,
  PdfLocatorSchema,
  DocxLocatorSchema,
  TextLocatorSchema,
  ImageLocatorSchema,
  SpecLocatorSchema,
]);

/**
 * Six locator kinds accepting both canonical camelCase packet shapes and
 * snake_case prompt / external-intake shapes. Every object arm is `.strict()`.
 */
export const EvidenceLocatorSchema = z.union([
  TurnLocatorSchema,
  PdfLocatorSchema,
  DocxLocatorSchema,
  TextLocatorSchema,
  ImageLocatorSchema,
  SpecLocatorSchema,
  TurnIntakeLocatorSchema,
  PdfIntakeLocatorSchema,
  DocxIntakeLocatorSchema,
  TextIntakeLocatorSchema,
  ImageIntakeRegionLocatorSchema,
  ImageIntakeCoordsLocatorSchema,
  SpecIntakeLocatorSchema,
]);

export type ImageRegion = z.infer<typeof ImageRegionSchema>;
export type TurnLocator = z.infer<typeof TurnLocatorSchema>;
export type TurnIntakeLocator = z.infer<typeof TurnIntakeLocatorSchema>;
export type PdfLocator = z.infer<typeof PdfLocatorSchema>;
export type PdfIntakeLocator = z.infer<typeof PdfIntakeLocatorSchema>;
export type DocxLocator = z.infer<typeof DocxLocatorSchema>;
export type DocxIntakeLocator = z.infer<typeof DocxIntakeLocatorSchema>;
export type TextLocator = z.infer<typeof TextLocatorSchema>;
export type TextIntakeLocator = z.infer<typeof TextIntakeLocatorSchema>;
export type ImageLocator = z.infer<typeof ImageLocatorSchema>;
export type ImageIntakeRegionLocator = z.infer<typeof ImageIntakeRegionLocatorSchema>;
export type ImageIntakeCoordsLocator = z.infer<typeof ImageIntakeCoordsLocatorSchema>;
export type SpecLocator = z.infer<typeof SpecLocatorSchema>;
export type SpecIntakeLocator = z.infer<typeof SpecIntakeLocatorSchema>;
export type CanonicalEvidenceLocator = z.infer<typeof CanonicalEvidenceLocatorSchema>;
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;

/** Losslessly normalizes any camelCase or snake_case EvidenceLocator to canonical packet shape. */
export function normalizeEvidenceLocator(locator: EvidenceLocator): CanonicalEvidenceLocator {
  switch (locator.kind) {
    case "turn": {
      const turnId = "turnId" in locator ? locator.turnId : locator.turn;
      return {
        kind: "turn",
        turnId,
        start: locator.start,
        end: locator.end,
      };
    }
    case "pdf": {
      const charStart = "charStart" in locator ? locator.charStart : locator.char_start;
      const charEnd = "charEnd" in locator ? locator.charEnd : locator.char_end;
      const base: PdfLocator = {
        kind: "pdf",
        page: locator.page,
        charStart,
        charEnd,
      };
      if (locator.bbox !== undefined) {
        return { ...base, bbox: locator.bbox };
      }
      return base;
    }
    case "docx": {
      const charStart = "charStart" in locator ? locator.charStart : locator.char_start;
      const charEnd = "charEnd" in locator ? locator.charEnd : locator.char_end;
      return {
        kind: "docx",
        paragraph: locator.paragraph,
        charStart,
        charEnd,
      };
    }
    case "text": {
      const lineStart = "lineStart" in locator ? locator.lineStart : locator.line_start;
      const lineEnd = "lineEnd" in locator ? locator.lineEnd : locator.line_end;
      const charStart = "charStart" in locator ? locator.charStart : locator.char_start;
      const charEnd = "charEnd" in locator ? locator.charEnd : locator.char_end;
      return {
        kind: "text",
        lineStart,
        lineEnd,
        charStart,
        charEnd,
      };
    }
    case "image": {
      const region: ImageRegion =
        "region" in locator ? locator.region : [locator.x, locator.y, locator.w, locator.h];
      let ocrText: string | undefined;
      if ("ocrText" in locator) {
        ocrText = locator.ocrText;
      } else if ("ocr_text" in locator && locator.ocr_text !== null) {
        ocrText = locator.ocr_text;
      }
      if (ocrText !== undefined) {
        return { kind: "image", region, ocrText };
      }
      return { kind: "image", region };
    }
    case "spec": {
      const jsonPointer = "jsonPointer" in locator ? locator.jsonPointer : locator.pointer;
      return { kind: "spec", jsonPointer };
    }
  }
}
