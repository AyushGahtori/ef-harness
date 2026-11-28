export { auditConnectionsHtml, themePairFailures } from "./a11y.js";
export {
  HonestUsageAnalyticsView,
  REPORTED_BADGE,
  estimatedBadge,
  type AnalyticsModel,
  type AnalyticsOptions,
  type MoneyBucket,
  type PhaseHonesty,
  type SubscriptionWindow,
  type UsageTab,
} from "./analytics.js";
export { AnalyticsScreenView, renderAnalyticsHtml } from "./analytics-view.js";
export {
  CLAUDE_CODE_NOTICE,
  GEMINI_CLI_INVOCATION,
  GEMINI_POLICY_NOTICE,
  LOUD_FALLBACK_WARNING,
  NO_CONNECTIONS_BANNER,
  ORACLE_FAMILY_NOTE,
  PRIMARY_CARDS,
  ROLES,
  containsForbiddenProvider,
  forbiddenProviderNeedle,
  type RoleId,
} from "./catalog.js";
export { contrastRatio, meetsContrast, parseHex, relativeLuminance } from "./contrast.js";
export {
  RECEIPT_COLUMNS,
  UsageReceiptsCsvExporter,
  encodeRfc4180Cell,
  neutralizeCell,
  parseRfc4180,
  type CsvExport,
  type PublicReceipt,
  type ReceiptColumn,
} from "./csv.js";
export { h, tone, NUMERIC } from "./dom.js";
export { formatCountdown, formatMicroUsd, percentFromPpm } from "./format.js";
export { moveFocus, type KeyInput } from "./keyboard.js";
export {
  ANTHROPIC_COMPLIANCE_MESSAGE,
  anthropicPasteRejection,
  detectPastedKeyProvider,
  pastedProviderLabel,
  type PastedKeyProvider,
} from "./key-detect.js";
export { connectionKeyHandoff, postUsageReceipts, type ConnectionsMessagePort } from "./ipc.js";
export type {
  CardModel,
  ConnectionsViewModel,
  DrawerModel,
  HealthRowModel,
  RoleModel,
  StopCardModel,
} from "./model.js";
export {
  probeKindFor,
  type ConnectionProbePort,
  type ConnectionProbeResult,
  type ExplicitFallbackOrderItem,
  type FallbackGuardPort,
  type GuardBillingClass,
  type GuardConnectionStatus,
  type GuardConnectionView,
  type ProbeKind,
  type RouteComplianceStatus,
  type SettingsNavigationPort,
} from "./ports.js";
export {
  TelemetryReceiptStore,
  type ApiAggregate,
  type LocalAggregate,
  type PricingSource,
  type ReceiptPageRow,
  type ReceiptQuery,
  type UsageCurrency,
  type UsagePhase,
  type UsageReceipt,
  type WindowAggregate,
  type WindowKind,
} from "./receipts.js";
export { ConnectionsManagementScreen, type ExplicitFallbackRule, type ScreenConnection, type ConnectionsScreenOptions } from "./screen.js";
export { ConnectionsScreenView, renderConnectionsHtml } from "./screen-view.js";
export { EphemeralKeyBuffer, maskSecret, type ConnectionKeyHandoff } from "./secrets.js";
export {
  DARK_THEME,
  LIGHT_THEME,
  layoutForWidth,
  themeContrastFailures,
  themeFor,
  type ThemeTokens,
} from "./theme.js";
