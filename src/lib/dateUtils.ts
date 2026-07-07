/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Formats a Date object to a YYYY-MM-DD string in the user's browser local timezone.
 */
export function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD string into a Date object representing midnight in local time.
 */
export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return new Date();
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  return new Date(year, month, day, 0, 0, 0, 0);
}

/**
 * Returns today's date in local YYYY-MM-DD format.
 */
export function getTodayLocalDateString(): string {
  return getLocalDateString(new Date());
}

/**
 * Calculates the exact session date for a given program's starting date, 
 * day of the week assignments, target week, and day index of the program.
 */
export function calculateSessionDate(
  createdAtStr: string,
  assignedWeekdays: Record<number, number | null> | undefined,
  weekNum: number,
  dayIdx: number
): Date {
  const createdDate = new Date(createdAtStr);
  
  // Custom day of week (0=Mon, 1=Tue... 6=Sun)
  const getCustomDayOfWeek = (d: Date): number => {
    const jsDay = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    return jsDay === 0 ? 6 : jsDay - 1;
  };

  // Day 1's assigned weekday index (default Monday = 0)
  const day1Weekday = (assignedWeekdays && assignedWeekdays[1] !== undefined && assignedWeekdays[1] !== null)
    ? Number(assignedWeekdays[1])
    : 0;
  
  // Find first occurrence of day1Weekday on or after createdDate
  const createdDayOfWeek = getCustomDayOfWeek(createdDate);
  let daysUntilDay1 = day1Weekday - createdDayOfWeek;
  if (daysUntilDay1 < 0) {
    daysUntilDay1 += 7;
  }
  
  const week1Day1Date = new Date(createdDate);
  week1Day1Date.setDate(createdDate.getDate() + daysUntilDay1);
  
  // Find Monday of Week 1
  const week1Monday = new Date(week1Day1Date);
  week1Monday.setDate(week1Day1Date.getDate() - day1Weekday);
  
  // The weekday index for the requested day index
  const weekdayIndex = (assignedWeekdays && assignedWeekdays[dayIdx] !== undefined && assignedWeekdays[dayIdx] !== null)
    ? Number(assignedWeekdays[dayIdx])
    : ((dayIdx - 1) % 7);
  
  // If the target day's weekday is before Day 1's weekday, shift it by +1 week
  let weekShift = 0;
  if (weekdayIndex < day1Weekday) {
    weekShift = 1;
  }
  
  const targetDate = new Date(week1Monday);
  const daysOffset = (weekNum - 1 + weekShift) * 7 + weekdayIndex;
  targetDate.setDate(week1Monday.getDate() + daysOffset);
  
  return targetDate;
}

