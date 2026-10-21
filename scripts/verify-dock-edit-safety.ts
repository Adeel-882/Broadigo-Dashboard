import {createRequire} from 'node:module';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {default:postgres}=await import('postgres');
const {readFile,writeFile,mkdir}=await import('node:fs/promises');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
try{
  const result:Record<string,unknown>={};
  for(const table of ['automatic_docks','docks','dock_recipients','appointments','sales','leads','employees','employee_team_memberships','targets','attendance_messages','attendance_coverage']){
    result[table]=await db.unsafe(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) fingerprint from ${table} t`);
  }
  await mkdir('outputs',{recursive:true});
  if(process.argv.includes('--after')){
    const before=JSON.parse(await readFile('outputs/dock-edit-protected-before.json','utf8'));
    const changed=Object.keys(result).filter(k=>JSON.stringify(before[k])!==JSON.stringify(result[k]));
    console.log(JSON.stringify({protectedTables:Object.keys(result).length,changed}));
    await writeFile('outputs/dock-edit-protected-after.json',JSON.stringify(result,null,2));
    if(changed.length)process.exitCode=1;
  }else{await writeFile('outputs/dock-edit-protected-before.json',JSON.stringify(result,null,2));console.log('Protected-data baseline saved.');}
}finally{await db.end();}
