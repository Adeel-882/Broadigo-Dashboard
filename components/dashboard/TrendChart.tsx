"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/types/dashboard";

export function TrendChart({data,label="Appointments"}:{data:TrendPoint[];label?:string}) {
  const gradientId=useId().replaceAll(":","");
  if(!data.length)return <div className="chart-empty">No {label.toLowerCase()} in this period.</div>;
  return <ResponsiveContainer width="100%" height={270}><AreaChart data={data} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--le-red)" stopOpacity={.32}/><stop offset="100%" stopColor="var(--le-red)" stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid vertical={false} stroke="var(--le-chart-grid)" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "var(--le-text-muted)", fontSize: 11 }} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--le-text-muted)", fontSize: 11 }}/>
    <Tooltip contentStyle={{ background: "var(--le-bg-elevated)", border: "1px solid var(--le-red-border)", borderRadius: 12, boxShadow: "0 18px 40px rgba(0,0,0,.42)" }} labelStyle={{ color: "var(--le-text-secondary)" }} itemStyle={{ color: "var(--le-text-primary)" }}/>
    <Area type="monotone" dataKey="value" name={label} stroke="var(--le-red)" strokeWidth={2.2} fill={`url(#${gradientId})`} activeDot={{ r: 4, fill: "var(--le-red-hover)", stroke: "var(--le-red)", strokeWidth: 3 }}/>
  </AreaChart></ResponsiveContainer>;
}
