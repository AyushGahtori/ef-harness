export class DocFetchError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DomainNotAllowlistedError extends DocFetchError {
  readonly hostname: string;

  constructor(hostname: string) {
    super("DOMAIN_NOT_ALLOWLISTED", `domain is not allowlisted: ${hostname}`);
    this.hostname = hostname;
  }
}

export class SsrfBlockedError extends DocFetchError {
  readonly address: string;

  constructor(address: string) {
    super("SSRF_BLOCKED", `blocked address: ${address}`);
    this.address = address;
  }
}

export class RedirectLimitError extends DocFetchError {
  constructor(url: string) {
    super("REDIRECT_LIMIT", `redirect limit exceeded at ${url}`);
  }
}

export class DownloadTooLargeError extends DocFetchError {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super("DOWNLOAD_TOO_LARGE", `download exceeded ${maxBytes} uncompressed bytes`);
    this.maxBytes = maxBytes;
  }
}

export class PathTraversalError extends DocFetchError {
  readonly packageSpec: string;

  constructor(packageSpec: string) {
    super("PATH_TRAVERSAL", `package path escapes the local store: ${packageSpec}`);
    this.packageSpec = packageSpec;
  }
}

export class DocMethodNotAllowedError extends DocFetchError {
  readonly method: string;

  constructor(method: string) {
    super("METHOD_NOT_ALLOWED", `doc fetch allows only GET and HEAD, received ${method}`);
    this.method = method;
  }
}

export class JsRendererUnavailableError extends DocFetchError {
  constructor(detail: string, options?: { cause?: unknown }) {
    super("JS_RENDERER_UNAVAILABLE", detail, options);
  }
}
