import { SIWC_ROUTE_REVOKED_GUIDANCE, SIWC_SCOPE_REJECTED_MESSAGE, SIWC_SIGN_IN_EXPIRED_MESSAGE } from "./constants.js";

export class SiwcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class SiwcScopeRejectedError extends SiwcError {
  constructor() {
    super("scope_missing", SIWC_SCOPE_REJECTED_MESSAGE);
  }
}

export class SiwcSignInExpiredError extends SiwcError {
  constructor() {
    super("invalid_grant", SIWC_SIGN_IN_EXPIRED_MESSAGE);
  }
}

export class SiwcRouteRevokedError extends SiwcError {
  constructor(message: string = SIWC_ROUTE_REVOKED_GUIDANCE) {
    super("route_revoked", message);
  }
}

export class SiwcInvalidStateError extends SiwcError {
  constructor() {
    super("invalid_state", "Invalid state");
  }
}

export class SiwcCancelledError extends SiwcError {
  constructor() {
    super("cancelled", "Sign in with ChatGPT was cancelled.");
  }
}

export class SiwcCallbackTimeoutError extends SiwcError {
  constructor() {
    super("callback_timeout", "The sign-in window closed before ChatGPT redirected back.");
  }
}

export class SiwcNonceRejectedError extends SiwcError {
  constructor() {
    super("invalid_nonce", "The ChatGPT sign-in response did not match this attempt.");
  }
}
