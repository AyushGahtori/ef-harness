import type { PlannedMount, RouteMount, SeamContext, SeamFailure, SeamJourney, WiringEffects } from "./types.js";

function emptyEffects(): WiringEffects {
  return { dbKey: null, dbValue: null, mailTo: null, mailSubject: null, mailBody: null };
}

export function mountFromPlan(plan: PlannedMount): RouteMount {
  const effects = plan.effects ?? emptyEffects();
  return {
    method: plan.method,
    path: plan.path,
    taskId: plan.taskId,
    handler(ctx, body) {
      if (effects.dbKey && effects.dbValue) ctx.db.set(effects.dbKey, effects.dbValue);
      if (effects.mailSubject) {
        ctx.inbox.push({
          to: effects.mailTo ?? "kitchen@example.test",
          subject: effects.mailSubject,
          body: effects.mailBody ?? "",
        });
      }
      return { status: 200, body: { path: plan.path, task: plan.taskId, request: body ?? null } };
    },
  };
}

export function isNearMiss(mounted: string, expected: string): boolean {
  if (mounted === expected) return false;
  return expected.startsWith(mounted) || mounted.startsWith(expected);
}

export function executeSeamJourney(mounts: readonly RouteMount[], journey: SeamJourney): SeamFailure | null {
  const ctx: SeamContext = { db: new Map(), inbox: [] };
  for (const step of journey.steps) {
    if (step.kind === "http") {
      const mount = mounts.find((item) => item.method === step.method && item.path === step.path);
      if (!mount) {
        const sameMethod = mounts.filter((item) => item.method === step.method);
        const near = sameMethod.find((item) => isNearMiss(item.path, step.path)) ?? null;
        const mountedList = sameMethod.map((item) => item.path).join(", ") || "(none)";
        const detail = near
          ? `${step.expectingTask} expects ${step.path} while ${near.taskId} mounted ${near.path}`
          : `${step.expectingTask} expects ${step.method} ${step.path} but the mounted paths are ${mountedList}`;
        return {
          journeyId: journey.id,
          templateId: journey.templateId,
          detail,
          expectedPath: step.path,
          mountedPath: near?.path ?? null,
          expectingTask: step.expectingTask,
          mountedTask: near?.taskId ?? null,
        };
      }
      const response = mount.handler(ctx, step.body);
      if (response.status !== step.expectStatus) {
        return {
          journeyId: journey.id,
          templateId: journey.templateId,
          detail: `${step.method} ${step.path} returned ${response.status}, expected ${step.expectStatus}`,
          expectedPath: step.path,
          mountedPath: step.path,
          expectingTask: step.expectingTask,
          mountedTask: mount.taskId,
        };
      }
      if (step.expectBodyIncludes) {
        const body = JSON.stringify(response.body);
        if (!body.includes(step.expectBodyIncludes)) {
          return {
            journeyId: journey.id,
            templateId: journey.templateId,
            detail: `${step.path} body did not include ${step.expectBodyIncludes}`,
            expectedPath: step.path,
            mountedPath: step.path,
            expectingTask: step.expectingTask,
            mountedTask: mount.taskId,
          };
        }
      }
      continue;
    }
    if (step.kind === "db") {
      if (ctx.db.get(step.key) !== step.expectValue) {
        return {
          journeyId: journey.id,
          templateId: journey.templateId,
          detail: `local db key ${step.key} was ${ctx.db.get(step.key) ?? "missing"}, expected ${step.expectValue}`,
          expectedPath: null,
          mountedPath: null,
          expectingTask: null,
          mountedTask: null,
        };
      }
      continue;
    }
    const mail = ctx.inbox.find((message) => message.subject.includes(step.expectSubjectIncludes));
    if (!mail) {
      return {
        journeyId: journey.id,
        templateId: journey.templateId,
        detail: `mailbox has no message including ${step.expectSubjectIncludes}`,
        expectedPath: null,
        mountedPath: null,
        expectingTask: null,
        mountedTask: null,
      };
    }
  }
  return null;
}
