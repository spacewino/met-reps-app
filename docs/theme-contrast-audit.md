# Theme colour and contrast audit

## Resolution model

Tailwind's slate scale is intentionally semantic in `index.css`: slate backgrounds resolve to the theme's main/card surfaces, slate borders resolve to its boundary colour, and white/slate text resolves to primary, secondary, or muted text. Indigo similarly resolves to accent roles. Consequently, names such as `text-white` and `bg-slate-950` do **not** denote literal colours in Crimson Desert. Literal foregrounds are now limited to purpose-named `on-accent` and `on-destructive` roles, while modal backdrops use the invariant `overlay` role.

| Theme | Main / card | Primary / secondary / muted | Accent light / action | Success |
| --- | --- | --- | --- | --- |
| Subnautic | `#04060a` / `#11182c` | `#F9FAFB` / `#94a3b8` / `#94a3b8` | `#818cf8` / `#4f46e5` | `#34d399` |
| Feralas | `#111827` / `#1F2937` | `#F9FAFB` / `#D1D5DB` / `#9CA3AF` | `#34D399` / `#047857` | `#34D399` |
| Crimson Desert | `#F2F0EC` / `#FBFAF8` | `#252320` / `#6F6A63` / `#6F6A63` | `#9B5C34` / `#7D4726` | `#477041` |

## Findings and corrections

- Muted copy failed 4.5:1 on card surfaces in every theme (as low as 2.57:1 in Crimson Desert). Muted values now pass 4.5:1 on both surfaces.
- Crimson Desert accent-light, cyan, and success text failed normal-text contrast. These semantic values were darkened; dark-theme values remain suitably light.
- Generic borders were below 3:1 and made inputs, selectors, and modal sections hard to distinguish. Boundary values now pass 3:1 against both theme surfaces. Low-opacity dividers remain intentionally decorative and are not relied upon as the sole state indicator.
- Filled accent, success, information, and warning controls used remapped `text-white`, and some hover fills were too bright for literal white. Filled controls now use dedicated action surfaces and the fixed `on-accent` foreground. Destructive controls retain the existing fixed `on-destructive` treatment.
- Theme-remapped `slate-950` made modal backdrops light in Crimson Desert. All application modal backdrops now use a fixed dark overlay; modal content continues to use theme surfaces.
- Lucide and warm-up icons inherit the audited current colour. The brand logo's fixed fills/strokes are decorative artwork rather than information-bearing UI. Chart labels and tooltips use semantic foreground/surface pairs; grid lines are decorative, while plotted series use accent colours that meet the 3:1 non-text threshold.
- Disabled controls retain their semantic foreground/background and use opacity only as a supplementary state cue. Existing labels and control shapes remain present, so disabled styling does not carry meaning by colour alone.
- Manual Vercel previewing found that the Workout In Progress heading inherited the remapped `slate-900` card colour on its light Crimson Desert header. The heading now explicitly uses semantic primary text, which remains light on the two dark themes and dark on Crimson Desert.
- Manual mobile previewing also found that Program Builder periodisation and target-mode cards relied too heavily on their borders. Both groups now use a theme-specific selected surface plus the existing selected border, retain radio semantics, and omit redundant visual ticks. Their title, description, and information-icon colours meet the measured text/UI contrast thresholds on all three selected surfaces.

The automated audit calculates WCAG contrast from the actual theme hex values. It checks normal text at 4.5:1, meaningful boundaries/focus accents at 3:1, and fixed foregrounds on default and hover action surfaces at 4.5:1.

## Complete regression verification

The all-at-once Vitest invocation was observed for 90 seconds without reporting a completed file, while the same suite completed normally with one worker in eleven deterministic, alphabetically sorted groups. Every `*.test.ts` and `*.test.tsx` file under `src/lib/__tests__` was included exactly once.

| Group | Alphabetical file range | Files | Tests | Result |
| --- | --- | ---: | ---: | --- |
| 1 | `achievements`–`assistedLoadMath` | 10 | 204 | Pass |
| 2 | `autoWarmupReplacementConfirmation`–`coldStartCalibration` | 10 | 224 | Pass |
| 3 | `contextualPrescriptionBaseline`–`diaryMuscleSetPeriod` | 10 | 402 | Pass |
| 4 | `diarySessionSummary`–`guidedHistoryCollector` | 10 | 215 | Pass |
| 5 | `guidedLaneReplay`–`historicalSetDisplay` | 10 | 545 | Pass |
| 6 | `liveAdjustmentMath`–`onboarding` | 10 | 319 | Pass |
| 7 | `programBuilderActiveWorkoutSwitch`–`programMetadata` | 10 | 106 | Pass |
| 8 | `programReportCard`–`restTimer` | 10 | 148 | Pass |
| 9 | `rpeMath`–`themeManualPreviewCorrections` | 10 | 276 | Pass |
| 10 | `unifiedMixedModalityAnalytics`–`workoutLoggerGuidanceHeader` | 10 | 169 | Pass |
| 11 | `workoutLoggerGuidedAddedExerciseIntegration`–`workoutLoggerStrengthMainMovementValidation` | 7 | 93 | Pass |
| **Combined** |  | **107** | **2,701** | **Pass** |
