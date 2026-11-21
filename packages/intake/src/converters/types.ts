export type PdfLocator = {
  readonly type: "pdf";
  readonly page: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly bbox?: readonly [number, number, number, number];
};

export type PdfOcrLocator = {
  readonly type: "pdf_ocr";
  readonly page: number;
  readonly confidence?: number;
  readonly bbox?: readonly [number, number, number, number];
};

export type DocxLocator = {
  readonly type: "docx";
  readonly sectionHeading: string;
  readonly paragraphIndex: number;
  readonly tableCell?: readonly [number, number];
};

export type MarkupLocator = {
  readonly type: "markdown" | "html";
  readonly filePath: string;
  readonly headingPath: readonly string[];
  readonly lineStart: number;
  readonly lineEnd: number;
};

export type CsvLocator = {
  readonly type: "csv";
  readonly sheet?: string;
  readonly headerColumns: readonly string[];
  readonly rowStart: number;
  readonly rowEnd: number;
};

export type OcrBlock = {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: readonly [number, number, number, number];
};

export type ImageLocator = {
  readonly type: "image";
  readonly width: number;
  readonly height: number;
  readonly ocrBlocks: readonly OcrBlock[];
  readonly visionSummaryRef?: string;
};

export type DocumentLocator =
  | PdfLocator
  | PdfOcrLocator
  | DocxLocator
  | MarkupLocator
  | CsvLocator
  | ImageLocator;

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list_item"
  | "table_cell"
  | "figure"
  | "schema";

export type MediaType = "pdf" | "docx" | "markdown" | "html" | "csv" | "tsv" | "image";

export type WarningName =
  | "HiddenTextStrippedWarning"
  | "StealthUnicodeStrippedWarning"
  | "XxeBlockedWarning"
  | "MacrosStrippedWarning"
  | "ActiveContentStrippedWarning";

export type WarningCode =
  | "hidden_text_detected"
  | "stealth_unicode_stripped"
  | "xxe_blocked"
  | "macros_stripped"
  | "active_content_stripped";

export interface ConverterWarning {
  readonly name: WarningName;
  readonly code: WarningCode;
  readonly message: string;
}

export interface NormalizedBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly utf8ByteStart: number;
  readonly utf8ByteEnd: number;
  readonly locator: DocumentLocator;
}

export interface NormalizedStats {
  readonly charCount: number;
  readonly pageCount?: number;
  readonly totalRows?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface NormalizedDocument {
  readonly schema: "normalized-document@1";
  readonly sourceHash: string;
  readonly fileName: string;
  readonly mediaType: MediaType;
  readonly text: string;
  readonly blocks: readonly NormalizedBlock[];
  readonly warnings: readonly ConverterWarning[];
  readonly ocrDerived: boolean;
  readonly stats: NormalizedStats;
}

export interface RawBlock {
  readonly kind: BlockKind;
  readonly text: string;
  readonly locator: DocumentLocator;
}

export interface VisionCaption {
  readonly summary: string;
  readonly ref: string;
}

export interface VisionCaptioner {
  caption(input: {
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly ocrText: string;
  }): Promise<VisionCaption>;
}

export interface ConvertRequest {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly pageStart?: number;
  readonly pageEnd?: number;
  readonly visionCaptioner?: VisionCaptioner;
  readonly wallClockMs?: number;
  readonly memoryLimitBytes?: number;
}
