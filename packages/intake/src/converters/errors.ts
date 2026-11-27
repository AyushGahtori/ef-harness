export class FileExpansionLimitError extends Error {
  readonly code = "file_expansion_limit";

  constructor(message = "Decompressed file exceeded the 200 MB or 50x expansion cap.") {
    super(message);
    this.name = "FileExpansionLimitError";
  }
}

export class FileSizeLimitError extends Error {
  readonly code = "file_size_limit";

  constructor(message = "File exceeds the 50 MB raw size cap.") {
    super(message);
    this.name = "FileSizeLimitError";
  }
}

export class UnsupportedOrMismatchedFileType extends Error {
  readonly code = "unsupported_or_mismatched_file_type";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOrMismatchedFileType";
  }
}

export class PasswordRequiredError extends Error {
  readonly code = "password_required";

  constructor(
    message = "This PDF is password-protected; please export an unlocked copy",
  ) {
    super(message);
    this.name = "PasswordRequiredError";
  }
}

export class PageRangeRequiredError extends Error {
  readonly code = "page_range_required";

  constructor(message = "Select specific page range") {
    super(message);
    this.name = "PageRangeRequiredError";
  }
}

export class ConverterProcessError extends Error {
  readonly code = "converter_process_failed";

  constructor(message: string) {
    super(message);
    this.name = "ConverterProcessError";
  }
}

export class ConverterTimeoutError extends Error {
  readonly code = "converter_timeout";

  constructor(message = "Document conversion exceeded the 30 second cap.") {
    super(message);
    this.name = "ConverterTimeoutError";
  }
}

export class ZeroNetworkDeniedError extends Error {
  readonly code = "zero_network_denied";

  constructor(message = "Converter network access is denied.") {
    super(message);
    this.name = "ZeroNetworkDeniedError";
  }
}

export class CasBlobMissingError extends Error {
  readonly code = "cas_blob_missing";

  constructor(hash: string) {
    super(`CAS blob is missing: ${hash}`);
    this.name = "CasBlobMissingError";
  }
}

export class CasIntegrityMismatchError extends Error {
  readonly code = "cas_integrity_mismatch";

  constructor(hash: string) {
    super(`CAS blob hash mismatch: ${hash}`);
    this.name = "CasIntegrityMismatchError";
  }
}

const ERROR_TYPES = [
  FileExpansionLimitError,
  FileSizeLimitError,
  UnsupportedOrMismatchedFileType,
  PasswordRequiredError,
  PageRangeRequiredError,
  ConverterProcessError,
  ConverterTimeoutError,
  ZeroNetworkDeniedError,
  CasBlobMissingError,
  CasIntegrityMismatchError,
] as const;

export function rehydrateConverterError(name: string, message: string): Error {
  for (const Type of ERROR_TYPES) {
    if (Type.name === name) {
      return new Type(message);
    }
  }
  const error = new ConverterProcessError(message);
  error.name = name;
  return error;
}
