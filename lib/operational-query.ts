import { sql, type SQL } from "drizzle-orm";
import {
  DASHBOARD_TIMEZONE,
  SHIFT_END_TIME,
  SHIFT_START_TIME,
} from "@/lib/time-ranges";

const timezoneSql = sql.raw(`'${DASHBOARD_TIMEZONE}'`);
const shiftStartSql = sql.raw(`time '${SHIFT_START_TIME}'`);
const shiftEndSql = sql.raw(`time '${SHIFT_END_TIME}'`);

export const occurredAt = (qualifiedName: string) => sql.raw(qualifiedName);

export const operationalDateSql = (column: SQL) =>
  sql`timezone(${timezoneSql}, ${column})::date`;

export const operationalShiftFilter = (column: SQL, start: string, end: string) => sql`(
  ${column} >= ${start} and ${column} < ${end}
  and (timezone(${timezoneSql}, ${column})::time >= ${shiftStartSql}
    and timezone(${timezoneSql}, ${column})::time < ${shiftEndSql})
)`;
