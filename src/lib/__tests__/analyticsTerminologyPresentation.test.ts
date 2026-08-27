/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Analytics and PR Terminology Presentation Tests', () => {
  it('confirms EPLEY 1RM PR is used with accessible description in Diary/Logger PR badges and distance uses generic PR', () => {
    const logsHistoryCode = fs.readFileSync(path.resolve(__dirname, '../../components/LogsHistoryView.tsx'), 'utf-8');
    const workoutLoggerCode = fs.readFileSync(path.resolve(__dirname, '../../components/WorkoutLogger.tsx'), 'utf-8');

    // Both files must have EPLEY 1RM PR
    expect(logsHistoryCode).toContain('EPLEY 1RM PR');
    expect(workoutLoggerCode).toContain('EPLEY 1RM PR');

    // Both files must have accessible title and aria-label: "Estimated 1RM personal record (Epley)"
    expect(logsHistoryCode).toContain('title="Estimated 1RM personal record (Epley)"');
    expect(logsHistoryCode).toContain('aria-label="Estimated 1RM personal record (Epley)"');

    expect(workoutLoggerCode).toContain("item.modality === 'distance' ? 'Personal record' : 'Estimated 1RM personal record (Epley)'");
    expect(workoutLoggerCode).toContain("item.modality === 'distance' ? 'PR' : 'EPLEY 1RM PR'");

    // Obsolete or mismatched strings must NOT appear
    expect(logsHistoryCode).not.toContain('RPE CAPACITY PR');
    expect(workoutLoggerCode).not.toContain('RPE CAPACITY PR');
    expect(logsHistoryCode).not.toContain('RPE-adjusted capacity personal record');
    expect(workoutLoggerCode).not.toContain('RPE-adjusted capacity personal record');
    expect(logsHistoryCode).not.toContain('e1RM PR');
    expect(workoutLoggerCode).not.toContain('e1RM PR');
  });

  it('confirms Analytics displays Estimated 1RM (Epley) and Report Card displays Average Estimated 1RM Progression (Epley)', () => {
    const analyticsViewCode = fs.readFileSync(path.resolve(__dirname, '../../components/AnalyticsView.tsx'), 'utf-8');
    expect(analyticsViewCode).toContain('Estimated 1RM (Epley)');
    expect(analyticsViewCode).toContain('Average Estimated 1RM Progression (Epley)');
    expect(analyticsViewCode).not.toContain('Average E1RM Progression');
    expect(analyticsViewCode).not.toContain('RPE-Adjusted Capacity');
  });

  it('confirms badge layout styles and responsive styling preserve compact inline layout for 320px/375px', () => {
    const logsHistoryCode = fs.readFileSync(path.resolve(__dirname, '../../components/LogsHistoryView.tsx'), 'utf-8');
    // Confirms font-extrabold, compact tracking, and shrink-0 are used for mobile safety
    expect(logsHistoryCode).toContain('text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-tight animate-pulse shrink-0');
  });
});
