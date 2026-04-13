export interface EmployeeInfo {
  name: string;
  dirName: string;
  project: string;
  repo: string;
  role: string;
  model?: string;
  status: "onboarding" | "active" | "paused";
  maxSubEmployees: number;
  body: string;
  created: string;
  parent?: string;
  source: string;
}
