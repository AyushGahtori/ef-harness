---
task_id: "Task-200"
branch: "task/200-release-certification-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "benchmarks/m6-release/**"
  - "tests/e2e/m6-exit-gate/**"
  - "tests/e2e/tests/m6-exit-gate.test.ts"
  - ".agent-handoffs/task-200.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 200 handoff

M6 and v1 release certification gate. Ci-replay can return GO for checks this worktree actually executed or evaluated as labeled local-port fixtures. Live sign-off stays WITHHELD. This branch does not claim a production certification and does not authorize tagging v1.0.0.

## Exports Provided

- `V1ReleaseCertificationRunner` from `benchmarks/m6-release/src/index.ts`
- `runCertification`
- `V1_RELEASE_SCORECARD` schema `ef-harness.v1-release-scorecard.v1`
- CLI: `node benchmarks/m6-release/cli.ts --profile ci-replay --out <dir>`
- CLI: `node benchmarks/m6-release/cli.ts --profile full-release-certification --out <dir>`
- Collector required by the frozen e2e Vitest include: `tests/e2e/tests/m6-exit-gate.test.ts`

## Shared Wiring Needs (Root / Index Barrels)

- Do not treat a ci-replay GO as permission to tag v1.0.0. Tag only after `full-release-certification` returns GO on `harness/integration` with live evidence.
- Frozen `benchmarks/src/index.ts` is outside this task. Please re-export `V1ReleaseCertificationRunner` from `@ef-harness/benchmarks` when wiring the release barrel.
- Frozen root `package.json` is outside this task. Please add `test:v1-release-gate` as `node benchmarks/m6-release/cli.ts --profile ci-replay --out <dir>` for the integration coordinator.
- Frozen `tests/e2e/vitest.config.ts` includes only `tests/**/*.test.ts`. The owned suite lives in `tests/e2e/m6-exit-gate/`. `tests/e2e/tests/m6-exit-gate.test.ts` is a side-effect collector so `pnpm --filter @ef-harness/e2e test -- m6-exit-gate` can see that suite without editing the frozen config.

## Dependency Intents (New Packages Requested)

None. Production age encryption, a signed NSIS installer, and live provider SDKs are not added here.

## Contract Change Requests

None. Sibling packages stay on their Task 001 stubs. This gate does not change shared contracts.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/e2e test -- m6-exit-gate`: 13 passed. Ci-replay GO, live sign-off WITHHELD, production certification claimed false. Injected canary leak, board 11.4 ms, stale diagram, unwired task 147, and a case-only rename that leaves the git index unchanged each exit non-zero with NO-GO. Full profile exits non-zero, including with `--unsigned-dev`.
- `pnpm --filter @ef-harness/e2e typecheck`: passed (frozen e2e project). Task sources were also checked with strict `tsc --noEmit` outside the frozen project graph.
- `pnpm --filter @ef-harness/e2e lint`: passed.
- `node scripts/verify-harmony.mjs --task 200`: run as part of the commit gate.

Observed on this machine: Git 2.54 `git mv` records a case-only rename, while a filesystem rename plus `git add` leaves `git ls-files` on the old case. The repair path uses two-step `git mv` and rejects any result whose index case does not match.

## Known Limitations / Follow-Ups

Tasks 001-199 are not on this base. Each one is an explicit local-port swap, not harness/integration wiring. Task 200 is this handoff. An empty export cell means that task's markdown had no matching export sentence for its handoff file.

Ci-replay suite bars, review-trial ids, and perf numbers are local-port fixtures. Resume-changer manifest counts, schema/schema-test.js, diagram integrity, the git case repair, the migration/lease/broker protocols, and the 50-seed chaos oracle were executed here. The seal is `local-port-x25519-aes-gcm-v1`, not production age. Signed NSIS, latest.yml SHA-512, CycloneDX, Authenticode, live providers, the integrated 1000-seed daemon, and the five-pillar audit are withheld.

| Task | Local port | Exports named by the spec |
| --- | --- | --- |
| 001 | local-port:task-001 | (no Export sentence matched) |
| 002 | local-port:task-002 | (no Export sentence matched) |
| 003 | local-port:task-003 | (no Export sentence matched) |
| 004 | local-port:task-004 | (no Export sentence matched) |
| 005 | local-port:task-005 | (no Export sentence matched) |
| 006 | local-port:task-006 | (no Export sentence matched) |
| 007 | local-port:task-007 | (no Export sentence matched) |
| 008 | local-port:task-008 | (no Export sentence matched) |
| 009 | local-port:task-009 | (no Export sentence matched) |
| 010 | local-port:task-010 | (no Export sentence matched) |
| 011 | local-port:task-011 | (no Export sentence matched) |
| 012 | local-port:task-012 | (no Export sentence matched) |
| 013 | local-port:task-013 | (no Export sentence matched) |
| 014 | local-port:task-014 | (no Export sentence matched) |
| 015 | local-port:task-015 | MigrationRunner, rehearseMigration, needs_repair |
| 016 | local-port:task-016 | BackupScheduler, CorruptionRecoveryEngine, ReplaySourceAdapter, RecoveryReport |
| 017 | local-port:task-017 | KnowledgeGraphRepo, ChangeSetProposal, StaleReadSetError, ImpactWalkResult |
| 018 | local-port:task-018 | KnowledgeSearchService, SearchQuery, SearchResultPage, StaleSearchRead |
| 019 | local-port:task-019 | NameRegistryService, RouteSegmentParser, RelationsNormalizer |
| 020 | local-port:task-020 | TaskLeaseManager, DualClock, SleepSkewGuard, AttemptCheckpointRepo, globToPathPrefix |
| 021 | local-port:task-021 | TaskHoldAndSubmissionRepo, TASK_STATE_TRANSITIONS |
| 022 | local-port:task-022 | LifecycleRepo, FeatureDoneEvidenceInput, FeatureDoneCheckResult |
| 023 | local-port:task-023 | BudgetLedgerRepo, ReservationHandle, ThresholdCrossedEvent |
| 024 | local-port:task-024 | BrokerGrantIssuer, ProjectGrantReceiver, GrantReconciler |
| 025 | local-port:task-025 | CoordinatorWriteQueue, OpIdReusedError, WritePriority |
| 026 | local-port:task-026 | OutboxRepo, OutboxDispatcher, DEFAULT_EVENT_CONSUMERS |
| 027 | local-port:task-027 | ReadModelRepo, BoardSummary, DriftReport |
| 028 | local-port:task-028 | CasBlobStore, CasWriteResult, CasIntegrityMismatchError, CasBlobMissingError |
| 029 | local-port:task-029 | ArtifactManager, SeekableLogReader, TurnLogArchiver |
| 030 | local-port:task-030 | SecretPurgeEngine, PurgeReceipt, PROVIDER_ROTATION_URLS |
| 031 | local-port:task-031 | NamedPipeServer, NamedPipeClient, FrameCodec, SessionTokenStore, MessagePortBridge |
| 032 | local-port:task-032 | RpcRouter, EventSubscriptionServer, SnapshotAssembler, ClientStateSyncer |
| 033 | local-port:task-033 | BinaryStreamManager, ArtifactStreamClient, RangeDiffHandler, RangeLogHandler |
| 034 | local-port:task-034 | DeterministicSeededRng, FakeDualClock, FakeModelAdapter, CrashFaultInjector |
| 035 | local-port:task-035 | GitRunner, FolderStateInspector, predictMergeTree, detectCaseCollisions |
| 036 | local-port:task-036 | GitSafetyScanner, SafetyScanReport, ensureGitInfoExclude |
| 037 | local-port:task-037 | SnapshotManager, SnapshotResult, CheckpointCommitResult |
| 038 | local-port:task-038 | WorktreeSlotManager, SlotHandle, IntegrationWorktreeController |
| 039 | local-port:task-039 | RefLeaseManager, HarnessCommitTrailers, findAcceptedCommitsSince |
| 040 | local-port:task-040 | WindowsJobManager, JobHandle, JobLimits, JobAccounting, reconcileOrphanedProcesses |
| 041 | local-port:task-041 | SandboxTierProvider, SandboxLaunchSpec, TierAMxcProvider, compileMxcPolicy |
| 042 | local-port:task-042 | TierBSandboxUsersProvider, TierBAdminProvisioner, EmptySlotAclManager |
| 043 | local-port:task-043 | TierCRestrictedTokenProvider, TierDContainerProvider, SandboxTierSelector, RemoteExecutionProvider |
| 044 | local-port:task-044 | AllowlistProxyServer, NetworkPolicyProfile, ProxyTokenHandle |
| 045 | local-port:task-045 | SecureDocFetcher, DocFetchResult, DOC_DOMAIN_ALLOWLIST, sanitizeHtmlToQuotedMarkdown |
| 046 | local-port:task-046 | KernelPackageInstaller, SupplyChainVetReport, reconcileDependencyIntents, checkTyposquat |
| 047 | local-port:task-047 | HarnessRunEngine, CommandPolicyEvaluator, OutputSummarizer, SandboxedCommandResult |
| 048 | local-port:task-048 | AttemptMcpServer, AttemptMcpDependencies, MCP_TOOL_NAMES |
| 049 | local-port:task-049 | TestEnvOrchestrator, ServiceProvider, EnvironmentManifest, EnvironmentHandle |
| 050 | local-port:task-050 | (no Export sentence matched) |
| 051 | local-port:task-051 | LocalOAuthMockProvider, StripeMockAndWebhookProvider, GenericWebhookDeliverer, HardCodedPortFallbackManager |
| 052 | local-port:task-052 | TemplateDatabaseManager, SyntheticDataGenerator, computeTableChecksums, SeedRecipeSchema |
| 053 | local-port:task-053 | ModelProtocolAdapter, ModelProfile, StreamEvent, NormalizedModelError |
| 054 | local-port:task-054 | WorkerContextBuilder, WorkingMemoryStore, CompactionPipeline, TokenEstimator |
| 055 | local-port:task-055 | WindowedFileReader, ToolOutputShrinker, ReadLogTool, FileOutlineExtractor |
| 056 | local-port:task-056 | EditToolDispatcher, FourTierMatcher, EditRecoveryTracker, parseOpenAiApplyPatch |
| 057 | local-port:task-057 | NativeWorkerLoop, AttemptExecutionResult, generateHandoffNote |
| 058 | local-port:task-058 | StaticAuditAstEngine, StaticAuditFinding, computeStaticAuditFingerprint |
| 059 | local-port:task-059 | CompletenessGateRunner, LeafAuditInput, FeatureAuditInput, StaticAuditReport |
| 060 | local-port:task-060 | CleanVerifierRunner, VerificationOutcome, FailureAttribution, SurfaceVerifierAdapter |
| 061 | local-port:task-061 | RedBeforeGreenGate, ContractStubGenerator, BlindBinderOrchestrator, EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED |
| 062 | local-port:task-062 | UiInteractionContractVerifier, CopyCatalogLinter, TextMatchNormalizer, UiInteractionContractSchema |
| 063 | local-port:task-063 | (no Export sentence matched) |
| 064 | local-port:task-064 | AiFeatureVerifier, PropertyCheckRunner, TargetedBoundaryMutationProber, AiEvalVerdict |
| 065 | local-port:task-065 | HintLadderController, HintFeedbackPayload, TestDisputeRecord |
| 066 | local-port:task-066 | CandidateAcceptanceCoordinator, AcceptanceDecision, MergeInstructionsBuilder |
| 067 | local-port:task-067 | (no Export sentence matched) |
| 068 | local-port:task-068 | (no Export sentence matched) |
| 069 | local-port:task-069 | DiscoverySessionManager, DiscoveryDbRepo, OPENING_RUBRIC_MAP_V1, chunkTurnWithOffsets |
| 070 | local-port:task-070 | DiscoveryPromptOrchestrator, ExactQuoteEvidenceVerifier, QuoteValidationResult |
| 071 | local-port:task-071 | SemanticEntailmentGate, DerivationChainValidator, LongTurnRetractionReconciler, PremiseSupersessionReopener |
| 072 | local-port:task-072 | GreedyQuestionSelector, PrereqEligibilityFilter, ProjectLocalQuestionDrafter, DiscoveryBatchBuilder |
| 073 | local-port:task-073 | StageDepthController, AskValueInterrogationGuard, MustAskPolicyFloor, AutopilotDelegationEngine, ChosenForYouLedger |
| 074 | local-port:task-074 | ReadinessCalculator, DenominatorDeltaExplainer, TransitivePrereqChecker, BoundedDeferralPolicy |
| 075 | local-port:task-075 | CorpusPackLoader, CorpusQualityValidator |
| 076 | local-port:task-076 | (no Export sentence matched) |
| 077 | local-port:task-077 | DiffAutoTagDetector, EntityTagInheritor, StageCoherenceSelfTest, X-01..X-14 |
| 078 | local-port:task-078 | SkillManifestRegistry, StaticSkillSecurityVetter, SkillTokenBudgetEnforcer, CanarySkillQuarantineHarness, SkillMounter |
| 079 | local-port:task-079 | MatrixGeneratorRegistry, ScopedRuleCollapser, MatrixCellPersistenceRepo |
| 080 | local-port:task-080 | OrderedCellFillerPipeline, ProposedRequirementReviewQueue, EarsOracleValidator |
| 081 | local-port:task-081 | FiveLayerContradictionEngine, Z3UnsatCoreSolver, CrossMatrixInvariantChecker, IntervalConflictDetector, SemanticPairConflictSweeper |
| 082 | local-port:task-082 | RiskTriggeredTopicGenerator, FeatureResearchOrchestrator, TokenBasedQuoteMatcher, InstalledTypeApiVerifier, ResearchFactCache |
| 083 | local-port:task-083 | SystemArchitectureSynthesizer, SkeletonLockEnforcer, DeterministicArchConsistencyGate |
| 084 | local-port:task-084 | JitFeatureArchitectureSynthesizer, ScreenSpecGenerator, LowFiWireframeRenderer, ArchDocumentSharder |
| 085 | local-port:task-085 | KnowledgeViewExporter, ViewManifestHashScanner, EfNodeMarkerFormatter, ExportPauseLock, GitExcludeGuard |
| 086 | local-port:task-086 | MarkdownDirectEditImporter, ThreeWayNodeMerger, ImportConflictCardBuilder, SafeDeleteRenameHandler |
| 087 | local-port:task-087 | ChangeClassifier, ReverseImpactWalker, EarlyCutoffReverifier, DebouncedRevisionPropagator, RevisionImpactPreviewer |
| 088 | local-port:task-088 | KnowledgePacketSlicer, BriefLayoutCompiler, BandTokenBudgeter, OversizedMustAutoSplitGuard |
| 089 | local-port:task-089 | CrossCuttingRuleMatcher, KbPullToolHandlers, PullReadAnalyticsRecorder, PullToPushFeedbackAnalyzer |
| 090 | local-port:task-090 | MasterPlanOrchestrator, Phase0RecipeGenerator, WaveDagBuilder, PaperworkBudgetEnvelopeAllocator |
| 091 | local-port:task-091 | JitFeaturePlanner, IndependentOracleAuthorSealer, RelationsToEdgesNormalizer, HiddenCheckPoolStore |
| 092 | local-port:task-092 | DeterministicGraphCompiler, WriteScopeDisjointnessChecker, TraceabilitySqlGate, CompilationWaiverGuard |
| 093 | local-port:task-093 | Phase0ExecutionController, FoundationGate0Verifier, Gate0ReceiptSchema |
| 094 | local-port:task-094 | LookAndFeelInterviewFlow, W3cDesignTokenGenerator, DesignSystemScaffoldBuilder, StyleguideRouteVerifier, DesignTokenLintRuleset |
| 095 | local-port:task-095 | SequentialBuildRunner, ExplicitFirstReadyQueue, AttemptBriefMaterializer, PostMergeSmokeChecker |
| 096 | local-port:task-096 | FeatureIntegratorEngine, MergeTreePreflightScanner, AggregatedWiringTaskBuilder, FeatureJourneyGate |
| 097 | local-port:task-097 | SandboxedDocumentConverter, DocumentLocatorSchema, NormalizedDocument |
| 098 | local-port:task-098 | StructuralDocumentChunker, IntakeExtractionPipeline, LiveSpeechPrecedenceReconciler, DeterministicSchemaContractImporter |
| 099 | local-port:task-099 | BrandAssetSanitizer, FontLicenseInspector, BrandAssetRegistry, Phase0BrandAssetsGenerator, DeterministicPlaceholderGenerator |
| 100 | local-port:task-100 | HarAndLogScrubber, SourceMapStackMapper, ToolLessIssueTriager, SymptomCardStore |
| 101 | local-port:task-101 | CompletionWaveController, DeterministicRepoAuditor, LiveRouteCrawler, ShardedFinalProjectAuditor, LandingSummaryGenerator |
| 102 | local-port:task-102 | HighRiskDiffReviewer, AdvisoryTasteVisionReviewer, AskOwnerResponderEngine |
| 103 | local-port:task-103 | (no Export sentence matched) |
| 104 | local-port:task-104 | (no Export sentence matched) |
| 105 | local-port:task-105 | M2KitchenE2eBenchmarkRunner, KitchenHiddenAcceptanceSuite, M2ExitGateReport |
| 106 | local-port:task-106 | TaskDifficultyClassifier, ExpectedCostLevelSelector, HistoricalPassRateCalibrator, VersionedModelRoster |
| 107 | local-port:task-107 | HeftCriticalPathScheduler, WaveParallelismCalculator, CrewPresetProfileEngine, DynamicScheduleRebalancer |
| 108 | local-port:task-108 | PlanPreviewBuilder, InteractivePlanEditor, FirstBuildApprovalGate, RevisionAutoStartPolicy |
| 109 | local-port:task-109 | ArtifactHandoffStore, ReadResultToolHandler, DurableRoleMailbox, WaitGraphCycleDetector, OwnerResolutionCoordinator |
| 110 | local-port:task-110 | ParallelFeatureBranchManager, DependencyIntentAggregator, MigrationIntentAndConflictLinter, SmartBranchFreshnessSync |
| 111 | local-port:task-111 | ProjectMergeQueue, ProjectIntegratorEngine, CombinedRegressionGate, MergeBatchBisector |
| 112 | local-port:task-112 | ContractChangeRequestEngine, DeterministicSchemaDiffClassifier, AdditiveOwnerFastPath, BreakingCcrRevisionReopener |
| 113 | local-port:task-113 | UnifiedMessageSequencer, InputStartFocusSnapshotter, OrderedMultiClauseExecutor, RouterShortlistRetriever |
| 114 | local-port:task-114 | FourRouteSteeringDispatcher, ImmediateKernelStopController, NewFeatureDedupSpawner, MidBuildRouteReceipt |
| 115 | local-port:task-115 | MultiInterpretationHoldEngine, HoldModeClassifier, HoldReasonStackCoordinator, AdditiveVsContradictoryResumer |
| 116 | local-port:task-116 | SharedQuestionArbiter, OwnerFirstQuestionFilter, QuestionDedupSubscriberStore, StaleReplyReconciler |
| 117 | local-port:task-117 | WindowsResourceTelemetryCollector, ResourceTelemetryProvider, SyntheticTelemetryProvider, HardwareSnapshotSchema |
| 118 | local-port:task-118 | MachineCalibrationRunner, LearnedFootprintStore, PressureHysteresisStateMachine, HeavyLaneSemaphore, GpuWhisperPriorityArbiter, DiskHeadroomGuard |
| 119 | local-port:task-119 | ThreePoolCapacityScheduler, ThinkingPoolCoordinator, WarmExecutionSlotPool, SessionProcessCapGuard, SingleDiskWriteLane, TierERemoteExecutionInterface |
| 120 | local-port:task-120 | WindowsDpapiSecretsVault, RuntimeOnlyEnvInjector, LiveKeyTestRefusalGuard, ProviderSecretProber, GitignoredLocalEnvWriter |
| 121 | local-port:task-121 | HumanStepProbeRegistry, ConsentedTerminalInstaller, HumanStepStateStore, AttestedVsVerifiedBadgePolicy |
| 122 | local-port:task-122 | SingleAppShell, ShellLayoutContext, DaemonStoreProvider |
| 123 | local-port:task-123 | PhaseLayoutPresetManager, NonDisruptivePhaseSwitchBanner, PopOutWindowCoordinator, DisconnectedMonitorBoundsGuard |
| 124 | local-port:task-124 | BoardCockpitView, DeterministicStatusLineFormatter, FeatureSwimlaneGrouper, mapTaskToBoardLane |
| 125 | local-port:task-125 | BoardHealthSignalEngine, HealthSignalBadgeStrip, OnDemandCockpitExplainer |
| 126 | local-port:task-126 | WorkerInspectorPanel, InspectorSelectionProps |
| 127 | local-port:task-127 | CalmInboxPanel, NotificationCadenceScheduler |
| 128 | local-port:task-128 | BudgetWindDownController, CheckpointStopCardView, WipBranchHandoffExporter |
| 129 | local-port:task-129 | FeatureUndoInventoryAnalyzer, CrossFeatureUsageGraphChecker, SharedOwnershipTransferPlanner, FeatureUndoExecutor |
| 130 | local-port:task-130 | ColdOpenReconciler, CommitAnsweredQuestionDetector, NoRunUntilResumeGate, WelcomeBackScreen |
| 131 | local-port:task-131 | SystemTrayController, QuitWhileBuildingDialog, PowerMonitorSleepReconciler, OptionalPowerSaveBlocker, StartAtSignInManager, DaemonShutdownCoordinator |
| 132 | local-port:task-132 | SignedComponentDownloader, AvQuarantineIntegrityChecker, ParkFirstAutoUpdater, CheckpointSchemaUpcasterRegistry |
| 133 | local-port:task-133 | DiagnosticsMetricsAggregator, CrashDumpIndexer, RedactedDiagnosticsBundleExporter, DiagnosticsHealthView |
| 134 | local-port:task-134 | M3ParallelBenchmarkRunner, M3ScaleAndLatencyCertifier, M3ExitGateReport |
| 135 | local-port:task-135 | SignedProviderPolicyEngine, CompliancePolicyLocks, CliMinVersionGate, RouteRevocationParkHandler |
| 136 | local-port:task-136 | ApiKeyPrefixDetector, ZeroTokenApiKeyValidator, ApiConnectionManager, VersionedPriceTableEstimator |
| 137 | local-port:task-137 | SignInWithChatGptAuthFlow, SiwcTokenRefresher, SiwcDirectRequestAdapter, SiwcStreamCutoffGuard |
| 138 | local-port:task-138 | OpenRouterPkceOAuthFlow, LocalModelAutoDiscoverer, LocalModelCapabilityProber, LocalVramSlotManager |
| 139 | local-port:task-139 | GitHubCopilotDeviceAuthFlow, CopilotQuotaReader, CursorBrowserAuthFlow, CursorKeyExpiryReminderScheduler |
| 140 | local-port:task-140 | AllowancePacingController, AimdConcurrencyRegulator, BurnRateWindowTracker, ModelAllowanceWeightLearner, RateLimitVsUsageLimitClassifier |
| 141 | local-port:task-141 | NoSilentPaidFallbackGuard, ConnectionsManagementScreen, HonestUsageAnalyticsView, UsageReceiptsCsvExporter |
| 142 | local-port:task-142 | AgentRuntimeAdapter, NormalizedRuntimeEventBus, DeterministicSupervisionPolicyEngine, WrappedVsStrippedModeSelector, AdapterRegistry |
| 143 | local-port:task-143 | GenericAcpAdapter, AcpJsonRpcTransport, AcpHostFsAndTerminalBridge, AcpMcpAndSkillBinder |
| 144 | local-port:task-144 | CodexRuntimeAdapter, CodexAppServerClient, CodexAcpFallbackTransport, CodexRateLimitBridge |
| 145 | local-port:task-145 | CopilotRuntimeAdapter, CopilotSdkBridge, CopilotAcpFallbackAdapter, CopilotMetricsAndQuotaTracker |
| 146 | local-port:task-146 | CursorRuntimeAdapter, CursorLocalSdkBridge, CursorAcpFallbackAdapter, CursorUsageAndHookController |
| 147 | local-port:task-147 | ClaudeCodeRuntimeAdapter, ClaudeStreamJsonTransport, ClaudeStdioPermissionController, ClaudeConsoleKeyComplianceEnforcer |
| 148 | local-port:task-148 | GeminiCliRuntimeAdapter, GeminiOptInComplianceGate, GeminiVisibleConPtyLoginHelper |
| 149 | local-port:task-149 | OpenCodeRuntimeAdapter, OpenCodeConfigGenerator, OpenCodeCompactionController |
| 150 | local-port:task-150 | ForeignRuntimeResumeCoordinator, LabeledWipFreshSessionRebuilder, IdleWrappedAgentAutoParker |
| 151 | local-port:task-151 | AdapterConformanceRunner, ConformanceVersionCache, AutomaticTrustDowngrader |
| 152 | local-port:task-152 | M4AllowancePacedBenchmark, M4ComplianceAndFallbackCertifier, M4ExitGateReport |
| 153 | local-port:task-153 | InteractiveArchitectureCanvas, CanvasSelectionContext, SavedNodePositionStore, SemanticZoomController |
| 154 | local-port:task-154 | MultiBoxSelectionController, NodeTypePopoverRegistry, CanvasQuickActionToolbar, PostSendChangeHighlighter |
| 155 | local-port:task-155 | SingleComposerView, ComposerTargetStateMachine, PerTargetDraftStore, useComposerTarget |
| 156 | local-port:task-156 | BoxChatIntentController, CorrectVsChangeTogglePreset, ZeroTokenImpactPreviewModal, RevisionDriftConflictPrompt |
| 157 | local-port:task-157 | LocalWhisperSttEngine, OsFallbackDictationBridge, DictationStabilityStream, LowConfidenceCriticalSpanHighlighter, EditableDictationDraftController |
| 158 | local-port:task-158 | ProjectDictationVocabularyManager, WhisperInitialPromptBuilder, TwoOccurrenceCorrectionLearner, ProjectVerifiedSpokenIdNormalizer |
| 159 | local-port:task-159 | SpecBrowserTab, MatrixCoverageExplorer, MediumRiskProposalReviewPanel, PlanTreeAndPreviewTab, RuntimeTasksTableTab |
| 160 | local-port:task-160 | LivePreviewDaemonRunner, PersistentDemoDbManager, LastGoodPreviewFallbackStore, IsolatedPreviewWebviewHost |
| 161 | local-port:task-161 | DevOnlyJsxSourceTagPlugin, PointToFixPickerOverlay, ElementAndGapContextCapturer, VisualSteerRouter, BeforeAfterBaselineApprover |
| 162 | local-port:task-162 | OfficePixiViewport, TiledFloorPlanLoader, CozyPixelSpriteAtlasEngine, OfficeCameraController, ROOM_IDS |
| 163 | local-port:task-163 | OfficeCastProjector, AgentLabelAndDeskPinLayer, HelperSpriteClusterManager, OfficeInteractionController, formatAgentOfficeTag |
| 164 | local-port:task-164 | TruthfulAnimationDirector, AStarTilePathfinder, BurstCollapseEventQueue, OfficeFrameBudgetMonitor |
| 165 | local-port:task-165 | OfficeReducedMotionAdapter, OrangePressureAutoBoardFallback, OfficeSemanticMirrorTree, HotDeskOverflowAggregator, OptionalSoftChimesController |
| 166 | local-port:task-166 | BrownfieldL0RepoScanner, StackAndFrameworkDetector, GitChurnHotspotAnalyzer, MonorepoWorkspacePicker |
| 167 | local-port:task-167 | WasmTreeSitterIndexer, AiderPageRankCalculator, GeneratedAndVendoredFilter, CompactCodeMapQueryService |
| 168 | local-port:task-168 | RequestDrivenFocusSelector, L2PreSpendEstimator, CodeEgressSecretMasker, ModuleCardCacheEngine, StaleDocsDetector |
| 169 | local-port:task-169 | BrownfieldOpeningController, MixedRequestWorkItemSplitter, MeasurablePerfInterviewFlow, TodayVsChangeConfirmationBuilder, ExistingConventionsExtractor |
| 170 | local-port:task-170 | BaselineTestHealthRunner, KnownFailingQuarantineStore, ThreeRunFlakeDetector, CharacterizationSafetyNetPlanner, BrokenBuildEntryGate |
| 171 | local-port:task-171 | EditorCoexistenceWatcher, ActiveScopeOverlapDetector, ManualLockfileIncludeHandler, BaseSyncIntegrationMerger |
| 172 | local-port:task-172 | SafeLandingPreFlightAnalyzer, ZeroStashLandingExecutor, DirtyOverlapFourOptionDialog, LandingRollbackSafetyPoint |
| 173 | local-port:task-173 | HumanFixTakeoverController, HumanEditWorkspacePicker, HumanFixCleanVerifier, HumanScopeAndContractReconciler, HumanVerificationOverridePolicy |
| 174 | local-port:task-174 | UiConsistencyPipeline, DuplicateComponentDetector, ThreeWidthLayoutAndTapTargetChecker, CrossScreenRhythmAuditor, ApprovedScreenshotRegressionRunner |
| 175 | local-port:task-175 | ResumeChangerBenchmarkVerifier, M5InteractiveUxE2eSuite, OfficeTruthfulnessCertifier, M5ExitGateReport |
| 176 | local-port:task-176 | ExternalEffectLedger, EnvApprovalPolicyEngine, LeaseEpochFencingGuard, UnknownOutcomeReconciler |
| 177 | local-port:task-177 | GitHubAuthConnector, BranchProtectionPolicyReader, GitHubRateAwareQueue, ConditionalEtagPoller |
| 178 | local-port:task-178 | ShipRunStateMachine, GraphGeneratedPrBuilder, BoundedCiRepairLoop, FiveClassCiTriager, LinuxCaseSensitivityAutoRepair |
| 179 | local-port:task-179 | DeployAdapter, VercelDeployAdapter, DockerOverSshDeployAdapter, NameOnlySyncEnvController |
| 180 | local-port:task-180 | ExpandContractMigrationOrchestrator, DdlSafetyClassifier, PausableBatchedBackfillRunner, ContractPhaseExportGuard |
| 181 | local-port:task-181 | PostDeployVerifier, TenMinuteErrorWatchMonitor, EnvironmentRollbackPolicyController, ExternalRegistrationReceiptManager |
| 182 | local-port:task-182 | MysteryBugInvestigationPipeline, StageGateEnforcer, MinimalFlipRootCauseProver, InvestigationReceiptStore |
| 183 | local-port:task-183 | FlakeSafeGitBisector, CrossBrowserDiffRunner, DeltaDebuggingInputShrinker, HypothesisLoopGuard, SymptomPatchDetector |
| 184 | local-port:task-184 | SweepLeaseCoordinator, MaintenanceWindowDrainer, DeterministicCodemodRunner, SweepOrchestrator |
| 185 | local-port:task-185 | VariantExpandedReferenceInventory, PersistedNameBoundaryGate, RiskyAstTransformDetector, SweepLeftoverScanner, PostSweepBriefSymbolUpdater |
| 186 | local-port:task-186 | OrphanBranchPortabilityExporter, SortedPerEntityYamlSerializer, AgeSealedChecksEncryptor, GitFastImportWriter, PublicRemotePushGuard |
| 187 | local-port:task-187 | OrphanBranchRehydrator, PortableZipArchiveManager, CrossDeviceLeaseManager, LostKeyOracleRegenerator |
| 188 | local-port:task-188 | GlobalMultiProjectBroker, WeightedFairQueueArbiter, CrossProjectGrantLeaseManager, MachineWideSlotCoordinator |
| 189 | local-port:task-189 | MetaLabBenchmarkRegistry, FrozenSuiteIntegrityLoader, PromptContaminationScanner, GradeResult |
| 190 | local-port:task-190 | ScriptedRegressionSimDev, HiddenSpecPersonaSimDev, AnonymizedSessionReplayer, ExactInputModelResponseCache, SimDevDriver |
| 191 | local-port:task-191 | ThreeLevelEvalRunner, PairedStatisticalPromotionEngine, McNemarAndBootstrapCalculator, ArtifactLifecycleManager |
| 192 | local-port:task-192 | FullDaemonFaultSimulator, TxBoundaryCrashInjector, ChaosInvariantOracle, MinimalFaultReproducerExporter |
| 193 | local-port:task-193 | RedTeamSecuritySuiteRunner, VaultCanaryLeakDetector, runRedTeamGate |
| 194 | local-port:task-194 | ArchitectureReviewTrialsSuite, ReviewTrialsCertificationReport |
| 195 | local-port:task-195 | FullLifecycleMultiProjectE2eSuite, CrossMilestoneIntegrationReport |
| 196 | local-port:task-196 | scripts/packaging/build-win-nsis.mjs, audit-asar.mjs, CleanMachineWinSmokeSuite |
| 197 | local-port:task-197 | scripts/verify-docs-diagrams.mjs, DocsAndSchemaParitySuite |
| 198 | local-port:task-198 | PerformanceAndScaleCertifier, ScaleBenchmarkScorecard |
| 199 | local-port:task-199 | FinalSecurityPrivacyAuditSuite, SecurityAuditCertificationReport |
