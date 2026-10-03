import type { RelationStatus } from "@/domain/management/relation-status";

export const MEMBERSHIP_LABELS = {
  NURSE: "پرستار",
  HEAD_NURSE: "سرپرستار",
} as const;
export const RELATION_LABELS: Record<RelationStatus, string> = {
  CURRENT: "جاری",
  FUTURE: "آینده",
  ENDED: "پایان‌یافته",
};
