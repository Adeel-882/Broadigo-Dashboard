import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {sql}=await import("drizzle-orm");
const {autoDockDb,evaluateBusinessDay,resultRows}=await import("../lib/auto-docks/service");
const {syncAttendanceDay}=await import("../lib/auto-docks/attendance");
const {FIRST_APPROVED_BUSINESS_DATE,OBSERVED_CHECK_IN_PHRASES,businessWindow}=await import("../lib/auto-docks/policy");
const {closeDb}=await import("../lib/db/client");
const args=process.argv.slice(2);
const value=(key:string)=>{const index=args.indexOf(key);return index<0?undefined:args[index+1];};
try {
  if(args.includes("--configure")) {
    // Exact, recorded user approval. No financial rows created by setup.
    await autoDockDb().execute(sql`update auto_dock_settings set enabled=false,effective_from=${FIRST_APPROVED_BUSINESS_DATE}::date,attendance_reliable_from=${FIRST_APPROVED_BUSINESS_DATE}::date,approved_check_in_phrases=${JSON.stringify(OBSERVED_CHECK_IN_PHRASES)}::jsonb,approved_at=now(),updated_at=now() where id=1`);
    console.log("Configured prospective activation: October 16, first completed-day evaluation October 17 at 05:00 Asia/Karachi.");
  } else if(args.includes("--enable")) {
    await autoDockDb().execute(sql`update auto_dock_settings set enabled=true,updated_at=now() where id=1 and effective_from=${FIRST_APPROVED_BUSINESS_DATE}::date and attendance_reliable_from=${FIRST_APPROVED_BUSINESS_DATE}::date and approved_at is not null`);
    console.log("Prospective evaluation enabled; all date, completion and coverage guards remain enforced.");
  } else {
    const date=value("--date");if(!date)throw new Error("Specify --date YYYY-MM-DD (dry run), optionally --sync-attendance or --apply. Setup: --configure.");
    businessWindow(date);
    if(args.includes("--exempt")) {
      const employee=value("--employee"),reason=value("--reason");
      if(!employee||!reason)throw new Error("Exemption requires employee UUID and a reason");
      await autoDockDb().execute(sql`insert into auto_dock_exemptions(employee_id,business_date,reason) values(${employee}::uuid,${date}::date,${reason}) on conflict(employee_id,business_date) do update set reason=excluded.reason`);
      await autoDockDb().execute(sql`insert into auto_dock_pending(business_date) values(${date}::date) on conflict(business_date) do update set requested_at=now()`);
      console.log("Approved-leave exemption saved; reconciliation queued.");
    } else {
      if(args.includes("--sync-attendance"))console.log("Attendance snapshot",await syncAttendanceDay(date));
      const audit=await evaluateBusinessDay(date,args.includes("--apply"));
      console.log(JSON.stringify({...audit,evaluations:undefined}));
      console.table(audit.evaluations.map(e=>({employee:e.employee,role:e.role,attendance:e.attendanceStatus,observedCheckIn:e.checkInFound,bypass:!e.attendanceRequired,appointments:e.appointments,sales:e.sales,decision:e.decision,amount:e.amount})));
    }
  }
  console.log("RECONCILIATION",JSON.stringify(resultRows(await autoDockDb().execute(sql`select (select count(*) from docks) manual_sources,(select sum(d.amount*greatest(1,(select count(*) from dock_recipients dr where dr.dock_id=d.id))) from docks d) manual_total,(select count(*) from appointments) appointments,(select count(*) from sales) sales,(select sum(amount) from sales) revenue,(select count(*) from leads) leads,(select count(*) from employees) employees,(select count(*) from employee_team_memberships) memberships,(select count(*) from automatic_docks) automatic_records`))));
} finally {await closeDb();}
