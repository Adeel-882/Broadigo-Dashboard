# October 2026 lead reconciliation

Authorized source: the explicit October matrix in the management request. The available local workbook contains only Sheet1; it is not used as the October oracle. Muhammad Fasial is excluded from repair by explicit user instruction.

## Before repair

Root cause: Asif's Mervat lead is a separate source (`1791843228.130579`, lead `4c2f4ea0-ac89-4114-9dc6-91aeb879638b`) posted October 13 at 03:13 PKT and ingested immediately. Current complete Slack history omits it and `reactions.get` returns `message_not_found`. The deletion subtype was ignored, so the retained record remained countable. It is not the October 2 Alishba source (`1790958602.271949`, lead `d8b611a1-07ea-4a38-829b-e4049b6ce9d6`), which remains correctly owned, dated and X-excluded. No observed source-date drift or duplicate Slack-source keys. Exact deletion time is unavailable: the old diagnostic route recorded delivery timestamps without deleted_ts.

The roster update changed current Slack account mappings without repairing already-ingested October records. Reprocessing intentionally preserves old stored ownership to protect history. The repair is therefore restricted to the explicitly approved October dates and author mappings; it never bulk-remaps earlier history or formal memberships. Current message edits now retain stored lead ownership when the parent author is unchanged.

Status: additive migration 0010 and all 88 explicitly approved corrections applied. The first connection closed and its transaction rolled back; verification found all 88 still pending before the successful retry. A fresh Slack-backed dry-run now reports zero pending corrections, zero wrong-date records, zero duplicate source keys and zero missing eligible sources. All 100 in-scope employee/date cells match the supplied matrix exactly. Muhammad Fasial's two nonzero cells remain deferred by user instruction. No workbook was edited.

In the before-repair table below, every non-deferred row now has Counted equal to Expected and Delta zero. The original values are retained to make the correction auditable.

## Team totals after repair

Before totals are reconstructed from the retained before-state audit using the same effective ISA membership and 19:00–05:00 reporting rule. Sheet totals include Muhammad Fasial; scoped totals exclude his deferred entries.

| October date | Before | After | Sheet | Sheet excluding Fasial |
| --- | ---: | ---: | ---: | ---: |
| 1 | 15 | 16 | 16 | 16 |
| 2 | 12 | 14 | 15 | 14 |
| 5 | 11 | 13 | 13 | 13 |
| 6 | 10 | 10 | 10 | 10 |
| 7 | 12 | 14 | 14 | 14 |
| 8 | 15 | 16 | 16 | 16 |
| 9 | 11 | 16 | 16 | 16 |
| 12 | 10 | 10 | 10 | 10 |
| 13 | 13 | 14 | 14 | 14 |
| 14 | 17 | 17 | 18 | 17 |

## Safety and verification

- 2,162 structured lead records before and after; no lead insertion or deletion.
- 88 before/after audit entries: 75 stale-owner repairs, 12 previously unmapped owners, one source-unavailable exclusion.
- 111 sales and USD 121,400 revenue unchanged, including full-row fingerprints.
- 234 manual docks, 291 recipient records and all employee/membership rows have unchanged fingerprints. Automatic docks remain zero; attendance and automatic-dock configuration/evaluation rows are unchanged.
- Original 1,693 appointment records have exactly the same fingerprint. One new live appointment arrived independently during verification (1,694 total).
- TypeScript and ESLint passed; 409 unit tests passed with six opt-in/pre-existing skips. The lead lifecycle integration test additionally passed against isolated temporary tables, including the final history/deletion serialization guard. Production build passed.
- Browser automation could not initialize (missing local kernel asset path), so authenticated visual production verification is not claimed.

## Before-repair employee mismatches

| Date | Employee | Expected | Counted | Delta | Classification | Records to correct (including excluded) |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| 2026-10-02 | Muhammad Fasial | 1 | 0 | -1 | Deferred by user | 0 |
| 2026-10-14 | Muhammad Fasial | 1 | 0 | -1 | Deferred by user | 0 |
| 2026-10-12 | Asif Hazoor | 3 | 4 | 1 | OTHER_PROVEN_CAUSE: unavailable source | 1 |
| 2026-10-01 | Muhammad Zeeshan | 2 | 0 | -2 | WRONG_EMPLOYEE | 5 |
| 2026-10-02 | Muhammad Zeeshan | 2 | 0 | -2 | WRONG_EMPLOYEE | 4 |
| 2026-10-05 | Muhammad Zeeshan | 2 | 0 | -2 | WRONG_EMPLOYEE | 3 |
| 2026-10-06 | Muhammad Zeeshan | 3 | 0 | -3 | WRONG_EMPLOYEE | 4 |
| 2026-10-08 | Muhammad Zeeshan | 2 | 0 | -2 | WRONG_EMPLOYEE | 5 |
| 2026-10-09 | Muhammad Zeeshan | 2 | 0 | -2 | WRONG_EMPLOYEE | 2 |
| 2026-10-13 | Muhammad Zeeshan | 2 | 0 | -2 | WRONG_EMPLOYEE | 4 |
| 2026-10-01 | Saad Ali | 1 | 0 | -1 | WRONG_EMPLOYEE | 3 |
| 2026-10-02 | Saad Ali | 1 | 0 | -1 | WRONG_EMPLOYEE | 1 |
| 2026-10-05 | Saad Ali | 2 | 0 | -2 | WRONG_EMPLOYEE | 2 |
| 2026-10-07 | Saad Ali | 2 | 0 | -2 | WRONG_EMPLOYEE | 4 |
| 2026-10-09 | Saad Ali | 3 | 0 | -3 | WRONG_EMPLOYEE | 3 |
| 2026-10-13 | Saad Ali | 1 | 0 | -1 | WRONG_EMPLOYEE | 1 |
| 2026-10-01 | Muhammad Eman | 3 | 0 | -3 | WRONG_EMPLOYEE | 3 |
| 2026-10-02 | Muhammad Eman | 3 | 0 | -3 | WRONG_EMPLOYEE | 3 |
| 2026-10-08 | Muhammad Eman | 2 | 0 | -2 | WRONG_EMPLOYEE | 2 |
| 2026-10-09 | Muhammad Eman | 2 | 0 | -2 | WRONG_EMPLOYEE | 4 |
| 2026-10-13 | Muhammad Eman | 1 | 0 | -1 | WRONG_EMPLOYEE | 3 |
| 2026-10-01 | Dilshad Ullah Danish | 2 | 0 | -2 | WRONG_EMPLOYEE | 2 |
| 2026-10-05 | Dilshad Ullah Danish | 1 | 0 | -1 | WRONG_EMPLOYEE | 2 |
| 2026-10-06 | Dilshad Ullah Danish | 2 | 0 | -2 | WRONG_EMPLOYEE | 2 |
| 2026-10-08 | Dilshad Ullah Danish | 1 | 0 | -1 | WRONG_EMPLOYEE | 4 |
| 2026-10-09 | Dilshad Ullah Danish | 1 | 0 | -1 | WRONG_EMPLOYEE | 1 |
| 2026-10-12 | Dilshad Ullah Danish | 3 | 0 | -3 | WRONG_EMPLOYEE | 3 |
| 2026-10-13 | Dilshad Ullah Danish | 1 | 0 | -1 | WRONG_EMPLOYEE | 2 |
| 2026-10-02 | Abdul Wali | 1 | 0 | -1 | IDENTITY_MAPPING_ERROR | 1 |
| 2026-10-08 | Abdul Wali | 1 | 0 | -1 | IDENTITY_MAPPING_ERROR | 1 |
| 2026-10-12 | Abdul Wali | 1 | 0 | -1 | IDENTITY_MAPPING_ERROR | 1 |
| 2026-10-09 | Nawal Tariq | 2 | 0 | -2 | IDENTITY_MAPPING_ERROR | 3 |

## Exact correction manifest

87 ownership corrections (75 stale, 12 unmapped) and one source-unavailable exclusion. Source dates are unchanged. Each application records original and corrected state in lead_reconciliation_audit. No fake leads, employee records, identity mappings or memberships are created.

| Date | Lead ID | Slack source | Previous employee | Correct employee | Reason |
| --- | --- | --- | --- | --- | --- |
| 2026-10-01 | c9b32fb2-a4f3-443b-b7a2-d60b3ce81d21 | 1790871630.308969 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | 0fed847b-60dd-476c-9de7-eae955d9da58 | 1790873550.589849 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | 8499399c-74ea-4d5d-aafc-18f37d1580b6 | 1790874570.232529 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | 01db95de-7514-43a6-851d-5cb5c94eae23 | 1790875820.987499 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | dec03b51-e90c-476c-a1cf-4c33bd21f5cd | 1790882824.107709 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | 3c9fc869-ebca-4898-b3ea-90d4b869e399 | 1790884622.963819 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | 9005f8e5-d829-4153-a601-ea0316f0e681 | 1790885069.765309 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | 91695415-c206-4f7e-a378-90679ff28438 | 1790886913.112529 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | ddf79946-b05d-46cd-b3cd-51b1f5593dd7 | 1790888780.876139 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | d07adc52-95ad-4ae4-9abb-96f8cd542245 | 1790889143.409299 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | a9b7713a-88ef-4061-ae3f-599fe322a583 | 1790889964.165529 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | f9bde2c8-bfbe-4de7-8f5d-c0a220c59a4f | 1790892013.452299 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-01 | b3dc7ff0-e4ad-42a3-b8b2-d75535ff77fe | 1790892541.096519 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 45de1634-be5d-40f7-8d77-93fd72fba0e5 | 1790959220.272509 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 9b608508-c9d4-4d7a-9ef6-e87f41bfa940 | 1790960190.011689 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-02 | 96ed953f-91b8-47f2-a980-92117f948a2c | 1790961091.918879 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | f9b8d014-22b8-440b-9f9a-7adf3e159ee4 | 1790969218.884419 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 25ce0123-844d-4d15-a361-ee95730d3336 | 1790970212.780169 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 0ecd28b1-f19f-43ce-bb8b-6f8122cc841c | 1790971364.308599 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 90bf9b3d-1fb6-4f67-8442-0efd03c0b706 | 1790973222.504499 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 50458632-0270-4c0f-86df-faf444576c45 | 1790975099.031099 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 39601c3c-b51d-43aa-a7a0-d8c7b732d490 | 1790975107.605309 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-02 | 64125986-3eda-4b9d-b005-01fa5f05ddff | 1790978028.967709 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 61fa780a-5625-4b53-8840-7b0a118cdbfa | 1791219613.166939 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 7f501e2f-ef5a-4047-a570-3a3d27788424 | 1791220532.396959 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 130f7652-a036-4390-979d-91da04f0cc2c | 1791221217.388899 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 4cb51a54-8fd7-4bf3-b09b-cda69920da18 | 1791228912.021339 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 68761998-a946-4caf-b0ee-9d32700be87d | 1791231682.126319 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 6a183ef3-6a35-4011-87ab-84e713e665e1 | 1791233840.294099 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-05 | 44bdc93c-daa4-4beb-bc5c-e3e559f7c479 | 1791234029.415569 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-06 | e0af9212-4a32-48d1-b150-6d12d383719f | 1791296188.422889 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-06 | b1a4d8ee-e5c2-41c3-a9dc-6d6e20625340 | 1791300157.336689 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-06 | b06422eb-5b68-400e-96dd-4d87954e1f19 | 1791302549.142929 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-06 | 87f1d5f8-3155-4c55-a9b0-3c205efd7db7 | 1791308580.535159 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-06 | 1bdedebf-9f06-430a-a31a-ca17d88e35b4 | 1791318513.552769 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-06 | d1722173-8526-4e2f-bdc3-80390e7f2d50 | 1791319426.345389 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-06 | 7033ce28-927a-47b3-badf-1fb6856ac2fe | 1791321781.350249 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-06 | 275a3555-4249-48ee-8344-15a0651e2e21 | 1791323536.963149 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-07 | aeefea24-42ce-4a80-993b-fe422bc7e7d0 | 1791387870.860319 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-07 | 4138c41a-54fe-4830-b39e-75885cda860e | 1791393463.406339 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-07 | 2eced24d-1b72-41e4-8b0b-19ae3f3953e9 | 1791394794.118239 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-07 | 69424b83-758d-409a-99e8-2566079d7dcd | 1791402845.105719 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-07 | f59efc9c-a2f6-4bcd-af0e-4025caf96d12 | 1791406954.445289 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-07 | 7fbad9a0-fd00-4521-9cc8-6387021cc8f4 | 1791413562.280619 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | c3637d28-8248-44f0-8b27-160fedbe7882 | 1791469887.523989 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 4cfbec53-0105-4ac8-9c30-ee0a4b4513b3 | 1791471146.599799 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 90efb4fd-a37f-4ba8-8669-22615838eb45 | 1791473475.988739 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 2b1617d2-04be-4a5c-ae38-0cd9b3e94fd3 | 1791476041.417109 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 4c64cabb-b696-44ab-9efd-57533f48dbff | 1791478759.912739 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | cf84ccfa-36ca-4893-91d2-b7e130c654cc | 1791486944.687749 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 45a9cac4-bb44-46d6-bd3d-e758a2f3c796 | 1791488147.437769 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 20fa5a30-b87a-422a-a343-b2b0f93f897a | 1791489135.002989 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-08 | 68566ed3-b0ee-41d1-9a56-ce4d3167051b | 1791494554.305749 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 47ddf95e-7602-4a96-bd59-41fa68cd9d8d | 1791495506.932719 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 255466ab-0228-431e-bd7b-fb40d02de45f | 1791497956.390429 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 39544271-7bb4-4167-9cb2-5b042740cdd4 | 1791500135.914349 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-08 | 3a4c3fa6-8089-4116-a5a6-93921213d372 | 1791500242.374269 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | 660e3de8-708a-47fa-913a-1a27ffc1cdaf | 1791562563.429659 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | 50c47a65-6b02-4a60-887e-0c2fb2370d7a | 1791563047.453389 | Unmapped | Nawal Tariq | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-09 | 9ca7df5a-2153-4755-8f01-d86bd62d5e37 | 1791563343.467749 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | 6762f9fa-356b-4706-813b-e5169bf476da | 1791566796.356669 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | b7daa047-158e-4c26-b46f-755492fba1cd | 1791566984.477589 | Unmapped | Nawal Tariq | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-09 | 3bf14890-a2db-431e-b688-52a104684aca | 1791568217.564869 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-09 | d237a136-dc43-486d-8ac0-23152ad224f9 | 1791568785.174469 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | e82161cb-7e95-4ca3-9bc4-d4bfafbb6e21 | 1791574535.577369 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | 0f794348-ede9-44f9-9dd8-289a60897b42 | 1791575143.495619 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | 350b123d-27b7-4c65-b685-66be2b408126 | 1791575229.460059 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | d7fc6426-c728-456e-80e4-c0d6ee59d173 | 1791576543.124289 | Unmapped | Nawal Tariq | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-09 | fdacf483-3ab1-49fc-bd34-d2a433680d16 | 1791578603.943589 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | 1209c7e5-32e6-4101-b9f1-88c56e690877 | 1791579331.226069 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-09 | fa00d009-e294-4d51-a16d-c44971978df7 | 1791579337.257189 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-12 | e0ed71d8-57de-4398-95c6-1484fefbe0bc | 1791819097.250339 | Unmapped | Nawal Tariq | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-12 | 3cb7b292-3f61-472d-821b-31397a6cee02 | 1791822163.580169 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-12 | 603d953d-aad5-46c2-98c6-22f80bb52458 | 1791826509.710239 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-12 | f2901ea1-042c-48d5-8fae-1748b90b7e54 | 1791827371.056489 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-12 | dea7ed51-14ea-4788-a2f5-e7ca75faab05 | 1791840252.892049 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-12 | 4c2f4ea0-ac89-4114-9dc6-91aeb879638b | 1791843228.130579 | Asif Hazoor | Asif Hazoor | OTHER_PROVEN_CAUSE: source absent from complete history and message_not_found |
| 2026-10-13 | 6b7bafe1-f61d-4803-8290-fdcd46fa1628 | 1791909128.969119 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | f25fafa9-eb15-4807-afd5-f696745f4ae1 | 1791910260.794979 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | 14a913a9-99e9-43ce-85e1-ca7f5f74dd8a | 1791910280.860389 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | 24cac14b-313c-4f8a-ac5f-b113dd9389b9 | 1791912956.040339 | Unmapped | Abdul Wali | IDENTITY_MAPPING_ERROR: previously unmapped author |
| 2026-10-13 | f6547ef8-dc07-49f1-a1af-0f3109b93cf9 | 1791921805.147699 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | 543c5105-7f4f-4154-a229-f20b5d1163fc | 1791922738.744919 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | 36ef060e-3e55-4e89-be7c-ea3c3a7b003e | 1791925507.855879 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | 684bd403-0945-4cec-8b77-f00f146cb4bd | 1791926798.914299 | Araad Rana | Muhammad Zeeshan | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | dc98c78d-6c54-4cc6-8256-afd7124f992f | 1791927195.247459 | Mike Weston | Saad Ali | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | 17a81485-ef43-4763-9e7e-f7b54b77028b | 1791928736.074089 | Hamdan Mahmood | Dilshad Ullah Danish | WRONG_EMPLOYEE: approved October parent-author mapping |
| 2026-10-13 | d02e2738-213e-44ae-a313-f08c13e9ce45 | 1791932298.838669 | Zeeshan Afsar | Muhammad Eman | WRONG_EMPLOYEE: approved October parent-author mapping |
