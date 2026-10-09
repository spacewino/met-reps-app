import React, { useId, useState } from 'react';
import type { WeightUnit } from '../types';
import { convertWeightUnit } from '../lib/assistedLoadMath';
import { BAR_WEIGHTS_KG, calculatePlateLoad, type BarWeightKg } from '../lib/plateCalculator';

const formatWeight = (weight: number) => String(Number(weight.toFixed(3)));
const plateColors: Record<number, string> = {
  20: '#2563eb', 15: '#d97706', 10: '#15803d', 5: '#64748b', 2.5: '#7c3aed', 1.25: '#be123c',
};

export function PlateCalculator({ initialWeight, unit }: { initialWeight: number | null | undefined; unit: WeightUnit }) {
  const visualId = useId();
  const [target, setTarget] = useState(() => typeof initialWeight === 'number' && Number.isFinite(initialWeight) ? String(initialWeight) : '');
  const [barKg, setBarKg] = useState<BarWeightKg>(20);
  const targetValue = target.trim() === '' ? NaN : Number(target);
  const result = calculatePlateLoad(convertWeightUnit(targetValue, unit, 'kg'), barKg);
  const total = result ? convertWeightUnit(result.totalKg, 'kg', unit) : null;
  const difference = result ? convertWeightUnit(result.differenceKg, 'kg', unit) : null;
  const exact = difference !== null && Math.abs(difference) < 0.000001;
  const summary = result?.plates.map(plate => `${plate.weightKg} kg × ${plate.count}`).join(', ');

  return <div className="p-4 space-y-3 text-slate-100">
    <div className="space-y-2 text-center">
      <label htmlFor="plate-calc-target" className="block text-xs font-bold uppercase tracking-wide text-slate-400">Target weight ({unit})</label>
      <input id="plate-calc-target" type="number" min="0" step="any" inputMode="decimal" value={target}
        onChange={event => setTarget(event.target.value)} aria-describedby="plate-calc-target-help" aria-invalid={target !== '' && !result}
        className="block w-full max-w-48 mx-auto bg-slate-950 border border-slate-800 p-2 text-center text-2xl font-mono font-extrabold text-white focus:outline-none focus:border-indigo-400" />
      <p id="plate-calc-target-help" className="text-xs text-slate-400">Includes the bar and both sides.</p>
    </div>

    <fieldset className="space-y-2">
      <legend className="text-xs font-bold uppercase tracking-wide text-slate-400">Bar weight</legend>
      <div className="grid grid-cols-3 gap-2">
        {BAR_WEIGHTS_KG.map(weight => <button key={weight} type="button" aria-pressed={barKg === weight} onClick={() => setBarKg(weight)}
          className={`p-3 border text-sm font-mono font-bold transition ${barKg === weight ? 'bg-selected-surface border-indigo-400 text-indigo-300' : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-850'}`}>
          {weight} kg
        </button>)}
      </div>
    </fieldset>

    {unit === 'lb' && <p className="text-xs text-slate-400">Bar and plate sizes are in kg. Target and loaded total are shown in lb.</p>}

    {!result ? <p role="status" className="text-sm text-slate-400">Enter a valid target weight of 0 or more.</p> : <>
      <section aria-labelledby="plate-calc-plates" className="space-y-3">
        <div className="flex flex-wrap justify-between gap-1 items-baseline">
          <h3 id="plate-calc-plates" className="text-sm font-bold">Load on each side</h3>
          <span className="text-xs font-mono text-slate-400">{formatWeight(result.perSideKg)} kg per side</span>
        </div>
        {result.plates.length === 0 ? <p className="text-sm text-slate-400">Bar only — no plates needed.</p> : <>
          <div role="img" aria-label={`Plates on each side: ${summary}`} className="overflow-x-auto py-2 border-b border-slate-800">
            <div className="flex items-end justify-center gap-2 w-max min-w-full">
              {result.plates.map(plate => {
                const height = 30 + Math.sqrt(plate.weightKg / 20) * 54;
                const patternId = `${visualId}-plate-${plate.weightKg}`;
                // Repeat a labelled plate without creating an unbounded array of
                // elements when someone enters an unusually large target.
                return <svg key={plate.weightKg} aria-hidden="true" width={plate.count * 48} height="110" className="shrink-0 font-mono text-slate-100">
                  <defs>
                    <pattern id={patternId} width="48" height="110" patternUnits="userSpaceOnUse">
                      <text x="24" y={100 - height} textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="700">{plate.weightKg}<tspan fontSize="10"> kg</tspan></text>
                      <rect x="10" y={108 - height} width="28" height={height} fill={plateColors[plate.weightKg]} stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="110" fill={`url(#${patternId})`} />
                </svg>;
              })}
            </div>
          </div>
          <ul className="space-y-1 text-sm font-mono" aria-label="Plate counts per side">
            {result.plates.map(plate => <li key={plate.weightKg} className="flex justify-between gap-2"><span>{plate.weightKg} kg</span><strong>× {plate.count}</strong></li>)}
          </ul>
        </>}
      </section>

      <div role="status" aria-live="polite" className="border-t border-slate-800 pt-3 space-y-1">
        <p className="text-xs uppercase tracking-wide font-bold text-slate-400">Loaded total</p>
        <p className="text-2xl font-mono font-extrabold text-indigo-300">{formatWeight(total!)} {unit}</p>
        <p className={`text-sm ${exact ? 'text-slate-300' : 'text-indigo-300 font-semibold'}`}>
          {exact ? 'Exact target' : `${Math.abs(difference!) < 0.001 ? '< 0.001' : formatWeight(Math.abs(difference!))} ${unit} ${difference! < 0 ? 'below' : 'above'} target`}
        </p>
        {targetValue < convertWeightUnit(barKg, 'kg', unit) && <p className="text-xs text-slate-400">The bar alone is heavier than the target. Choose a lighter bar if available.</p>}
      </div>
    </>}
  </div>;
}
