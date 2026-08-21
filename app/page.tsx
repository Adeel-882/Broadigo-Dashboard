import { connection } from "next/server";
import { DashboardApp } from "@/components/dashboard/DashboardApp";
import { getDashboardData } from "@/lib/dashboard-data";

export default async function Home() { await connection(); const data = await getDashboardData("This Week"); return <DashboardApp initialData={data}/>; }
