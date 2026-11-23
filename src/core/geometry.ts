/**
 * 轮胎几何：规格解析、外径/周长、胎冠弧度、载荷-气压压扁模型。
 * 全部纯函数，毫米/牛/千帕单位。
 */
import type { TireSpec } from './types';

export const MM_PER_INCH = 25.4;

/** 解析 "205/55R16" 形式的规格字符串 */
export function parseTireSpec(text: string): { sectionWidth: number; aspectRatio: number; rimDiameterIn: number } | null {
  const m = /^\s*(\d{3})\s*\/\s*(\d{2,3})\s*R\s*(\d{1,2}(?:\.\d+)?)\s*$/i.exec(text);
  if (!m) return null;
  return {
    sectionWidth: Number(m[1]),
    aspectRatio: Number(m[2]),
    rimDiameterIn: Number(m[3]),
  };
}

export function formatTireSpec(spec: Pick<TireSpec, 'sectionWidth' | 'aspectRatio' | 'rimDiameterIn'>): string {
  return `${spec.sectionWidth}/${spec.aspectRatio}R${spec.rimDiameterIn}`;
}

/** 胎侧高度 H，mm */
export function sidewallHeight(spec: Pick<TireSpec, 'sectionWidth' | 'aspectRatio'>): number {
  return (spec.sectionWidth * spec.aspectRatio) / 100;
}

/** 轮辋直径，mm */
export function rimDiameterMm(spec: Pick<TireSpec, 'rimDiameterIn'>): number {
  return spec.rimDiameterIn * MM_PER_INCH;
}

/** 充气外直径 OD，mm */
export function outerDiameter(spec: Pick<TireSpec, 'sectionWidth' | 'aspectRatio' | 'rimDiameterIn'>): number {
  return rimDiameterMm(spec) + 2 * sidewallHeight(spec);
}

/** 外周长，mm */
export function outerCircumference(spec: Pick<TireSpec, 'sectionWidth' | 'aspectRatio' | 'rimDiameterIn'>): number {
  return Math.PI * outerDiameter(spec);
}

export function outerRadius(spec: Pick<TireSpec, 'sectionWidth' | 'aspectRatio' | 'rimDiameterIn'>): number {
  return outerDiameter(spec) / 2;
}

/**
 * 胎冠弧：横向位置 y（胎面中线=0）处相对冠中的径向下沉量 c(y)，mm。
 * 胎冠区采用抛物线 c = k y²，k = crownDrop/(W/2)²；
 * 越过胎面边缘后用胎肩圆弧平滑过渡（接地区一般到不了肩外）。
 */
export function crownDropAt(spec: Pick<TireSpec, 'sectionWidth' | 'crownDrop' | 'shoulderRadius'>, y: number): number {
  const halfW = spec.sectionWidth / 2;
  const ay = Math.abs(y);
  if (ay <= halfW) {
    return spec.crownDrop * (ay / halfW) ** 2;
  }
  // 肩外：与抛物线在 y=halfW 处相切的圆弧
  const slope = (2 * spec.crownDrop) / halfW; // 抛物线端点斜率
  const r = Math.max(spec.shoulderRadius, 1);
  const dy = ay - halfW;
  // 圆切线方向接续：弧段下沉 ≈ slope*dy + dy²/(2r)
  return spec.crownDrop + slope * dy + dy * dy / (2 * r);
}

/** 压力-载荷要求的接地面积，mm²：A = F / p */
export function requiredContactArea(loadN: number, pressureKpa: number): number {
  if (pressureKpa <= 0) return 0;
  return (loadN / pressureKpa) * 1000; // kPa = 1000 N/m²? 1 kPa=1000 Pa=1000 N/m² → mm²: F/p_Pa*1e6 = F/(p_kPa*1e3)*1e6
}

export interface FootprintGeometry {
  /** 下沉量 δ，mm */
  deflection: number;
  /** 接地半宽 b，mm */
  halfWidth: number;
  /** 冠中接地半长 a0，mm */
  halfLengthCenter: number;
  /** 名义接地面积（=F/p），mm² */
  nominalArea: number;
  /** 名义接地长度（冠中全宽 2a0），mm */
  contactLength: number;
  /** 名义接地宽度 2b，mm */
  contactWidth: number;
  /** 有效滚动半径，mm */
  rollingRadius: number;
}

/**
 * 由载荷与气压反解压扁几何。
 * 模型：δ 下沉量；c(y)=k y²；接触半宽 b=min(sqrt(δ/k), W/2)；
 * 周向接地半长 a(y)=sqrt(2R(δ-c(y)))。
 * 面积 A(δ)=∫2a dy，二分求解使 A=F/p。
 */
export function solveFootprint(spec: TireSpec): FootprintGeometry {
  const R = outerRadius(spec);
  const halfW = spec.sectionWidth / 2;
  const k = spec.crownDrop / (halfW * halfW);
  // 接地宽度受实际胎面宽度限制
  const bCap = spec.treadWidth / 2;
  const target = requiredContactArea(spec.load, spec.inflationPressure);

  const areaAt = (delta: number): number => {
    const b = Math.min(Math.sqrt(delta / k), bCap);
    if (b <= 0) return 0;
    let area = 0;
    const steps = 256;
    const dy = (2 * b) / steps;
    for (let i = 0; i <= steps; i++) {
      const y = -b + (i * 2 * b) / steps;
      const remain = delta - k * y * y;
      if (remain <= 0) continue;
      const a = Math.sqrt(2 * R * remain);
      area += (i === 0 || i === steps ? a : 2 * a) * dy;
    }
    return area;
  };

  // 二分 δ，上界取断面高的 25%（工程上下沉量很少超过这个）
  let lo = 0;
  let hi = sidewallHeight(spec) * 0.25;
  if (areaAt(hi) < target) hi = sidewallHeight(spec) * 0.4;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (areaAt(mid) < target) lo = mid;
    else hi = mid;
  }
  const deflection = (lo + hi) / 2;
  const halfWidth = Math.min(Math.sqrt(deflection / k), bCap);
  const halfLengthCenter = Math.sqrt(2 * R * deflection);
  const rollingRadius = R - deflection / 3;

  return {
    deflection,
    halfWidth,
    halfLengthCenter,
    nominalArea: target,
    contactLength: 2 * halfLengthCenter,
    contactWidth: 2 * halfWidth,
    rollingRadius,
  };
}

/** 给定滚动相位下，接地区内点 (x,y) 的胎面离路面间隙，mm（不含花纹沟） */
export function carcassGap(spec: TireSpec, geo: FootprintGeometry, x: number, y: number): number {
  const a = 2 * geo.rollingRadius * (geo.deflection - crownDropAt(spec, y));
  if (a <= 0) return Infinity;
  const halfLen = Math.sqrt(a);
  if (Math.abs(x) > halfLen) return Infinity;
  // 滚筒弧近似：路面 z=0，胎面基线 z(x,y)=δ-c(y)-x²/(2R_eff)
  const R = geo.rollingRadius;
  return Math.max(0, geo.deflection - crownDropAt(spec, y) - (x * x) / (2 * R));
}
