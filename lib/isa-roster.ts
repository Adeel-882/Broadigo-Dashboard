export const CURRENT_ISA_ROSTER = [
  { realName: "Asif Hazoor", pseudoName: "Eric Williams", email: "ericwilliams@leadsedge.us", slackUserId: "U09SWT3TV1A" },
  { realName: "Syed Ali Jan", pseudoName: "Steve Coulston", email: "stevecoulston@leadsedge.us", slackUserId: "U0A8J59LA4T" },
  { realName: "Alishba Zareh", pseudoName: "Lizbert", email: "lizbert@leadsedge.us", slackUserId: "U0APMS0NZ2P" },
  { realName: "Aishah Arif", pseudoName: "Ella Johnson", email: "ellajohnson@leadsedge.us", slackUserId: "U0AL9CT9FME" },
  { realName: "Muhammad Eman", pseudoName: "Justin Clay", email: "adamgrant@leadsedge.us", slackUserId: "U09T0AHBG3Z" },
  { realName: "Saad Ali", pseudoName: "Christian Knight", email: "mikeweston@leadsedge.us", slackUserId: "U0A30C959J6" },
  { realName: "Dilshad Ullah Danish", pseudoName: "David Klein", email: "rickjohnson@leadsedge.us", slackUserId: "U09DT31C69E" },
  { realName: "Muhammad Zeeshan", pseudoName: "Brian Adams", email: "brianadams@leadsedge.us", slackUserId: "U0B0C4K4C0M" },
  { realName: "Abdul Wali", pseudoName: "Oliver Smith", email: "oliversmith@leadsedge.us", slackUserId: "U0C5WKB1GKX" },
  { realName: "Nawal Tariq", pseudoName: "Emma James", email: "emmajames@leadsedge.us", slackUserId: "U0C65FR15Q9" },
] as const;

export const CURRENT_ISA_NAMES = new Set<string>(CURRENT_ISA_ROSTER.map((person) => person.realName));
