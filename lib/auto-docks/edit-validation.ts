export class DockEditError extends Error {
  constructor(message:string,public status=400){super(message);}
}
export function moneyAmount(value:unknown):string {
  // Decimal strings only: no exponent notation, rounding, NaN, or floating-point math.
  if(typeof value!=='string'||!/^\d{1,12}(\.\d{1,2})?$/.test(value))throw new DockEditError('Enter a non-negative amount with at most two decimal places.');
  const [whole,fraction='']=value.split('.');
  return `${BigInt(whole)}.${fraction.padEnd(2,'0')}`;
}
export function editReason(value:unknown,required=false){
  if(typeof value!=='string'||value.length>500|| (required&&!value.trim()))throw new DockEditError('Provide a reason of up to 500 characters.');
  return value.trim()||'Manual dashboard adjustment';
}
export function dockId(value:unknown):string{
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new DockEditError('Invalid automatic dock.');
  return value;
}
