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
 * Returns the schedule anchor for a program run. Legacy programs only used
 * createdAt, so that value remains the anchor while such a program is active.
 * Inactive legacy designs deliberately have no run until they are enrolled.
 */
export function getEffectiveEnrolmentDate(
  program: { createdAt: string; enrolledAt?: string } | null | undefined,
  isActive = true,
): string | null {
  if (!program) return null;
  if (program.enrolledAt) return program.enrolledAt;
  return isActive ? program.createdAt : null;
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

/**
 * Formats a stored YYYY-MM-DD date string into a local calendar presentation string.
 * Avoids parsing ISO string as UTC to prevent timezone/calendar day shifts.
 */
export function formatLocalDateDisplay(dateStr: string, locale?: string): string {
  if (!dateStr || typeof dateStr !== 'string') return dateStr || '';
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return dateStr;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return dateStr;
  }
  try {
    // Construct local midday to ensure date stability across daylight savings
    const localDate = new Date(year, month - 1, day, 12, 0, 0);
    return new Intl.DateTimeFormat(locale || undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(localDate);
  } catch {
    return dateStr;
  }
}

/**
 * Formats a stored HH:MM 24-hour time string into a locale-aware presentation string.
 * Keeps numeric and AM/PM parts formatted on a single line.
 */
export function formatLocalTimeDisplay(timeStr: string, locale?: string): string {
  if (!timeStr || typeof timeStr !== 'string') return timeStr || '';
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return timeStr;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return timeStr;
  }
  try {
    const localDate = new Date(2026, 0, 1, hour, minute, 0);
    return new Intl.DateTimeFormat(locale || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(localDate);
  } catch {
    return timeStr;
  }
}
