export class AuthPaymentMockError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class NonLoopbackTargetError extends AuthPaymentMockError {
  readonly target: string;

  constructor(target: string) {
    super(
      "non_loopback_target",
      `Refusing non-loopback target ${target}. OAuth and payment mocks stay on 127.0.0.1, localhost, or *.localhost.`,
    );
    this.target = target;
  }
}

export class UnknownEnvironmentError extends AuthPaymentMockError {
  readonly envId: string;

  constructor(envId: string) {
    super("unknown_environment", `Unknown OAuth environment ${envId}`);
    this.envId = envId;
  }
}

export class RedirectUriRejectedError extends AuthPaymentMockError {
  readonly redirectUri: string;

  constructor(redirectUri: string, reason: string) {
    super("redirect_uri_rejected", `Redirect URI rejected (${reason}): ${redirectUri}`);
    this.redirectUri = redirectUri;
  }
}

export class LeaseTimeoutError extends AuthPaymentMockError {
  readonly resourceKey: string;

  constructor(resourceKey: string) {
    super(
      "lease_timeout",
      `Timed out waiting for exclusive lease ${resourceKey}. The holder did not release it.`,
    );
    this.resourceKey = resourceKey;
  }
}

export class JobAlreadyTerminatedError extends AuthPaymentMockError {
  readonly jobId: string;

  constructor(jobId: string) {
    super("job_already_terminated", `Job ${jobId} is already terminated`);
    this.jobId = jobId;
  }
}

export class HardCodedPortError extends AuthPaymentMockError {
  constructor(message: string) {
    super("hard_coded_port", message);
  }
}
