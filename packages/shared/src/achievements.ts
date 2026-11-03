// 챌린지 · 업적 (서버 ↔ 웹 공용)

/** 업적 배지. 한 번 달성하면 시즌이 바뀌어도 계속 남음 */
export interface Achievement {
  id: string;
  /** 배지 이모지 */
  icon: string;
  title: string;
  desc: string;
  /** 달성 시각 (epoch ms). 없으면 아직 잠김 */
  unlockedAt?: number;
  /** 잠긴 배지의 진행도 0~1 (횟수형만) */
  progress?: number;
}

/** active: 진행 중 / done: 달성 / failed: 이번 달은 실패 / needsSetting: 설정이 있어야 시작 */
export type ChallengeStatus = 'active' | 'done' | 'failed' | 'needsSetting';

/** 이번 달(한국시간) 챌린지 */
export interface Challenge {
  id: string;
  icon: string;
  title: string;
  desc: string;
  /** 예: '2026-11' */
  month: string;
  /** 이번 달이 끝나는 시각 (epoch ms) */
  endsAt: number;
  /** 0~1 */
  progress: number;
  status: ChallengeStatus;
  /** 지금 값과 목표. rate는 비율(0.05 = 5%), count는 횟수 */
  unit: 'rate' | 'count';
  value: number;
  target: number;
  /** 화면에 보여줄 짧은 안내 (예: 설정 필요) */
  hint?: string;
}

export interface AchievementsView {
  achievements: Achievement[];
  challenges: Challenge[];
}

/** 새로 달성했을 때 실시간 알림 */
export interface AchievementUnlock {
  kind: 'achievement' | 'challenge';
  id: string;
  icon: string;
  title: string;
  unlockedAt: number;
}
