/**
 * 领域模型：轮胎规格 / 花纹单元 / 节距序列 / 分析结果
 * 纯类型定义，不依赖 DOM 与 WebGPU。
 */

/** 轮胎规格，型号写法如 205/55R16 */
export interface TireSpec {
  /** 断面宽度 W，mm */
  sectionWidth: number;
  /** 实际胎面宽度（接地宽度上限，通常 0.8~0.85·断面宽），mm */
  treadWidth: number;
  /** 高宽比（百分数值，55 表示 0.55） */
  aspectRatio: number;
  /** 轮辋直径，英寸 */
  rimDiameterIn: number;
  /** 胎冠弧 crown drop：肩位比冠中低的高度，mm（决定胎冠弧度） */
  crownDrop: number;
  /** 胎肩过渡弧半径，mm */
  shoulderRadius: number;
  /** 垂直载荷，N */
  load: number;
  /** 充气压力，kPa */
  inflationPressure: number;
}

/** 花纹沟走向 */
export type FeatureKind = 'circumferential' | 'lateral' | 'sipe';

export interface TreadFeature {
  id: string;
  kind: FeatureKind;
  /** 中心位置。纵沟：y(横向，mm，胎面中线=0)；横沟/刀槽：x(周向，节距局部坐标 0..length) */
  position: number;
  /** 顶部宽度，mm（沟口宽；刀槽通常 0.6~1.5） */
  width: number;
  /** 沟深，mm（刀槽一般 3~6，主沟 7~9） */
  depth: number;
  /** 沟壁角度，度（0=垂直壁；>0 时沟底收窄） */
  wallAngle: number;
  /** 横向延伸。纵沟：沿周向占比（1=贯通全节距）；横沟/刀槽：沿 y 向的长度，mm */
  span: number;
  /** 横沟/刀槽相对周向的倾斜角，度（纵沟忽略） */
  skew: number;
  /** 横沟/刀槽的 y 向起点，mm（纵沟忽略；胎面中线为 0） */
  yStart: number;
  /** 花纹块倒角：沟口两侧斜面宽度，mm（0=无倒角，矩形沟） */
  chamfer: number;
}

/** 一个节距的花纹单元（按单位节距设计，拉伸时几何按节距长映射） */
export interface PatternUnit {
  id: string;
  name: string;
  /** 设计基准节距长，mm（编辑画布按此长度展示） */
  baseLength: number;
  /** 胎面展开宽度（通常 = 断面宽度），mm */
  treadWidth: number;
  features: TreadFeature[];
  /** 整体花纹深度上限，mm */
  maxDepth: number;
  updatedAt: number;
}

/** 一种节距长度 */
export interface PitchType {
  id: string;
  /** 节距长，mm */
  length: number;
  /** 标签名，如 S/M/L */
  label: string;
}

/** 节距排列约束（自动搜索用） */
export interface PitchConstraints {
  /** 同种节距最多连续出现次数 */
  maxSameRun: number;
  /** 相邻节距长度比上限（>=1 的比值，如 1.25） */
  maxAdjacentRatio: number;
  /** 允许的节距类型 id（为空则全用） */
  allowedPitchIds: string[];
  /** 优化目标权重：阶次谱峰值 */
  weightSpectralPeak: number;
  /** 优化目标权重：排列自相关（低相关=能量分散） */
  weightAutocorrelation: number;
}

export interface PitchSequence {
  id: string;
  name: string;
  /** 节距类型 id 的排列 */
  pitchIds: string[];
  pitchTypes: PitchType[];
  constraints: PitchConstraints;
  updatedAt: number;
}

/** 接地分析输入 */
export interface FootprintInput {
  tire: TireSpec;
  unit: PatternUnit;
  sequence: PitchSequence;
  /** 分析网格 x 向分辨率（周向，像素） */
  gridX: number;
  /** 分析网格 y 向分辨率（横向，像素） */
  gridY: number;
}

/** 接地区内单条纵沟的排水状态 */
export interface DrainageChannel {
  featureId: string;
  /** 沟中心 y，mm */
  y: number;
  /** 是否在接地区内贯通（从 x 入口到出口无截断） */
  connected: boolean;
  /** 被花纹块截断的次数（接地区内连通分量数 - 1） */
  cutCount: number;
  /** 接地区内该沟所占格数（深度>阈值） */
  grooveCells: number;
}

export interface FootprintResult {
  /** 名义接地长度 2a，mm */
  contactLength: number;
  /** 名义接地半宽 b，mm */
  contactHalfWidth: number;
  /** 下沉量，mm */
  deflection: number;
  /** 接地面积，mm²（条带积分精确值） */
  contactArea: number;
  /** 网格法接地面积，mm²（与积分值对照用） */
  gridContactArea: number;
  /** 名义印痕面积（椭圆近似），mm² */
  nominalArea: number;
  /** 陆地面积（接地区内花纹块部分），mm² */
  landArea: number;
  /** 沟槽面积（接地区内），mm² */
  grooveArea: number;
  /** 海陆比 = 沟槽面积 / 接地面积，0..1 */
  seaLandRatio: number;
  /** 陆地占比 = 1 - 海陆比 */
  landRatio: number;
  /** 接地区内沟槽体积，mm³ */
  grooveVolume: number;
  channels: DrainageChannel[];
  /** 深度场（压扁后路面到胎面的剩余距离，0=接地），行优先 gridY*gridX，单位 mm */
  depthField: Float32Array;
  /** 接地掩膜，1=接地格 */
  contactMask: Uint8Array;
  /** 网格物理尺寸，mm */
  dx: number;
  dy: number;
  gridX: number;
  gridY: number;
  /** 分析时使用的滚动相位（周向平移，mm） */
  phase: number;
  /** 总节距长，mm */
  totalPitchLength: number;
  /** 轮胎外周长，mm */
  circumference: number;
  /** 周长匹配误差，mm（总长-周长） */
  circumferenceError: number;
  /** 花纹块总数（序列长度，整胎） */
  blockCount: number;
  /** 计算后端 */
  backend: 'webgpu' | 'cpu';
}

/** 滚动一帧的统计 */
export interface RollingFrame {
  /** 滚动角，度 */
  angleDeg: number;
  /** 相位，mm */
  phase: number;
  /** 接地面积，mm² */
  contactArea: number;
  /** 接地陆地面积，mm² */
  landArea: number;
  /** 进/出接地区边缘的单位角度陆地变化率（绝对值均值），越小越平顺安静 */
  edgeFlux: number;
}

/** 阶次谱一条谱线 */
export interface OrderLine {
  /** 阶次（每转周期数） */
  order: number;
  /** 幅值（序列自相关归一化谱） */
  magnitude: number;
}

export interface NoiseSpectrum {
  lines: OrderLine[];
  /** 节距通过基频，Hz（给定车速下） */
  fundamentalHz: number;
  /** 主频阶次 */
  dominantOrder: number;
  /** 主频频率，Hz */
  dominantHz: number;
  speedKmh: number;
}

/** 转鼓试验记录 */
export interface DrumTestRecord {
  id: string;
  name: string;
  createdAt: number;
  speedKmh: number;
  loadN: number;
  pressureKpa: number;
  /** 测点：频率 Hz -> 声压级 dB */
  spectrum: { hz: number; db: number }[];
  /** 压力纸印痕扫描图（Blob 存 IndexedDB，这里放 id 引用） */
  pressurePaperBlobId?: string;
  /** 关联的序列 id */
  sequenceId?: string;
  note?: string;
}

/** IndexedDB 里存的项目根记录 */
export interface ProjectRecord {
  id: string;
  name: string;
  tire: TireSpec;
  unit: PatternUnit;
  sequence: PitchSequence;
  updatedAt: number;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}
