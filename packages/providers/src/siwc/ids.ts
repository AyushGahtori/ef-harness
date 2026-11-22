const CONNECTION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertConnectionId(connectionId: string): string {
  if (!CONNECTION_ID.test(connectionId)) {
    throw new Error("connectionId must be a lowercase label such as chatgpt-personal");
  }
  return connectionId;
}

export function siwcTokenSecretName(connectionId: string): string {
  return `siwc/${assertConnectionId(connectionId)}/tokens`;
}

export function siwcProfileKey(connectionId: string): string {
  return `siwc.profile.${assertConnectionId(connectionId)}`;
}
