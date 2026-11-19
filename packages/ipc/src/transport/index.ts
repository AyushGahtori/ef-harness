export {
  BINARY_CHUNK_BYTES,
  BINARY_STREAM_CHANNEL,
  CURRENT_PROTOCOL,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  JSON_IPC_MAX_BYTES,
  JSON_RPC_CHANNEL,
  RPC_AUTH_FAILED,
  RPC_PROTOCOL_MISMATCH,
  SUPPORTED_PROTOCOLS,
} from "./constants.js";
export type { ProtocolVersion } from "./constants.js";
export {
  ConnectionClosedError,
  FrameChannelError,
  FrameTooLargeError,
  OutboundBufferLimitError,
  PipeInUseError,
  ProtocolVersionMismatchError,
} from "./errors.js";
export { FrameCodec } from "./frame-codec.js";
export type { BinaryFrame, DecodedFrame, EncodedFrame, JsonFrame } from "./frame-codec.js";
export { MessagePortBridge } from "./message-port-bridge.js";
export type { BridgeBinaryMessage, BridgeJsonMessage } from "./message-port-bridge.js";
export { NamedPipeClient } from "./named-pipe-client.js";
export type { NamedPipeClientOptions } from "./named-pipe-client.js";
export { NamedPipeServer } from "./named-pipe-server.js";
export type { NamedPipeServerOptions, PipeSession, RequestHandler } from "./named-pipe-server.js";
export { listTcpUdpListeners } from "./network.js";
export { sanitizeUserName, testPipePath, userPipePath } from "./paths.js";
export { LocalSecretRedactor, createRedactingLogger } from "./redaction.js";
export type { SecretRedactor, StructuredLogger } from "./redaction.js";
export { SessionTokenStore, timingSafeTokenEqual } from "./session-token-store.js";
export type { SessionTokenStoreOptions } from "./session-token-store.js";
export { SocketWriter } from "./socket-writer.js";
export {
  currentUserSid,
  readFileAccessSddl,
  readNamedPipeSddl,
  securityTrustees,
  warmWindowsSecurity,
} from "./windows-security.js";
