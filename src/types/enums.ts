/** Status of a job run or audit entry. */
export type JobStatus = "ok" | "error";

/** Status of a job in the cron state (includes running). */
export type JobStateStatus = "ok" | "error" | "running";

/** Lifecycle state of a job. */
export type JobLifecycle = "active" | "disabled" | "archived";

/** Schedule type for jobs. */
export type ScheduleType = "cron" | "interval" | "once";

/** System mode — chat or background job. */
export type Mode = "chat" | "job";

/** Attachment type for messages. */
export type AttachmentType = "image" | "document";

/** Channel names. */
export type ChannelName = "telegram" | "slack";
