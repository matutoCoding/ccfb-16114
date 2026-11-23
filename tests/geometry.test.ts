import { describe, it, expect } from 'vitest';
import { parseTireSpec, outerDiameter, outerCircumference, solveFootprint, crownDropAt, requiredContactArea } from '../src/core/geometry';

describe('轮胎规格与几何', () => {
  it('解析 205/55R16', () => {
    const s = parseTireSpec('205/55R16');
    expect(s).toEqual({ sectionWidth: 205, aspectRatio: 55, rimDiameterIn: 16 });
    expect(parseTireSpec('195 / 65 R15')).toEqual({ sectionWidth: 195, aspectRatio: 65, rimDiameterIn: 15 });
    expect(parseTireSpec('abc')).toBeNull();
  });

  it('外径与周长', () => {
    const spec = { sectionWidth: 205, aspectRatio: 55, rimDiameterIn: 16 };
    // OD = 16*25.4 + 2*112.75 = 406.4 + 225.5 = 631.9
    expect(outerDiameter(spec)).toBeCloseTo(631.9, 6);
    expect(outerCircumference(spec)).toBeCloseTo(Math.PI * 631.9, 6);
  });

  it('胎冠弧中线为零、边缘等于 crownDrop，单调', () => {
    const spec = { sectionWidth: 205, treadWidth: 170, aspectRatio: 55, rimDiameterIn: 16, crownDrop: 8.5, shoulderRadius: 12 };
    expect(crownDropAt(spec, 0)).toBe(0);
    expect(crownDropAt(spec, 102.5)).toBeCloseTo(8.5, 10);
    expect(crownDropAt(spec, -50)).toBeCloseTo(crownDropAt(spec, 50), 12);
    expect(crownDropAt(spec, 60)).toBeGreaterThan(crownDropAt(spec, 40));
  });

  it('压扁面积反解满足 F/p（误差 <0.2%）', () => {
    const tire = {
      sectionWidth: 205, treadWidth: 170, aspectRatio: 55, rimDiameterIn: 16,
      crownDrop: 8.5, shoulderRadius: 12, load: 4900, inflationPressure: 220,
    };
    const geo = solveFootprint(tire);
    const target = requiredContactArea(tire.load, tire.inflationPressure);
    expect(geo.nominalArea).toBeCloseTo(target, 6);
    expect(geo.deflection).toBeGreaterThan(0);
    expect(geo.halfWidth).toBeLessThanOrEqual(170 / 2 + 1e-9);
    expect(geo.halfLengthCenter).toBeGreaterThan(geo.halfWidth * 0.8);
  });
});
