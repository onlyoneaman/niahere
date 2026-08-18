export type CheckStatus = "ok" | "warn" | "fail";

/** One health finding. Lives here rather than beside the checks so a module can
 *  return a Check without importing the aggregator that calls it. */
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}
