import {describe,it,expect} from "vitest";
import {PgDialect} from "drizzle-orm/pg-core";
import {occurredAt,calendarDateSql,calendarTimestampFilter} from "./operational-query";
import {resolveDateRange} from "./time-ranges";
const dialect=new PgDialect();
describe("shared reporting SQL",()=>{
  it("uses the Central calendar date without the old overnight subtraction",()=>{
    const {sql}=dialect.sqlToQuery(calendarDateSql(occurredAt("l.occurred_at")));
    expect(sql).toContain("'America/Chicago'");
    expect(sql).not.toContain("interval");
  });
  it.each(["2026-03-08","2026-11-01","2026-10-12"])("uses only an index-friendly calendar timestamp predicate for %s",date=>{
    const r=resolveDateRange("Custom Range",date,date);
    const query=dialect.sqlToQuery(calendarTimestampFilter(occurredAt("l.occurred_at"),r.start.toISOString(),r.end.toISOString()));
    expect(query.params).toEqual([r.start.toISOString(),r.end.toISOString()]);
    expect(query.sql).toBe("(l.occurred_at >= $1 and l.occurred_at < $2)");
    expect(query.sql).not.toMatch(/\bor\b/i);
  });
});
