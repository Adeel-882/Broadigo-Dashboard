import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import {parserRegistry} from '../lib/parsers/registry';

/** Apply only a reviewed, source-specific manifest. Dry-run is the default. */
type Action={saleId:string;sourceHash:string;kind:'deleted'|'superseded'|'price';replacementSaleId?:string;amount?:number;deletedAt?:string|null;evidence:Record<string,unknown>};
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const path=process.argv.find(a=>a.startsWith('--manifest='))?.slice(11);
if(!path)throw new Error('Provide --manifest=path; add --apply only after reviewing the report.');
const actions=JSON.parse(readFileSync(path,'utf8')) as Action[];
const apply=process.argv.includes('--apply');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false,connect_timeout:15});
const changes:Record<string,unknown>[]=[];
try{
  await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(73171,1)`;
    for(const action of actions){
      if(!Object.keys(action.evidence??{}).length)throw new Error('Evidence is required');
      const [s]=await tx`select s.*,sm.raw_text,sm.workspace_id,sm.slack_ts,c.slack_channel_id,c.parser_type
        from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id
        where s.id=${action.saleId}::uuid for update of s,sm`;
      if(!s||createHash('sha256').update(s.raw_text).digest('hex')!==action.sourceHash)throw new Error('Source changed; regenerate the manifest');
      const evidence={...action.evidence,before:{saleId:s.id,amount:s.amount,employeeId:s.employee_id,teamId:s.team_id,occurredAt:s.occurred_at},sourceHash:action.sourceHash};
      if(action.kind==='deleted'){
        if(apply)await tx`insert into sale_source_deletions(workspace_id,channel_id,slack_ts,deleted_at,evidence)
          values(${s.workspace_id},${s.slack_channel_id},${s.slack_ts},${action.deletedAt??null},${tx.json(evidence)}) on conflict do nothing`;
      }else if(action.kind==='superseded'){
        const [replacement]=await tx`select s.id from canonical_sales s join slack_messages sm on sm.id=s.slack_message_id
          where s.id=${action.replacementSaleId!}::uuid and sm.workspace_id=${s.workspace_id} and s.employee_id=${s.employee_id}::uuid`;
        if(!replacement||replacement.id===s.id)throw new Error('Replacement must be a distinct active sale of the same employee/workspace');
        const [existing]=await tx`select replacement_sale_id from sale_source_resolutions where sale_id=${s.id}`;
        if(existing&&existing.replacement_sale_id!==replacement.id)throw new Error('Conflicting resolution');
        if(apply)await tx`insert into sale_source_resolutions(sale_id,replacement_sale_id,evidence)
          values(${s.id},${replacement.id},${tx.json(evidence)}) on conflict do nothing`;
      }else if(action.kind==='price'){
        const parsed=parserRegistry.parse(s.parser_type,{rawSourceId:s.slack_message_id,text:s.raw_text,postedAt:s.occurred_at});
        if(parsed?.recordType!=='SALE'||parsed.values.amount!==action.amount)throw new Error('Parser does not support proposed amount');
        if(s.amount!=null&&Number(s.amount)!==action.amount)throw new Error('Refusing to overwrite a recorded amount');
        if(apply)await tx`update sales set amount=${String(action.amount)},customer_name=coalesce(customer_name,${parsed.values.customerName as string|null}) where id=${s.id}`;
      }else throw new Error('Unknown correction kind');
      changes.push({saleId:s.id,sourceTs:s.slack_ts,kind:action.kind,beforeAmount:s.amount,afterAmount:action.amount??s.amount,evidence});
    }
  });
  writeFileSync(path.replace(/\.json$/,`.${apply?'applied':'dry-run'}.${Date.now()}.json`),JSON.stringify(changes,null,2),{flag:'wx'});
  console.log(JSON.stringify({applied:apply,actions:changes.map(({saleId,sourceTs,kind,beforeAmount,afterAmount})=>({saleId,sourceTs,kind,beforeAmount,afterAmount}))}));
}catch(error){console.error('Sale reconciliation failed:',error instanceof Error?error.message.split('\n')[0]:'unknown error');process.exitCode=1;}
finally{await db.end({timeout:5});}
