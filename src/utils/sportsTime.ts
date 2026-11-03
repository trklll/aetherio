import { formatLocalSchedule, formatLocalTime } from "./localTime.ts";

/** Sports uses Peru time regardless of the computer or addon's default zone. */
export const SPORTS_TIME_ZONE = "America/Lima";
export const formatSportsSchedule = (iso: string | number | Date | undefined | null) => formatLocalSchedule(iso, SPORTS_TIME_ZONE);
export const formatSportsTime = (iso: string | number | Date | undefined | null) => formatLocalTime(iso, SPORTS_TIME_ZONE);
