export function historicalWebTimestampAADCandidate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  // В JavaScript $ допускает завершающий перевод строки; AAD требует всю строку.
  if (match === null || match[0] !== value) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    /[1-9]/.test(fraction.slice(3))
  ) {
    return null;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = monthDays[month - 1];
  if (maxDay === undefined || day > maxDay) {
    return null;
  }

  const candidate = `${value.slice(0, 19)}.${fraction.slice(0, 3).padEnd(3, "0")}Z`;
  return candidate === value ? null : candidate;
}
