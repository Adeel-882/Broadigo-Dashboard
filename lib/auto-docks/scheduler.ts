import { sql } from "drizzle-orm";
import { syncAttendanceDay } from "./attendance";
import { autoDockDb, evaluateBusinessDay, readAutoDockSettings, resultRows } from "./service";
import { FIRST_APPROVED_BUSINESS_DATE, latestClosedBusinessDate } from "./policy";

/** The queue is committed with structured activity, including historical imports.
 * A failed reconcile is retained for the next cron/retry, never silently lost. */
export async function reconcilePendingDays(limit=1) {
  const settings=await readAutoDockSettings();
  if(!settings.enabled||!settings.effectiveFrom)return [];
  const latest=latestClosedBusinessDate();
  const dates=resultRows(await autoDockDb().execute(sql`select business_date::text,requested_at::text from auto_dock_pending where business_date>=${FIRST_APPROVED_BUSINESS_DATE}::date and business_date>=${settings.effectiveFrom}::date and business_date<=${latest}::date order by business_date limit ${limit}`));
  const results=[];
  for(const row of dates){
    const date=String(row.business_date);
    try {
    await syncAttendanceDay(date);
    const result=await evaluateBusinessDay(date,true);
    // Leave changes committed during the snapshot/evaluation queued for a retry.
    await autoDockDb().execute(sql`delete from auto_dock_pending where business_date=${date}::date and requested_at<=${String(row.requested_at)}::timestamptz`);
    console.info("[auto-dock]",JSON.stringify({date,evaluated:result.evaluated,created:result.created,existing:result.existing,voided:result.voided}));
    results.push({date,evaluated:result.evaluated,created:result.created,existing:result.existing,voided:result.voided});
    } catch {
      await autoDockDb().execute(sql`insert into auto_dock_runs(business_date,status,completed_at,error) values(${date}::date,'FAILED',now(),'Attendance snapshot or reconciliation failed; pending date retained')`);
      throw new Error(`Automatic dock reconciliation failed for ${date}; pending date retained`);
    }
  }
  return results;
}

export async function runDailyAutoDocks(){
  const settings=await readAutoDockSettings();
  if(!settings.enabled||!settings.effectiveFrom)return {enabled:false,results:[]};
  const start=settings.effectiveFrom<FIRST_APPROVED_BUSINESS_DATE?FIRST_APPROVED_BUSINESS_DATE:settings.effectiveFrom;
  const latest=latestClosedBusinessDate();
  // Catch up missed executions, not merely yesterday. Older completed dates are
  // revisited only when their evidence changes (durable queue).
  if(start<=latest)await autoDockDb().execute(sql`insert into auto_dock_pending(business_date)
    select d::date from generate_series(${start}::date,${latest}::date,interval '1 day') d
    where not exists(select 1 from auto_dock_runs r where r.business_date=d::date and r.status='COMPLETED')
    on conflict(business_date) do nothing`);
  return {enabled:true,results:await reconcilePendingDays(3)};
}
