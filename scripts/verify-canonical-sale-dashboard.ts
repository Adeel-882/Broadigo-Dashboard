/** Read-only acceptance across the real dashboard query paths. */
import {createRequire,registerHooks} from 'node:module';
import assert from 'node:assert/strict';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
registerHooks({resolve(specifier,context,next){return specifier==='server-only'?{url:'data:text/javascript,export{}',shortCircuit:true}:next(specifier,context);}});
const {getDashboardData,getEmployeeDetail,searchDashboardActivities}=await import('../lib/dashboard-data');
const {closeDb}=await import('../lib/db/client');
const {default:postgres}=await import('postgres');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
try {
  for(const example of [
    {employee:'Dameon Wolfe',customer:'Nancy Waite',day:'2026-11-23',amount:800},
    {employee:'Jordan Reid',customer:'Mary Peyton',day:'2026-10-08',amount:699},
  ]) {
    const data=await getDashboardData('Custom Range',example.day,example.day);
    const employee=data.employees.find(e=>e.name===example.employee);assert.ok(employee);
    const detail=await getEmployeeDetail(employee.id,'Custom Range',example.day,example.day);
    const sales=detail.activities.filter(a=>a.type==='Sale'&&a.summary===example.customer);
    assert.equal(sales.length,1);
    const search=await searchDashboardActivities(example.customer,'Custom Range',example.day,example.day);
    assert.equal(search.filter(a=>a.type==='Sale').length,1);
    const [expected]=await db`select count(*)::int n,coalesce(sum(amount),0)::float revenue from canonical_sales where employee_id=${employee.id} and occurred_at>=${data.range.start} and occurred_at<${data.range.end}`;
    assert.equal(detail.targetProgress?.closedSales,expected.n);
    assert.equal(detail.targetProgress?.revenue,expected.revenue);
    assert.equal(employee.metricValueNumber,expected.revenue);
    assert.equal(detail.trend.reduce((sum,p)=>sum+p.value,0),expected.revenue);
    const [company]=await db`select count(*)::int n,coalesce(sum(amount),0)::float revenue from canonical_sales where occurred_at>=${data.range.start} and occurred_at<${data.range.end}`;
    assert.equal(Number(data.metrics.find(m=>m.kind==='sales')?.value),company.n);
    assert.equal(Number(data.metrics.find(m=>m.kind==='revenue')?.value.replace(/[^\d.-]/g,'')),company.revenue);
    for(const team of data.teams.filter(t=>t.name.endsWith('Sales'))) {
      const [expectedTeam]=await db`select coalesce(sum(amount),0)::float revenue from canonical_sales where team_id=${team.id} and occurred_at>=${data.range.start} and occurred_at<${data.range.end}`;
      assert.equal(Number(team.metric.replace(/[^\d.-]/g,'')),expectedTeam.revenue);
    }
    console.log(JSON.stringify({...example,employeeSales:expected.n,employeeRevenue:expected.revenue,evidenceEntries:sales.length,searchEntries:search.length,trend:detail.trend,company,teamRevenueVerified:true,qualification:detail.targetProgress}));
  }
} finally {await db.end({timeout:5});await closeDb();}
