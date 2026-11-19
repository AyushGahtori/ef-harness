export const PORT_MIN = 41000;
export const PORT_MAX = 48999;
export const LOOPBACK_HOST = "127.0.0.1";
export const TEMPLATE_DATABASE = "tpl_spike";
export const ENV_DATABASES = ["env_1", "env_2"] as const;
export const CLONE_TARGET_MS = 1000;
export const REDIS_DATABASE_COUNT = 16;
export const POSTGRES_USER = "spike";

export const POSTGRES_TEMPLATE_CLONE_SQL = [
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'tpl_spike' AND pid <> pg_backend_pid()",
  "UPDATE pg_database SET datallowconn = false WHERE datname = 'tpl_spike'",
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'tpl_spike' AND pid <> pg_backend_pid()",
  "CREATE DATABASE env_1 TEMPLATE tpl_spike",
  "CREATE DATABASE env_2 TEMPLATE tpl_spike",
].join(";\n");

export const MAILPIT_ROUTES = {
  info: "/api/v1/info",
  search: "/api/v1/search",
  messages: "/api/v1/messages",
  message: "/api/v1/message/{id}",
} as const;

export const READINESS_PROBES = {
  postgres: "TCP 127.0.0.1:<port> then SELECT 1 via psql",
  redis: "TCP 127.0.0.1:<port> then PING",
  mailpit: "GET http://127.0.0.1:<httpPort>/api/v1/info",
  oauth: "GET http://127.0.0.1:<port>/env1/.well-known/openid-configuration",
} as const;
