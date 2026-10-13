import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const db = configured ? createClient(url, key) : null;
export const statuses = [
  "Backlog",
  "In Progress",
  "In Review",
  "Done",
  "Retired",
] as const;
export const purchaseStatuses = [
  "Proposed",
  "Approved",
  "Ordered",
  "Received",
] as const;
export type Member = {
  id: string;
  email: string | null;
  display_name: string;
  subteam_id: string | null;
  role: "admin" | "member";
  active: boolean;
  user_id: string | null;
};
export type Subteam = { id: string; name: string };
export type Sprint = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  goal: string;
  retrospective: string;
};
export type Work = {
  id: string;
  title: string;
  description: string;
  points: number;
  subteam_id: string | null;
  assignee_id: string | null;
  sprint_id: string | null;
  due_date: string | null;
  status: (typeof statuses)[number];
  acceptance_criteria: string;
  resource_url: string | null;
  blocked: boolean;
  blocker_reason: string;
  carryover_from_id: string | null;
};
export type Priority = {
  id: string;
  sprint_id: string;
  title: string;
  rank: number;
  owner_id: string;
  definition_of_done: string;
};
export type Resource = {
  id: string;
  title: string;
  type: string;
  owner_id: string;
  date: string;
  tags: string[];
  drive_url: string | null;
};
export type Purchase = {
  id: string;
  item: string;
  quantity: number;
  estimated_cost: number;
  requester_id: string;
  reason: string;
  vendor: string;
  url: string | null;
  status: (typeof purchaseStatuses)[number];
};
export type WorkHistory = {
  id: string;
  work_item_id: string;
  sprint_id: string;
  title: string;
  points: number;
  status: string;
  assignee_id: string | null;
  outcome: string;
  next_sprint_id: string | null;
  recorded_at: string;
};
export type Dataset = {
  work_item_history: WorkHistory[];
  team_members: Member[];
  subteams: Subteam[];
  sprints: Sprint[];
  work_items: Work[];
  priorities: Priority[];
  resources: Resource[];
  purchases: Purchase[];
};
export const emptyData: Dataset = {
  work_item_history: [],
  team_members: [],
  subteams: [],
  sprints: [],
  work_items: [],
  priorities: [],
  resources: [],
  purchases: [],
};
export const tables = Object.keys(emptyData) as (keyof Dataset)[];
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function activeSprint(sprints: Sprint[]) {
  const date = today();
  return sprints.find((s) => s.start_date <= date && s.end_date >= date);
}
export function dateLabel(value?: string | null) {
  return value
    ? new Date(value + "T12:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No due date";
}
export function safeURL(value: string | null) {
  if (!value) return null;
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
