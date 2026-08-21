import type { Activity, Employee } from "@/types/dashboard";

export const employees: Employee[] = [
  { id: "mohib", name: "Mohib", initials: "MO", title: "Chief Executive Officer", teams: ["Leadership"], divisions: ["Company"], leadership: "CEO", rankingEnabled: false, status: "No Target", metricLabel: "Leadership activity", metricValue: "8 updates" },
  { id: "adil", name: "Adil Mehmood", initials: "AM", title: "Chief Operating Officer", aliases: ["Cody"], teams: ["Leadership", "Media Operations"], divisions: ["Broadigo Media"], leadership: "COO", rankingEnabled: false, status: "No Target", metricLabel: "Operational updates", metricValue: "12" },
  { id: "taha", name: "Taha Mujuddadi", initials: "TM", title: "Chief Technology Officer", teams: ["Leadership", "Media Operations"], divisions: ["Broadigo Media"], leadership: "CTO", rankingEnabled: false, status: "No Target", metricLabel: "Technical updates", metricValue: "14" },
  { id: "jordan-jones", name: "Jordan Jones", initials: "JJ", title: "Appointment Setter · Hybrid Media", teams: ["Broadigo Real Estate", "Media Sales Development"], divisions: ["Real Estate", "Broadigo Media"], rankingEnabled: true, status: "Ahead", completion: 118, metricLabel: "Appointments", metricValue: "42", trend: 12 },
  { id: "cade", name: "Cade Callahan", initials: "CC", title: "Closer · Hybrid Media", teams: ["Broadigo Sales", "Media Operations"], divisions: ["Real Estate", "Broadigo Media"], rankingEnabled: true, status: "On Track", completion: 96, metricLabel: "Revenue", metricValue: "$18.4k", trend: 8 },
  { id: "derek", name: "Derek Reed", initials: "DR", title: "Appointment Setter · Hybrid Media", aliases: ["Arham"], teams: ["LeadsEdge Real Estate", "Media Sales Development"], divisions: ["Real Estate", "Broadigo Media"], rankingEnabled: true, status: "At Risk", completion: 76, metricLabel: "Appointments", metricValue: "28", trend: -9 },
  { id: "lena", name: "Lena Cross", initials: "LC", title: "LeadsEdge Closer", teams: ["LeadsEdge Sales"], divisions: ["Real Estate"], rankingEnabled: true, status: "Ahead", completion: 124, metricLabel: "Revenue", metricValue: "$23.8k", trend: 16 },
  { id: "zack", name: "Zack Wilson", initials: "ZW", title: "Broadigo Closer", teams: ["Broadigo Sales"], divisions: ["Real Estate"], rankingEnabled: true, status: "On Track", completion: 101, metricLabel: "Sales", metricValue: "9", trend: 3 },
  { id: "caleb", name: "Caleb Ford", initials: "CF", title: "LeadsEdge Appointment Setter", teams: ["LeadsEdge Real Estate"], divisions: ["Real Estate"], rankingEnabled: true, status: "Behind", completion: 58, metricLabel: "Appointments", metricValue: "19", trend: -21 },
  { id: "asif", name: "Asif Hazoor", initials: "AH", title: "Inside Sales Agent", teams: ["ISA / Lead Management"], divisions: ["Lead Management"], rankingEnabled: true, status: "Ahead", completion: 112, metricLabel: "Leads", metricValue: "31", trend: 10 },
  { id: "alishba", name: "Alishba Ali", initials: "AA", title: "Inside Sales Agent", teams: ["ISA / Lead Management"], divisions: ["Lead Management"], rankingEnabled: true, status: "On Track", completion: 92, metricLabel: "Leads", metricValue: "25", trend: 4 },
  { id: "adeel", name: "Adeel Ahmed", initials: "AD", title: "Media Operations", teams: ["Media Operations"], divisions: ["Broadigo Media"], rankingEnabled: false, status: "No Target", metricLabel: "Work updates", metricValue: "18", trend: 6 },
  { id: "ahmad", name: "Ahmad Ul Huda", initials: "AU", title: "Media Operations", teams: ["Media Operations"], divisions: ["Broadigo Media"], rankingEnabled: false, status: "No Target", metricLabel: "Work updates", metricValue: "15", trend: 2 },
];

export const activities: Activity[] = [
  { id: "a1", employeeId: "jordan-jones", employee: "Jordan Jones", type: "Appointment", summary: "Appointment booked with Pinecrest Realty", detail: "Florida · Aug 19, 11:00 AM EST · assigned to Dean Scott", channel: "broadigo-sale-development-general", timestamp: "Today, 3:42 PM", raw: "Appointment Setter: Jordan Jones\nProspect: Pinecrest Realty\nPhone: +1 (555) 019-2048\nState: FL\nDate: Aug 19\nTime: 11:00 AM EST\nAssigned: Dean Scott" },
  { id: "a2", employeeId: "lena", employee: "Lena Cross", type: "Sale", summary: "Professional plan sold · $4,200", detail: "Client in Texas · 3 ZIP codes", channel: "sales-reporting", timestamp: "Today, 2:18 PM", raw: "Closer: Lena Cross\nClient: Redstone Realty Group\nPlan: Professional\nRevenue: $4,200\nState: TX\nZIPs: 75001, 75006, 75007" },
  { id: "a3", employeeId: "asif", employee: "Asif Hazoor", type: "Lead", summary: "Seller lead reported in Arizona", detail: "Single family · 60–90 day timeline", channel: "leads-reporting", timestamp: "Today, 1:54 PM", raw: "ISA: Asif Hazoor\nType: Seller\nProperty: Single family\nState: AZ\nTimeline: 60-90 days\nFinancing: N/A" },
  { id: "a4", employeeId: "cade", employee: "Cade Callahan", type: "Work update", summary: "Client analytics automation shipped", detail: "Explicitly marked complete · Media Operations", channel: "broadigo-media", timestamp: "Today, 12:36 PM", raw: "Completed the analytics automation for the client workspace. QA passed and handoff notes are in the project folder." },
  { id: "a5", employeeId: "caleb", employee: "Caleb Ford", type: "Dock", summary: "Dock reported · PKR 2,500", detail: "Late attendance · applied by Operations", channel: "docks-reporting", timestamp: "Yesterday, 6:12 PM", raw: "Employee: Caleb Ford\nAmount: PKR 2,500\nReason: Late attendance\nApplied by: Operations\nDate: 2026-08-18" },
];

export const trendData = [
  { day: "Aug 13", appointments: 18, sales: 3, leads: 11 },
  { day: "Aug 14", appointments: 24, sales: 5, leads: 14 },
  { day: "Aug 15", appointments: 22, sales: 4, leads: 13 },
  { day: "Aug 16", appointments: 31, sales: 6, leads: 17 },
  { day: "Aug 17", appointments: 27, sales: 5, leads: 16 },
  { day: "Aug 18", appointments: 36, sales: 8, leads: 20 },
  { day: "Aug 19", appointments: 42, sales: 9, leads: 24 },
];

export const divisions = [
  { name: "Broadigo Media", eyebrow: "Operations + media sales", value: "47", label: "meaningful activities", change: 8, accent: "violet", progress: 82 },
  { name: "Real Estate", eyebrow: "Broadigo + LeadsEdge", value: "$86.4k", label: "reported sales revenue", change: 14, accent: "cyan", progress: 91 },
  { name: "Lead Management", eyebrow: "ISA reporting", value: "73", label: "qualified leads reported", change: 6, accent: "amber", progress: 88 },
];
