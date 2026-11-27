import type { GlobalBrokerDb } from "../auxiliary-dbs/global-broker-db.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { BrokerGrantIssuer } from "./broker-grant-issuer.js";
import type { GrantMessageSink } from "./messages.js";
import { ProjectGrantReceiver } from "./project-grant-receiver.js";
import { GrantSqlSession } from "./session.js";

/**
 * Bind grant issuance to the open `GlobalBrokerDb` writer.
 * The returned issuer does not close that handle and never `ATTACH`es `state.db`.
 */
export function bindBrokerGrantIssuer(globalDb: GlobalBrokerDb, sink: GrantMessageSink): BrokerGrantIssuer {
  const session = GrantSqlSession.adopt("global", globalDb.filePath, globalDb.writer);
  return new BrokerGrantIssuer(session, sink);
}

/**
 * Bind grant deposit and closure to the open `ProjectStateDb` writer.
 * The returned receiver does not close that handle.
 */
export function bindProjectGrantReceiver(
  stateDb: ProjectStateDb,
  sink: GrantMessageSink,
  projectId: string,
): ProjectGrantReceiver {
  const session = GrantSqlSession.adopt("state", stateDb.databasePath, stateDb.writer);
  return new ProjectGrantReceiver(session, sink, projectId);
}
