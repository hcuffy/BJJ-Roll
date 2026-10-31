import dayjs, { type Dayjs } from "dayjs";

type DateInput = Date | string | number;

function toDayjs(value: DateInput): Dayjs {
  return dayjs(typeof value === "string" ? new Date(value) : value);
}

export function currentMs(): number {
  return dayjs().valueOf();
}

export function currentSeconds(): number {
  return dayjs().unix();
}

export function currentDate(): Date {
  return dayjs().toDate();
}

export function toMs(value: DateInput): number {
  return toDayjs(value).valueOf();
}

export function toDate(value: DateInput): Date {
  return toDayjs(value).toDate();
}

export function secondsAfter(value: DateInput, seconds: number): Date {
  return toDayjs(value).add(seconds, "second").toDate();
}

export function toIsoString(value: DateInput): string {
  return toDayjs(value).toISOString();
}
