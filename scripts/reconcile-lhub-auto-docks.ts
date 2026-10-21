import {createRequire} from 'node:module';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {sql}=await import('drizzle-orm');
const {autoDockDb,resultRows,evaluateBusinessDay,readAutoDockSettings}=await import('../lib/auto-docks/service');
const {syncCallDay}=await import('../lib/auto-docks/call-coverage');
const {latestClosedBusinessDate}=await import('../lib/auto-docks/policy');
const {closeDb}=await import('../lib/db/client');
const {mkdir,writeFile,readFile}=await import('node:fs/promises');
const args=process.argv.slice(2),db=autoDockDb();
const tables=['docks','dock_recipients','sales','leads','employees','employee_team_memberships','targets','attendance_messages','attendance_coverage'];
try{
  const settings=await readAutoDockSettings();
  if(args.includes('--snapshot')){
    const snapshot:Record<string,unknown>={};
    for(const table of tables)snapshot[table]=resultRows(await db.execute(sql.raw(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) hash from ${table} t`)));
    snapshot.appointments=resultRows(await db.execute(sql`select count(*) n,md5(string_agg(to_jsonb(a)::text,'' order by to_jsonb(a)::text)) hash from appointments a join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id where c.slack_channel_id<>'C0BADNJL14L'`));
    await mkdir('outputs',{recursive:true});
    if(args.includes('--after')){const before=JSON.parse(await readFile('outputs/lhub-protected-before.json','utf8'));console.log('PROTECTED_MATCH',JSON.stringify(before)===JSON.stringify(snapshot));if(JSON.stringify(before)!==JSON.stringify(snapshot))throw new Error('Protected data changed; inspect before continuing');}
    else await writeFile('outputs/lhub-protected-before.json',JSON.stringify(snapshot,null,2));
    console.log(JSON.stringify(snapshot));
  }else if(args.includes('--prepare')){
    await db.transaction(async tx=>{
      await tx.execute(sql`update auto_dock_settings set enabled=false,updated_at=now() where id=1`);
      await tx.execute(sql`insert into slack_channels(workspace_id,slack_channel_id,name,parser_type,active) values(${settings.workspaceId},'C0BADNJL14L','sdg-lhub-general','leadsedge-appointment',true) on conflict(workspace_id,slack_channel_id) do nothing`);
    });console.log('Financial evaluation paused during coverage backfill. Third channel configured without inferring a team.');
  }else if(args.includes('--assign-team')){
    await db.transaction(async tx=>{
      const matches=resultRows(await tx.execute(sql`select id from teams where name='LeadsEdge Real Estate'`));
      if(matches.length!==1)throw new Error('Expected exactly one confirmed LeadsEdge Real Estate team');
      const teamId=String(matches[0].id);
      const channel=resultRows(await tx.execute(sql`update slack_channels set team_id=${teamId}::uuid where workspace_id=${settings.workspaceId} and slack_channel_id='C0BADNJL14L' returning id`));
      if(channel.length!==1)throw new Error('Expected exactly one configured third channel');
      const changed=resultRows(await tx.execute(sql`update appointments a set team_id=${teamId}::uuid from slack_messages sm where a.slack_message_id=sm.id and sm.channel_id=${String(channel[0].id)}::uuid and a.team_id is distinct from ${teamId}::uuid returning a.id`));
      console.log(JSON.stringify({channel:'C0BADNJL14L',team:'LeadsEdge Real Estate',appointmentsUpdated:changed.length}));
    });
  }else if(args.includes('--resume')){
    await db.execute(sql`update auto_dock_settings set enabled=true,updated_at=now() where id=1`);console.log('Existing automatic schedule resumed.');
  }else{
    const last=args.includes('--sync')?new Date(Date.parse(latestClosedBusinessDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10):latestClosedBusinessDate();
    const results=[];
    for(let date='2026-10-16';date<=last;date=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
      const r=args.includes('--sync')?await syncCallDay(date,args.includes('--apply')):await evaluateBusinessDay(date,args.includes('--apply'));
      results.push(r);console.log(JSON.stringify({...r,...('evaluations'in r?{evaluations:undefined}:{})}));
    }
    await mkdir('outputs',{recursive:true});await writeFile(`outputs/lhub-${args.includes('--sync')?'sync':'reconciliation'}-${args.includes('--apply')?'applied':'dry'}${args.includes('--second')?'-second':''}.json`,JSON.stringify(results,null,2));
  }
}finally{await closeDb();}
