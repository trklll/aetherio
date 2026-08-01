// Helpers de tests: D1 en memoria (node:sqlite) + construcción de entornos.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { ImportEnv } from "../import";

export class SqliteD1 {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const name of ["0008_awards.sql", "0009_awards_history.sql", "0010_work_key_year.sql"]) {
      const migrationUrl = new URL(`../../../migrations/${name}`, import.meta.url);
      this.db.exec(readFileSync(migrationUrl, "utf8"));
    }
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    const params = (...args: unknown[]) => args as never[];
    return {
      bind: (...args: unknown[]) => ({
        _sql: sql,
        _args: args,
        all: <T = Record<string, unknown>>() => ({ results: stmt.all(...params(...args)) as unknown as T[] }),
        first: <T = Record<string, unknown>>() => (stmt.get(...params(...args)) ?? null) as T | null,
        run: () => {
          const info = stmt.run(...params(...args));
          return {
            success: true,
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
          };
        },
      }),
    };
  }

  /** Equivalente atómico a D1.batch: ejecuta las sentencias en una transacción. */
  batch(statements: Array<{ _sql: string; _args: unknown[] }>) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        const info = this.db.prepare(statement._sql).run(...(statement._args as never[]));
        results.push({ success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
      }
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  close() {
    this.db.close();
  }
}

/** Entorno de importación con D1 en memoria y sin credenciales externas. */
export function makeEnv(): ImportEnv {
  return {
    AWARDS_DB: new SqliteD1() as unknown as ImportEnv["AWARDS_DB"],
    TMDB_API_KEY: undefined,
    ANILIST_CLIENT_ID: undefined,
  };
}

export interface StubFetchRoute {
  url: string;
  html: string;
}

/** Reemplaza fetch global devolviendo los HTML registrados por URL. */
export function stubHtmlFetch(routes: StubFetchRoute[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes.find(item => url === item.url);
    if (!route) {
      return new Response(`NOT FOUND: ${url}`, { status: 404 });
    }
    return new Response(route.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
