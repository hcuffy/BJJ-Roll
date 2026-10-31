import dayjs from "dayjs";

export function currentMs(): number {
  return dayjs().valueOf();
}
