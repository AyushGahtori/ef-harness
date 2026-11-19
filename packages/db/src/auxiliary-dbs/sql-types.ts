export type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export type SqlRow = Record<string, SqlValue | undefined>;
